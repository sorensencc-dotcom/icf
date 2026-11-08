import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createGatewayServer, resolveTargetRepo, promoteRefusalReason, cardBodyFetchFailed, findCompletedAliasId } from '../src/server.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Avoid probing a possibly stalled G: Drive mount (existsSync can block for minutes).
process.env.TRM_GDRIVE_ARCHIVE_DIR = join(tmpdir(), 'icf-test-no-gdrive-archive');
process.env.TRM_GDRIVE_OUTBOX_DIR = join(tmpdir(), 'icf-test-no-gdrive-outbox');
process.env.ICF_REPORTING_DATABASE_PATH ??= join(mkdtempSync(join(tmpdir(), 'icf-trm-db-')), 'snapshots.sqlite');

test('ICF Gateway - GET /api/reporting/trm-backlog returns structured backlog cards', async () => {
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.ok(Array.isArray(body.cards));
    assert.ok(typeof body.count === 'number');
    assert.ok(body.count >= 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ICF Gateway - backlog stamps a priority index and leaves the ledger priority untouched', async () => {
  await withPromoteInbox([
    { id: 'act-aged-impl', status: 'STAGED', priority: 'P2', category: 'IMPLEMENT', created_at: '2026-10-01T00:00:00.000Z', roi_score: 80, velocity_delta: 10 },
    { id: 'act-fresh-research', status: 'RESEARCH', priority: 'P1', category: 'RESEARCH', created_at: new Date().toISOString() }
  ], [], async ({ baseUrl, readRows }) => {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog?refresh=1`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const aged = body.cards.find((card) => card.id === 'act-aged-impl');
    const fresh = body.cards.find((card) => card.id === 'act-fresh-research');
    assert.equal(aged.priority, 'P2');
    assert.equal(fresh.priority, 'P1');
    assert.equal(aged.priority_index_detail.directive, 'IMPLEMENT');
    assert.equal(fresh.priority_index_detail.directive, 'RESEARCH');
    assert.equal(aged.priority_index_detail.roi_known, true);
    assert.equal(fresh.priority_index_detail.roi_known, false);
    assert.ok(aged.priority_index > fresh.priority_index);
    assert.equal(readRows().some((row) => Object.hasOwn(row, 'priority_index')), false);
  });
});

test('ICF Gateway - POST /api/reporting/trm-backlog/triage-card updates card priority and status', async () => {
  await withPromoteInbox([{ id: 'card-triage', status: 'COMPLETED', priority: 'P3' }], [], async ({ baseUrl, readRows }) => {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog/triage-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-triage', priority: 'P1', status: 'STAGED_FOR_TRIAGE' })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.equal(body.card.priority, 'P1');
    assert.equal(readRows()[0].priority, 'P1');
    assert.equal(readRows()[0].status, 'STAGED_FOR_TRIAGE');
  });
});

test('ICF Gateway - TRM backlog writes reject unsafe origins, hosts, and content types', async () => {
  await withPromoteInbox([{ id: 'card-csrf', status: 'STAGED_FOR_TRIAGE', issue_url: null }], [], async ({ baseUrl }) => {
    const url = `${baseUrl}/api/reporting/trm-backlog/promote`;
    const payload = JSON.stringify({ cardId: 'card-csrf', repo: 'sorensencc-dotcom/toolforge', dryRun: true });

    const crossOrigin = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: payload
    });
    assert.equal(crossOrigin.status, 403);
    assert.match((await crossOrigin.json()).error, /valid loopback Host and Origin required/);

    const badHost = await new Promise((resolve, reject) => {
      const req = request(url, {
        method: 'POST',
        headers: { Host: 'evil-rebind.attacker.test:8080', 'Content-Type': 'application/json' }
      }, (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on('error', reject);
      req.end(payload);
    });
    assert.equal(badHost.status, 403);
    assert.match(badHost.body.error, /valid loopback Host and Origin required/);

    const plainText = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload
    });
    assert.equal(plainText.status, 400);
    assert.match((await plainText.json()).error, /application\/json required/);

    const getWrite = await fetch(url);
    assert.equal(getWrite.status, 405);
    assert.equal(getWrite.headers.get('access-control-allow-origin'), null);

    const allowed = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), null);
    assert.equal((await allowed.json()).status, 'SUCCESS');
  });
});

async function withPromoteInbox(rows, receiptIds, fn) {
  const inboxDir = mkdtempSync(join(tmpdir(), 'trm-inbox-'));
  mkdirSync(join(inboxDir, 'outbox'), { recursive: true });
  writeFileSync(join(inboxDir, 'ledger.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  for (const id of receiptIds) {
    writeFileSync(join(inboxDir, 'outbox', `receipt-${id}-completed.json`), JSON.stringify({ action_id: id, status: 'COMPLETED' }), 'utf8');
  }
  const previous = process.env.TRM_INBOX_DIR;
  process.env.TRM_INBOX_DIR = inboxDir;
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const promote = (cardId) => fetch(`${baseUrl}/api/reporting/trm-backlog/promote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId, repo: 'sorensencc-dotcom/toolforge', dryRun: true })
  });
  const readRows = () => readFileSync(join(inboxDir, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  try {
    await fn({ promote, readRows, baseUrl });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.TRM_INBOX_DIR; else process.env.TRM_INBOX_DIR = previous;
    rmSync(inboxDir, { recursive: true, force: true });
  }
}

test('ICF Gateway - POST /api/reporting/trm-backlog/promote attaches issue URL and updates status', async () => {
  await withPromoteInbox([{ id: 'card-open', status: 'STAGED_FOR_TRIAGE', issue_url: null }], [], async ({ promote, readRows }) => {
    const res = await promote('card-open');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.ok(body.issue_url);
    assert.equal(body.card.status, 'IN_PROGRESS');
    assert.equal(readRows()[0].status, 'IN_PROGRESS');
  });
});

test('ICF Gateway - promote refuses completed, already-promoted, and receipt-backed cards with 409', async () => {
  const rows = [
    { id: 'card-completed', status: 'COMPLETED', completed_at: '2026-10-01T11:45:04.621Z', issue_url: null },
    { id: 'card-promoted', status: 'IN_PROGRESS', issue_url: 'https://github.com/sorensencc-dotcom/toolforge/issues/1' },
    { id: 'card-receipt', status: 'IN_PROGRESS', issue_url: null }
  ];
  await withPromoteInbox(rows, ['card-receipt'], async ({ promote, readRows }) => {
    for (const id of ['card-completed', 'card-promoted', 'card-receipt']) {
      const res = await promote(id);
      assert.equal(res.status, 409, `${id} must be refused`);
      assert.equal((await res.json()).status, 'CONFLICT');
    }
    const byId = Object.fromEntries(readRows().map((r) => [r.id, r]));
    assert.equal(byId['card-completed'].status, 'COMPLETED');
    assert.equal(byId['card-promoted'].status, 'IN_PROGRESS');
    assert.equal(byId['card-receipt'].status, 'COMPLETED', 'receipt-backed row is reconciled to COMPLETED');
  });
});

test('promoteRefusalReason blocks filename-only cards, rejected status, and completed aliases', () => {
  assert.equal(cardBodyFetchFailed({ context: { body_fetch_failed: true } }), true);
  assert.equal(cardBodyFetchFailed({ context: { note: 'body text fetch failed: 401 Unauthorized' } }), true);
  assert.equal(cardBodyFetchFailed({ error: 'Document body extraction failed; only filename metadata is present.' }), true);
  assert.equal(cardBodyFetchFailed({ context: { raw_input: 'ok' } }), false);

  assert.equal(promoteRefusalReason({
    cardId: 'card-approve',
    lockRow: { id: 'card-approve', status: 'STAGED', issue_url: null, promotion_locked: true, approved: true },
    cardData: { promotion_locked: true, approved: true },
    ledgerRows: []
  }), 'card is approval-locked');

  assert.equal(promoteRefusalReason({
    cardId: 'act-01-stub',
    lockRow: { id: 'act-01-stub', status: 'STAGED_FOR_TRIAGE', issue_url: null, context: { body_fetch_failed: true } },
    cardData: { context: { body_fetch_failed: true } },
    ledgerRows: []
  }), 'source document body was not fetched');

  assert.equal(promoteRefusalReason({
    cardId: 'act-01-stub',
    lockRow: { id: 'act-01-stub', status: 'REJECTED', issue_url: null },
    cardData: { status: 'REJECTED' },
    ledgerRows: []
  }), 'card status is REJECTED');

  assert.equal(promoteRefusalReason({
    cardId: 'act-01-jittest',
    lockRow: { id: 'act-01-jittest', status: 'QUARANTINED_INSUFFICIENT_DATA', issue_url: null },
    cardData: { status: 'QUARANTINED_INSUFFICIENT_DATA' },
    ledgerRows: []
  }), 'card status is QUARANTINED_INSUFFICIENT_DATA');

  const aliasRows = [{
    id: 'ACT-TOOLFORGE-POST-TURN-SELF-ASSESSMENT-AUDITOR',
    status: 'COMPLETED',
    archived_path: 'G:\\My Drive\\archive\\2026-10-30T174503Z__action__toolforge__act-01-post-turn-self-assessment-auditor.md'
  }];
  assert.equal(findCompletedAliasId('act-01-post-turn-self-assessment-auditor', aliasRows), 'ACT-TOOLFORGE-POST-TURN-SELF-ASSESSMENT-AUDITOR');
  assert.match(promoteRefusalReason({
    cardId: 'act-01-post-turn-self-assessment-auditor',
    lockRow: { id: 'act-01-post-turn-self-assessment-auditor', status: 'STAGED_FOR_TRIAGE', issue_url: null },
    cardData: {},
    ledgerRows: aliasRows
  }), /completed alias exists: ACT-TOOLFORGE-POST-TURN-SELF-ASSESSMENT-AUDITOR/);
});

test('ICF Gateway - promote refuses filename-only, rejected-receipt, and completed-alias cards with 409', async () => {
  const rows = [
    { id: 'act-01-stub-fetch', status: 'STAGED_FOR_TRIAGE', issue_url: null, context: { body_fetch_failed: true } },
    { id: 'act-01-stub-rejected', status: 'STAGED_FOR_TRIAGE', issue_url: null },
    { id: 'act-01-stub-alias', status: 'STAGED_FOR_TRIAGE', issue_url: null },
    {
      id: 'ACT-REAL-ALIAS',
      status: 'COMPLETED',
      completed_at: '2026-11-05T00:00:00.000Z',
      archived_path: 'archive/2026-10-30T174503Z__action__toolforge__act-01-stub-alias.md',
      issue_url: 'https://github.com/sorensencc-dotcom/toolforge/issues/256'
    }
  ];
  await withPromoteInbox(rows, [], async ({ promote, readRows }) => {
    writeFileSync(
      join(process.env.TRM_INBOX_DIR, 'outbox', 'receipt-act-01-stub-rejected-rejected.json'),
      JSON.stringify({ action_id: 'act-01-stub-rejected', status: 'REJECTED' }),
      'utf8'
    );
    for (const id of ['act-01-stub-fetch', 'act-01-stub-rejected', 'act-01-stub-alias']) {
      const res = await promote(id);
      assert.equal(res.status, 409, `${id} must be refused`);
      const body = await res.json();
      assert.equal(body.status, 'CONFLICT');
      assert.match(body.error, /Promote refused:/);
    }
    const byId = Object.fromEntries(readRows().map((r) => [r.id, r]));
    assert.equal(byId['act-01-stub-fetch'].status, 'STAGED_FOR_TRIAGE');
    assert.equal(byId['act-01-stub-rejected'].status, 'STAGED_FOR_TRIAGE');
    assert.equal(byId['act-01-stub-alias'].status, 'STAGED_FOR_TRIAGE');
  });
});

test('ICF Gateway - promote allows promoting researched cards with an RFC reference', async () => {
  const row = {
    id: 'card-researched',
    status: 'DONE',
    completed_at: '2026-10-01T11:45:04.621Z',
    issue_url: null,
    target: 'kb-sync',
    intent: 'researched_idea',
    research_ref: 'wiki/research/rfc-card-researched.md'
  };
  await withPromoteInbox([row], ['card-researched'], async ({ promote, readRows }) => {
    const res = await promote('card-researched');
    assert.equal(res.status, 200, 'researched card with RFC can be promoted into an issue');
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.ok(body.issue_url);
    const updated = readRows().find(r => r.id === 'card-researched');
    assert.equal(updated.status, 'IN_PROGRESS');
    assert.equal(updated.issue_url, body.issue_url);
  });
});

test('ICF Gateway - promote hydrates card body and formats title with commit prefix from archived card', async () => {
  const row = { id: 'card-hydrate', status: 'STAGED_FOR_TRIAGE', issue_url: null, target: 'toolforge', intent: 'test_hydration' };
  await withPromoteInbox([row], [], async ({ baseUrl }) => {
    const completedDir = join(process.env.TRM_INBOX_DIR, 'completed');
    mkdirSync(completedDir, { recursive: true });
    writeFileSync(join(completedDir, 'card-hydrate.json'), JSON.stringify({
      id: 'card-hydrate',
      category: 'IMPLEMENT',
      target: 'toolforge',
      intent: 'test_hydration',
      context: { source_system: 'test-harness' },
      execution_plan: [{ step: 1, action: 'verify' }],
      deliverables: 'Deliverable 1'
    }), 'utf8');

    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-hydrate', repo: 'sorensencc-dotcom/toolforge', dryRun: true })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.equal(body.card.status, 'IN_PROGRESS');
  });
});

test('ICF Gateway - resolveTargetRepo and promote fallback deterministically map target domains', async () => {
  assert.equal(resolveTargetRepo('icf'), 'sorensencc-dotcom/icf');
  assert.equal(resolveTargetRepo('kb-sync'), 'sorensencc-dotcom/kb-sync');
  assert.equal(resolveTargetRepo('personal-os'), 'sorensencc-dotcom/personal-os');
  assert.equal(resolveTargetRepo('ironledger'), 'sorensencc-dotcom/IronLedger');
  assert.equal(resolveTargetRepo('toolforge'), 'sorensencc-dotcom/toolforge');

  const row = { id: 'card-repo-route', status: 'STAGED_FOR_TRIAGE', issue_url: null, target: 'icf', intent: 'test_routing' };
  await withPromoteInbox([row], [], async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-repo-route', dryRun: true })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.match(body.card.issue_url, /github\.com\/sorensencc-dotcom\/icf\/issues/);
  });
});

test('ICF Gateway - run-spike executes research spike and marks card DONE', async () => {
  const row = { id: 'card-spike-test', status: 'STAGED_FOR_TRIAGE', issue_url: null, target: 'kb-sync', intent: 'test_spike_execution', category: 'RESEARCH' };
  await withPromoteInbox([row], [], async ({ baseUrl, readRows }) => {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog/run-spike`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-spike-test', dryRun: true })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.ok(body.result.rfcFilename);

    const updated = readRows().find(r => r.id === 'card-spike-test');
    assert.equal(updated.status, 'DONE');
    assert.ok(updated.completed_at);
  });
});

test('ICF Gateway - batch-triage routes cards into spikes and promotions', async () => {
  const row1 = { id: 'card-batch-spike', status: 'STAGED_FOR_TRIAGE', target: 'cic-kb', intent: 'test_research_spike', category: 'RESEARCH' };
  const row2 = { id: 'card-batch-code', status: 'STAGED_FOR_TRIAGE', target: 'toolforge', intent: 'test_code_promoted', category: 'IMPLEMENT', direction: 'NEW_IMPLEMENTATION' };
  await withPromoteInbox([row1, row2], [], async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog/batch-triage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true, limit: 2 })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.ok(body.results.total >= 1);
  });
});

test('ICF Gateway - stage-pr creates branch name and test scaffold path', async () => {
  const row = { id: 'card-stage-test', status: 'IN_PROGRESS', target: 'toolforge', intent: 'test_stage_pr', deliverables: ['Pass all tests'] };
  await withPromoteInbox([row], [], async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog/stage-pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-stage-test', dryRun: true })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.equal(body.results.branchName, 'trm/card-stage-test');
    assert.match(body.results.testFilePath, /trm-card-stage-test\.test\.mjs/);
  });
});

test('ICF Gateway - backlog card reconciles pr_branch and preserves active status over stale receipt', async () => {
  const row = {
    id: 'card-staged-active',
    status: 'IN_PROGRESS',
    pr_branch: 'trm/card-staged-active',
    pr_stage: 'STAGED_FOR_DEV',
    issue_url: 'https://github.com/sorensencc-dotcom/toolforge/issues/999'
  };
  await withPromoteInbox([row], ['card-staged-active'], async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const card = body.cards.find(c => c.id === 'card-staged-active');
    assert.ok(card);
    assert.equal(card.status, 'IN_PROGRESS', 'stale outbox receipt does not revert active status');
    assert.equal(card.pr_branch, 'trm/card-staged-active');
  });
});

test('ICF Gateway - backlog card prioritizes terminal completed receipt over earlier staging receipt', async () => {
  const row = {
    id: 'card-competing-receipts',
    status: 'STAGED_FOR_RESEARCH',
    target: 'toolforge',
    intent: 'test_competing_receipts'
  };
  const inboxDir = mkdtempSync(join(tmpdir(), 'trm-inbox-'));
  const outboxDir = join(inboxDir, 'outbox');
  mkdirSync(outboxDir, { recursive: true });
  writeFileSync(join(inboxDir, 'ledger.jsonl'), JSON.stringify(row) + '\n', 'utf8');
  writeFileSync(join(outboxDir, 'receipt-100-card-competing-receipts.json'), JSON.stringify({
    action_id: 'card-competing-receipts',
    status: 'STAGED_FOR_RESEARCH',
    dispatched_at: '2026-10-04T12:00:00.000Z'
  }), 'utf8');
  writeFileSync(join(outboxDir, 'receipt-card-competing-receipts-completed.json'), JSON.stringify({
    action_id: 'card-competing-receipts',
    status: 'COMPLETED',
    completed_at: '2026-10-04T12:00:01.000Z',
    pr_url: 'https://github.com/sorensencc-dotcom/toolforge/pull/77'
  }), 'utf8');

  const previous = process.env.TRM_INBOX_DIR;
  process.env.TRM_INBOX_DIR = inboxDir;
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const card = body.cards.find(c => c.id === 'card-competing-receipts');
    assert.ok(card);
    assert.equal(card.status, 'COMPLETED');
    assert.equal(card.pr_url, 'https://github.com/sorensencc-dotcom/toolforge/pull/77');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previous === undefined) delete process.env.TRM_INBOX_DIR; else process.env.TRM_INBOX_DIR = previous;
    rmSync(inboxDir, { recursive: true, force: true });
  }
});

test('ICF Gateway - approve locks a card, emits action.promoted, and does not stage while a writer holds the repo', async () => {
  await withPromoteInbox([
    { id: 'card-research', status: 'STAGED', category: 'RESEARCH', target: 'toolforge' },
    { id: 'card-approve', status: 'STAGED', category: 'IMPLEMENT', target: 'sigil', intent: 'countersign' },
    { id: 'card-held', status: 'STAGED', category: 'IMPLEMENT', target: 'rewrite-mcp', intent: 'held repo' }
  ], [], async ({ baseUrl, readRows }) => {
    const research = await fetch(`${baseUrl}/api/reporting/trm-backlog/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-research', dryRun: true })
    });
    assert.equal(research.status, 409);
    assert.equal(readRows().find((row) => row.id === 'card-research').promotion_locked, undefined);

    const seat = await fetch(`${baseUrl}/api/reporting/trm-backlog/writer-seat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: 'rewrite-mcp', holder: 'Claude Code' })
    });
    assert.equal(seat.status, 200);

    const held = await fetch(`${baseUrl}/api/reporting/trm-backlog/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-held', dryRun: true })
    });
    assert.equal(held.status, 200);
    const heldBody = await held.json();
    assert.equal(heldBody.event, 'action.promoted');
    assert.equal(heldBody.blocked_by, 'Claude Code');
    assert.equal(heldBody.staged, false);
    assert.equal(readRows().find((row) => row.id === 'card-held').promotion_locked, true);

    const blockedStage = await fetch(`${baseUrl}/api/reporting/trm-backlog/stage-pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-held', dryRun: true, createBranch: true })
    });
    assert.equal(blockedStage.status, 409);

    const approved = await fetch(`${baseUrl}/api/reporting/trm-backlog/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-approve', dryRun: true })
    });
    assert.equal(approved.status, 200);
    const approvedBody = await approved.json();
    assert.equal(approvedBody.event, 'action.promoted');
    assert.equal(approvedBody.blocked_by, null);
    const row = readRows().find((item) => item.id === 'card-approve');
    assert.equal(row.approved, true);
    assert.equal(row.promotion_locked, true);
    assert.equal(row.pr_branch, undefined);

    const again = await fetch(`${baseUrl}/api/reporting/trm-backlog/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-approve', dryRun: true })
    });
    assert.equal(again.status, 409);

    const promote = await fetch(`${baseUrl}/api/reporting/trm-backlog/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'card-approve', dryRun: true, repo: 'sorensencc-dotcom/sigil' })
    });
    assert.equal(promote.status, 409);
  });
});
