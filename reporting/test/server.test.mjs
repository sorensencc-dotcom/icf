import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createReportingServer, DEFAULT_REPORT_PATH } from '../src/server.mjs';

const FIXTURES = dirname(fileURLToPath(import.meta.url));

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

test('GET /api/reporting/weekly-retro routes committed malformed fixture to UNAVAILABLE', async t => {
  const malformedPath = join(FIXTURES, 'fixtures', 'malformed-report.json');
  const server = createReportingServer({ reportPath: malformedPath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const result = await request(server);
  assert.equal(result.status, 503);
  assert.equal(result.payload.status, 'UNAVAILABLE');
  assert.match(result.payload.error, /missing or unreadable/);
  assert.match(result.payload.error, /malformed-report\.json/);
});

test('GET /api/reporting/weekly-retro routes committed unavailable fixture for missing artifact', async t => {
  const expected = JSON.parse(await readFile(join(FIXTURES, 'fixtures', 'routing-failure.json'), 'utf8'));
  const missingPath = join(FIXTURES, 'fixtures', 'missing-weekly-retro.json');
  const server = createReportingServer({ reportPath: missingPath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const result = await request(server);
  assert.equal(result.status, 503);
  assert.equal(result.payload.status, expected.status);
  assert.match(result.payload.error, /Weekly retro artifact missing or unreadable/);
  assert.match(result.payload.error, /missing-weekly-retro\.json/);
});
