import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTrailTelemetry, clearTrailTelemetryCache, createGatewayServer } from '../src/server.mjs';

test('getTrailTelemetry returns valid Trail Code ROI and node metrics', () => {
  clearTrailTelemetryCache();
  const telemetry = getTrailTelemetry();
  assert.ok(telemetry, 'Telemetry object must exist');
  assert.equal(typeof telemetry.totalNodes, 'number');
  assert.ok(telemetry.totalNodes >= 7000, 'totalNodes should be >= 7000');
  assert.equal(typeof telemetry.weeklySavedTokens, 'number');
  assert.ok(telemetry.weeklySavedTokens > 0, 'weeklySavedTokens should be positive');
  assert.equal(typeof telemetry.lifetimeSavedTokens, 'number');
  assert.ok(telemetry.lifetimeSavedTokens >= 4000000, 'lifetimeSavedTokens should be >= 4M');
  assert.equal(typeof telemetry.activeLearnings, 'number');
  assert.ok(telemetry.activeLearnings >= 80, 'activeLearnings should be >= 80');
  assert.equal(typeof telemetry.costAvoidedClaudeUsd, 'number');
  assert.ok(telemetry.costAvoidedClaudeUsd > 10, 'costAvoidedClaudeUsd should be > $10');
  assert.equal(typeof telemetry.costAvoidedGeminiUsd, 'number');
  assert.ok(telemetry.costAvoidedGeminiUsd > 4, 'costAvoidedGeminiUsd should be > $4');
});

test('createGatewayServer dispatches /api/telemetry/trail with 200', async () => {
  const server = createGatewayServer({
    disableWatcher: true,
    heartbeatIntervalMs: 60000,
    reportingDatabasePath: ':memory:'
  });

  const req = {
    url: '/api/telemetry/trail',
    method: 'GET',
    headers: { host: '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' }
  };

  let statusCode = null;
  let headers = {};
  let body = '';

  const res = {
    writeHead(code, h) {
      statusCode = code;
      headers = h;
    },
    setHeader(k, v) {
      headers[k] = v;
    },
    end(data) {
      body = data;
    }
  };

  await server.emit('request', req, res);

  assert.equal(statusCode, 200);
  assert.equal(headers['Content-Type'], 'application/json; charset=UTF-8');
  assert.equal(headers['Cache-Control'], 'no-store');

  const json = JSON.parse(body);
  assert.ok(json.lifetimeSavedTokens >= 4000000);
  assert.ok(json.totalNodes >= 7000);

  server.close();
});
