import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  CURRENT_METRIC_FIELDS,
  CURRENT_REQUIRED_REPORT_TOP_LEVEL_FIELDS,
  LAUNCH_CATEGORY_IDS,
  OPTIONAL_PROVENANCE_FIELDS,
  validateApiResponse,
  validateCategoryFixture,
  validateWeeklyRetroReport
} from '../src/weekly-retro-contract.mjs';

const FIXTURES = dirname(fileURLToPath(import.meta.url));
const loadJson = async name => JSON.parse(await readFile(join(FIXTURES, 'fixtures', name), 'utf8'));

test('freezes current report field shape and deterministic source values', async () => {
  const report = await loadJson('valid-report.json');
  assert.deepEqual(Object.keys(report), CURRENT_REQUIRED_REPORT_TOP_LEVEL_FIELDS);
  assert.deepEqual(OPTIONAL_PROVENANCE_FIELDS, ['since', 'until', 'base_branch', 'session_focus']);
  assert.deepEqual(Object.keys(report.metrics), CURRENT_METRIC_FIELDS);
  assert.equal(validateWeeklyRetroReport(report).ok, true);
  assert.equal(report.date, '2026-09-13');
  assert.equal(report.window, '7d');
  assert.equal('base_branch' in report, false);
  assert.equal('session_focus' in report, false);
  assert.equal(report.metrics.commits, 37);
  assert.deepEqual(report.version_range, ['2.64.0', '2.66.2']);
});

test('accepts partial report fixture only through explicit partial mode', async () => {
  const report = await loadJson('partial-report.json');
  const strict = validateWeeklyRetroReport(report);
  const partial = validateWeeklyRetroReport(report, { allowPartial: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.missing.includes('authors'));
  assert.equal(partial.ok, true);
  assert.equal(partial.partial, true);
});

test('preserves empty category state and launch category ordering', async () => {
  const category = await loadJson('empty-category.json');
  assert.deepEqual(LAUNCH_CATEGORY_IDS, ['delivery', 'quality', 'reliability', 'governance']);
  assert.equal(category.week_key, '2026-W36');
  assert.equal(category.category_id, 'quality');
  assert.equal(category.state, 'empty');
  assert.deepEqual(category.records, []);
  assert.deepEqual(validateCategoryFixture(category), { ok: true, errors: [] });
});

test('preserves non-empty category record ordering', async () => {
  const category = await loadJson('ordered-records.json');
  assert.deepEqual(category.records.map(record => record.record_id), [
    'delivery-001',
    'delivery-002',
    'delivery-003'
  ]);
  assert.deepEqual(validateCategoryFixture(category), { ok: true, errors: [] });
});

test('freezes SUCCESS and UNAVAILABLE API response shapes', async () => {
  const report = await loadJson('valid-report.json');
  const failure = await loadJson('routing-failure.json');
  assert.deepEqual(validateApiResponse({ status: 'SUCCESS', data: report }), { ok: true, errors: [] });
  assert.deepEqual(validateApiResponse(failure), { ok: true, errors: [] });
  assert.equal(validateApiResponse({ status: 'SUCCESS' }).ok, false);
  assert.equal(validateApiResponse({ status: 'UNAVAILABLE' }).ok, false);
});

test('rejects missing, unknown, and incorrectly typed metrics', async () => {
  const report = await loadJson('valid-report.json');
  delete report.metrics.commits;
  report.metrics.unexpected_metric = 1;
  report.metrics.test_ratio = '20%';
  report.extra_field = true;
  const result = validateWeeklyRetroReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('metrics.commits: is required'));
  assert.ok(result.errors.includes('metrics.unexpected_metric: is not part of the frozen metric contract'));
  assert.ok(result.errors.includes('metrics.test_ratio: must be a number from 0 to 1'));
  assert.ok(result.errors.includes('extra_field: is not part of the frozen current report contract'));
});

test('preserves and validates optional canonical provenance fields when present', async () => {
  const report = await loadJson('valid-report.json');
  report.since = '2026-09-06T00:00:00.000Z';
  report.until = '2026-09-13T23:59:59.999Z';
  report.base_branch = 'main';
  report.session_focus = { summary: 'Summary', incidents: [], process_learnings: [] };
  assert.equal(validateWeeklyRetroReport(report).ok, true);

  report.since = 'not-a-timestamp';
  report.base_branch = 42;
  report.session_focus.incidents = ['valid', 9];
  const result = validateWeeklyRetroReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('since: must be an ISO timestamp'));
  assert.ok(result.errors.includes('base_branch: must be a non-empty string'));
  assert.ok(result.errors.includes('session_focus.incidents: must be an array of strings'));
});

test('rejects malformed report JSON without weakening boundary validation', async () => {
  await assert.rejects(
    readFile(join(FIXTURES, 'fixtures', 'malformed-report.json')).then(JSON.parse),
    SyntaxError
  );
});

test('manifest fixes week keys, category IDs, and record order for downstream tasks', async () => {
  const manifest = await loadJson('manifest.json');
  assert.deepEqual(manifest.week_keys, ['2026-W36', '2026-W37']);
  assert.deepEqual(manifest.launch_category_ids, LAUNCH_CATEGORY_IDS);
  assert.deepEqual(manifest.category_record_order, LAUNCH_CATEGORY_IDS);
  assert.deepEqual(manifest.optional_provenance_fields, ['since', 'until', 'base_branch', 'session_focus']);
  assert.equal(manifest.cases.length, 6);
  assert.deepEqual(manifest.cases.map(item => item.id), [
    'valid-report',
    'partial-report',
    'empty-category',
    'ordered-records',
    'malformed-json',
    'routing-failure'
  ]);
});
