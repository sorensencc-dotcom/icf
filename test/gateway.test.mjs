import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createGatewayServer } from '../src/server.mjs';
import { createMobileSnapshotService } from '../src/mobile-snapshot.mjs';

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
