import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createReportingServer, DEFAULT_REPORT_PATH } from '../src/server.mjs';

async function request(server) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/reporting/weekly-retro`);
  return { status: response.status, payload: await response.json() };
}

test('GET /api/reporting/weekly-retro preserves current success response', async t => {
  const server = createReportingServer({ reportPath: DEFAULT_REPORT_PATH });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const result = await request(server);
  assert.equal(result.status, 200);
  assert.equal(result.payload.status, 'SUCCESS');
  assert.equal(result.payload.data.date, '2026-09-13');
  assert.equal(result.payload.data.metrics.commits, 37);
});

test('GET /api/reporting/weekly-retro returns bounded unavailable shape for malformed input', async t => {
  const root = await mkdtemp(join(tmpdir(), 'icf-reporting-'));
  const malformedPath = join(root, 'malformed.json');
  await writeFile(malformedPath, '{"date":', 'utf8');
  const server = createReportingServer({ reportPath: malformedPath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const result = await request(server);
  assert.equal(result.status, 503);
  assert.equal(result.payload.status, 'UNAVAILABLE');
  assert.match(result.payload.error, /missing or unreadable/);
  assert.match(result.payload.error, /malformed\.json/);
});
