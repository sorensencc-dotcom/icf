import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createGatewayServer } from '../src/server.mjs';

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
