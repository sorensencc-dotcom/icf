import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../src/server.mjs';

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
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog/triage-card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: 'act-03-evaluate-gemini-workspace-connectors',
        priority: 'P1',
        status: 'STAGED_FOR_TRIAGE'
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.equal(body.card.priority, 'P1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('ICF Gateway - POST /api/reporting/trm-backlog/promote attaches issue URL and updates status', async () => {
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${baseUrl}/api/reporting/trm-backlog/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardId: 'act-03-evaluate-gemini-workspace-connectors',
        repo: 'sorensencc-dotcom/toolforge',
        title: '[TRM-Triage] [P1] [EVALUATE] Evaluate Gemini Workspace Connectors',
        body: 'Automated test issue body',
        labels: ['enhancement', 'evaluation'],
        dryRun: true
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'SUCCESS');
    assert.ok(body.issue_url);
    assert.equal(body.card.status, 'IN_PROGRESS');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

