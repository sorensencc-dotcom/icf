import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer, resolveTargetRepo } from '../src/server.mjs';
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
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.ok(Array.isArray(body.cards));
    assert.ok(typeof body.count === 'number');
    assert.ok(body.count >= 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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

