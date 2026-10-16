import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../src/server.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('ICF Gateway - promote hydrates card body and formats title with commit prefix from archived card', async () => {
  const row = { id: 'card-hydrate', status: 'STAGED_FOR_TRIAGE', issue_url: null, target: 'toolforge', intent: 'test_hydration' };
  await withPromoteInbox([row], [], async ({ baseUrl, readRows }) => {
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

