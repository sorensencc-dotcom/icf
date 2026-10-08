import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGatewayServer, isLoopback } from '../src/server.mjs';
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

    // 4. TRM history endpoint
    const resTrmDates = await fetch(`${baseUrl}/api/reporting/trm/history`);
    assert.equal(resTrmDates.status, 200);
    const trmDatesData = await resTrmDates.json();
    assert.equal(trmDatesData.status, 'SUCCESS');
    assert.ok(Array.isArray(trmDatesData.dates));
    assert.ok(trmDatesData.dates.length > 0);

    const resTrmSnapshot = await fetch(`${baseUrl}/api/reporting/trm/history?date=${trmDatesData.dates[0]}`);
    assert.equal(resTrmSnapshot.status, 200);
    const snapshotData = await resTrmSnapshot.json();
    assert.ok(snapshotData.topics_total !== undefined || snapshotData.notebooks !== undefined || snapshotData.notebook_findings !== undefined);

    // 5. Static resolution fallback for /modules/wiki/daily_status.json
    const resWikiDaily = await fetch(`${baseUrl}/modules/wiki/daily_status.json`);
    assert.equal(resWikiDaily.status, 200);
    const wikiDailyData = await resWikiDaily.json();
    assert.ok(wikiDailyData.trm_intelligence !== undefined);

    // 6. Path traversal prevention test with raw path
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
    const reloadedServer = createGatewayServer({ reportDirectory, snapshotStore: store, disableWatcher: true });
    assert.equal(store.listSnapshots({ fromWeek: '2026-W01', toWeek: '2026-W53', categoryId: 'delivery', sourceSystem: 'icf', sourceId: 'weekly-retro' }).length, 2);
    reloadedServer.close();
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

test('gateway serves native real-time SSE stream on /api/events with connected handshake', async () => {
  const server = createGatewayServer({ disableWatcher: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const sseChunks = await new Promise((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port,
        path: '/api/events',
        method: 'GET'
      }, (res) => {
        assert.equal(res.statusCode, 200);
        assert.match(res.headers['content-type'], /text\/event-stream/);
        assert.match(res.headers['cache-control'], /no-cache/);
        assert.match(res.headers['connection'], /keep-alive/);

        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          body += chunk;
          if (body.includes('event: connected')) {
            req.destroy();
            resolve(body);
          }
        });
      });

      req.on('error', (err) => {
        if (err.code === 'ECONNRESET' || req.destroyed) {
          // Expected on req.destroy()
          return;
        }
        reject(err);
      });
      req.end();
    });

    assert.match(sseChunks, /event: connected/);
    assert.match(sseChunks, /"status":"CONNECTED"/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('gateway serves Meridian focus telemetry without screen text', async () => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const dir = await mkdtemp(join(tmpdir(), 'icf-meridian-'));
  const dbPath = join(dir, 'meridian.db');
  const sentinel = 'SENTINEL-SCREEN-TEXT-4242';
  const now = new Date().toISOString();
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE app_sessions (app_name TEXT, started_at TEXT, duration_s INTEGER, category TEXT, session_text TEXT);
    CREATE TABLE active_session (app_name TEXT, started_at TEXT, last_seen_at TEXT, category TEXT, session_text TEXT);`);
  db.prepare('INSERT INTO active_session VALUES (?, ?, ?, ?, ?)').run('Code.exe', now, now, 'coding', sentinel);
  db.close();

  const server = createGatewayServer({ meridianDbPath: dbPath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${baseUrl}/api/reporting/meridian`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(!body.includes(sentinel));
    const payload = JSON.parse(body);
    assert.equal(payload.status, 'SUCCESS');
    assert.equal(payload.data.available, true);
    assert.equal(payload.data.active.app_name, 'Code.exe');

    const missing = createGatewayServer({ meridianDbPath: join(dir, 'nope.db') });
    await new Promise((resolve) => missing.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${missing.address().port}/api/reporting/meridian`);
      assert.deepEqual((await res.json()).data, { available: false, reason: 'db-missing' });
    } finally { await new Promise((resolve) => missing.close(resolve)); }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('gateway serves Meridian day and week reports with commit counts', async () => {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const dir = await mkdtemp(join(tmpdir(), 'icf-meridian-day-'));
  const dbPath = join(dir, 'meridian.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE app_sessions (app_name TEXT, started_at TEXT, duration_s INTEGER, category TEXT);
    CREATE TABLE active_session (app_name TEXT, started_at TEXT, last_seen_at TEXT, category TEXT);
    CREATE TABLE day_summaries (day_local TEXT, insights_json TEXT, headline TEXT, plan_json TEXT, adherence_json TEXT,
      standup_json TEXT, fallback INTEGER, generated_at TEXT);
    CREATE TABLE day_tasks (day_local TEXT, task_id TEXT, title TEXT, minutes INTEGER);`);
  db.prepare(`INSERT INTO day_summaries VALUES ('2026-09-29', '[]', 'Plan cleared', '[]', '{"planned":3,"done":3}', '[]', 0, '2026-09-30T01:00:00Z')`).run();
  db.close();

  const server = createGatewayServer({ meridianDbPath: dbPath, commitRepos: [], gitAuthor: 'Nobody' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const day = await (await fetch(`${baseUrl}/api/reporting/meridian/day?date=2026-09-29`)).json();
    assert.equal(day.status, 'SUCCESS');
    assert.equal(day.data.meridian.summary.headline, 'Plan cleared');
    assert.deepEqual(day.data.commits, { count: 0, repos: {} });

    const week = await (await fetch(`${baseUrl}/api/reporting/meridian/week?end=2026-09-30`)).json();
    assert.equal(week.data.meridian.days.length, 7);
    assert.deepEqual(week.data.commits, { days: {}, total: 0 });

    assert.equal((await fetch(`${baseUrl}/api/reporting/meridian/day?date=../etc`)).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Meridian routes only answer loopback clients', () => {
  assert.ok(isLoopback('127.0.0.1'));
  assert.ok(isLoopback('::1'));
  assert.ok(isLoopback('::ffff:127.0.0.1'));
  assert.ok(!isLoopback('192.168.1.20'));
  assert.ok(!isLoopback('::ffff:192.168.1.20'));
  assert.ok(!isLoopback(undefined));
});
