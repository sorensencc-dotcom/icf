import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  CURRENT_METRIC_FIELDS,
  CURRENT_REPORT_TOP_LEVEL_FIELDS,
  LAUNCH_CATEGORY_IDS,
  validateApiResponse,
  validateCategoryFixture,
  validateWeeklyRetroReport
} from '../src/weekly-retro-contract.mjs';

const FIXTURES = dirname(fileURLToPath(import.meta.url));
const loadJson = async name => JSON.parse(await readFile(join(FIXTURES, 'fixtures', name), 'utf8'));

test('freezes current report field shape and deterministic source values', async () => {
  const report = await loadJson('valid-report.json');
  assert.deepEqual(Object.keys(report), CURRENT_REPORT_TOP_LEVEL_FIELDS);
  assert.deepEqual(Object.keys(report.metrics), CURRENT_METRIC_FIELDS);
  assert.equal(validateWeeklyRetroReport(report).ok, true);
  assert.equal(report.date, '2026-09-13');
  assert.equal(report.window, '7d');
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

test('freezes SUCCESS and UNAVAILABLE API response shapes', async () => {
  const report = await loadJson('valid-report.json');
  const failure = await loadJson('routing-failure.json');
  assert.deepEqual(validateApiResponse({ status: 'SUCCESS', data: report }), { ok: true, errors: [] });
  assert.deepEqual(validateApiResponse(failure), { ok: true, errors: [] });
  assert.equal(validateApiResponse({ status: 'SUCCESS' }).ok, false);
  assert.equal(validateApiResponse({ status: 'UNAVAILABLE' }).ok, false);
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
  assert.equal(manifest.cases.length, 5);
  assert.deepEqual(manifest.cases.map(item => item.id), [
    'valid-report',
    'partial-report',
    'empty-category',
    'malformed-json',
    'routing-failure'
  ]);
});
