import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DASHBOARD_ELEMENT_NAME,
  DASHBOARD_SRC_ATTRIBUTE,
  WeeklyReportingDashboard,
  dashboardErrorMessage,
  dashboardPayloadError,
  dashboardRequest
} from '../weekly-reporting-dashboard.mjs';

test('freezes dashboard entrypoint and request semantics', () => {
  assert.equal(DASHBOARD_ELEMENT_NAME, 'weekly-reporting-dashboard');
  assert.equal(DASHBOARD_SRC_ATTRIBUTE, 'src');
  assert.deepEqual(dashboardRequest('/api/reporting/weekly-retro'), {
    url: '/api/reporting/weekly-retro',
    init: { method: 'GET', headers: { Accept: 'application/json' } }
  });
  assert.deepEqual(WeeklyReportingDashboard.observedAttributes, ['src']);
  assert.equal(dashboardPayloadError({ ok: true, status: 200 }, { status: 'SUCCESS' }), null);
  assert.equal(dashboardPayloadError({ ok: false, status: 503 }, { status: 'UNAVAILABLE', error: 'offline' }), 'offline');
});

test('dashboard reports missing endpoint and transport failures with current copy', () => {
  assert.throws(() => dashboardRequest(''), /No reporting endpoint configured/);
  assert.equal(dashboardErrorMessage(new Error('offline')), 'Weekly telemetry unavailable: offline');
});
