import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createReportingServer, DEFAULT_REPORT_PATH, CATEGORIES_API_ROUTE, ROUTING_API_ROUTE, ACTIONS_API_ROUTE } from '../src/server.mjs';

const FIXTURES = dirname(fileURLToPath(import.meta.url));

async function request(server) {
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/reporting/weekly-retro`);
  return { status: response.status, payload: await response.json() };
}

async function requestPath(server, path) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  return { status: response.status, payload: await response.json() };
}

test('Task 6 read projections expose validated categories and bounded unavailable states', async t => {
  const server = createReportingServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const categories = await requestPath(server, CATEGORIES_API_ROUTE);
  assert.equal(categories.status, 200);
  assert.equal(categories.payload.schemaVersion, '1.0');
  assert.deepEqual(categories.payload.data.categories.map(category => category.id), ['delivery', 'quality', 'reliability', 'governance']);
  const routing = await requestPath(server, ROUTING_API_ROUTE);
  assert.equal(routing.status, 503);
  assert.equal(routing.payload.status, 'UNAVAILABLE');
  const actions = await requestPath(server, `${ACTIONS_API_ROUTE}?fromWeek=2026-W37&toWeek=2026-W37`);
  assert.equal(actions.status, 503);
  assert.equal(actions.payload.status, 'UNAVAILABLE');
});

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

test('GET /api/reporting/weekly-retro rejects malformed nested category source data', async t => {
  const malformedReport = JSON.parse(await readFile(join(FIXTURES, 'fixtures', 'valid-report.json'), 'utf8'));
  malformedReport.test_health.total_test_files = '184';
  const server = createReportingServer({ readReport: async () => malformedReport });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const result = await request(server);
  assert.equal(result.status, 503);
  assert.equal(result.payload.status, 'UNAVAILABLE');
  assert.match(result.payload.error, /test_health\.total_test_files/);
});
