import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGatewayServer } from '../src/server.mjs';
import { createMobileSnapshotService } from '../src/mobile-snapshot.mjs';
import { createSnapshotStore } from '../reporting/src/snapshot-store.mjs';

test('ICF Gateway Server serves static dashboard and reporting routes', async () => {
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Dashboard static index
    const resDashboard = await fetch(`${baseUrl}/dashboard`);
    assert.equal(resDashboard.status, 200);
    assert.match(resDashboard.headers.get('content-type'), /text\/html/);

    // 2. Reporting weekly-retro endpoint
    const resRetro = await fetch(`${baseUrl}/api/reporting/weekly-retro`);
    assert.ok([200, 503].includes(resRetro.status));
    assert.match(resRetro.headers.get('content-type'), /application\/json/);

    // 3. Reporting categories endpoint
    const resCategories = await fetch(`${baseUrl}/api/reporting/weekly-retro/categories`);
    assert.equal(resCategories.status, 200);
    const categoriesData = await resCategories.json();
    assert.equal(categoriesData.status, 'SUCCESS');
    assert.ok(Array.isArray(categoriesData.data));

    // 4. Path traversal prevention test with raw path
    const resTraversalStatus = await new Promise((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port,
        path: '/../package.json',
        method: 'GET'
      }, (res) => {
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(resTraversalStatus, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('mobile snapshot requires auth and serves a signed validated snapshot', async () => {
  const mobileSnapshot = createMobileSnapshotService({ signingKey: 'test-signing-key', authToken: 'test-token' });
  const server = createGatewayServer({ mobileSnapshot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${baseUrl}/api/mobile/snapshot`)).status, 401);
    const response = await fetch(`${baseUrl}/api/mobile/snapshot`, { headers: { Authorization: 'Bearer test-token' } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.partial, false);
    assert.equal(payload.manifest.schema_version, '1.0');
    assert.equal(payload.freshness, 'fresh');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('gateway ingests weekly artifacts and serves materialized history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icf-gateway-history-'));
  const reportDirectory = join(directory, 'weekly');
  await mkdir(reportDirectory);
  const fixture = JSON.parse(await readFile(new URL('../reporting/test/fixtures/valid-report.json', import.meta.url), 'utf8'));
  for (const [date, commits] of [['2026-09-14', 4], ['2026-09-21', 7]]) {
    await writeFile(join(reportDirectory, `retro-${date}.json`), JSON.stringify({
      ...fixture,
      date,
      metrics: { ...fixture.metrics, commits }
    }));
  }
  const store = createSnapshotStore({ databasePath: join(directory, 'snapshots.sqlite') });
  const server = createGatewayServer({ reportDirectory, snapshotStore: store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reporting/weekly-retro/history?categoryId=delivery&window=4`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, 'SUCCESS');
    assert.equal(payload.data.status, 'insufficient_history');
    assert.deepEqual(payload.data.weeks.filter(week => week.state !== 'missing').map(week => week.weekKey), ['2026-W38', '2026-W39']);
    assert.equal(payload.data.metrics.find(metric => metric.metricId === 'commits').trend, 'up');
    assert.equal(store.listSnapshots({ fromWeek: '2026-W01', toWeek: '2026-W53', categoryId: 'delivery', sourceSystem: 'icf', sourceId: 'weekly-retro' }).length, 2);
    createGatewayServer({ reportDirectory, snapshotStore: store });
    assert.equal(store.listSnapshots({ fromWeek: '2026-W01', toWeek: '2026-W53', categoryId: 'delivery', sourceSystem: 'icf', sourceId: 'weekly-retro' }).length, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});

test('gateway history remains insufficient with one weekly artifact and ignores malformed artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icf-gateway-history-one-'));
  const reportDirectory = join(directory, 'weekly');
  await mkdir(reportDirectory);
  const fixture = JSON.parse(await readFile(new URL('../reporting/test/fixtures/valid-report.json', import.meta.url), 'utf8'));
  await writeFile(join(reportDirectory, 'retro-2026-09-21.json'), JSON.stringify({ ...fixture, date: '2026-09-21' }));
  await writeFile(join(reportDirectory, 'retro-invalid.json'), '{not-json');
  const store = createSnapshotStore({ databasePath: join(directory, 'snapshots.sqlite') });
  const server = createGatewayServer({ reportDirectory, snapshotStore: store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reporting/weekly-retro/history?categoryId=delivery&window=4`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.data.status, 'insufficient_history');
    assert.equal(payload.data.summary.status, 'insufficient_history');
    assert.equal(store.listSnapshots({ fromWeek: '2026-W01', toWeek: '2026-W53', categoryId: 'delivery', sourceSystem: 'icf', sourceId: 'weekly-retro' }).length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});
