import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../dashboard/index.html'), 'utf8');

function loadBuilder() {
  const start = html.indexOf('function buildFinanceReconcileView');
  assert.ok(start >= 0, 'buildFinanceReconcileView missing from dashboard');
  const end = html.indexOf('async function loadIronbotsDailyReport', start);
  assert.ok(end > start, 'loadIronbotsDailyReport marker missing');
  return vm.runInNewContext(`(${html.slice(start, end).trim()})`);
}

test('UNKNOWN and missing report show no snapshot', () => {
  const build = loadBuilder();
  assert.equal(build({ status: 'UNKNOWN' }).text, 'No snapshot');
  assert.equal(build(undefined).text, 'No snapshot');
});

test('OK shows matched and unmapped counts', () => {
  const view = loadBuilder()({ status: 'OK', match: 3, mapped: 5, unmappedCopilot: 1 });
  assert.equal(view.text, 'OK');
  assert.equal(view.sub, '3/5 matched · 1 unmapped');
});

test('DRIFT shows drift count', () => {
  const view = loadBuilder()({ status: 'DRIFT', drift: 2, match: 3, mapped: 5, unmappedCopilot: 0 });
  assert.equal(view.text, '2 drift');
});

test('STALE_PROJECTION shows projection age in days', () => {
  const view = loadBuilder()({ status: 'STALE_PROJECTION', projectionAgeHours: 813.9, unmappedCopilot: 1 });
  assert.equal(view.text, 'Stale');
  assert.match(view.sub, /33d old/);
});

test('markup contains the finance reconcile tile', () => {
  assert.ok(html.includes('id="financeReconcileStatus"'));
  assert.ok(html.includes('id="financeReconcileSub"'));
});
