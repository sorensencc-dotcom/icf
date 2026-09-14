import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CATEGORY_REGISTRY,
  CATEGORY_REGISTRY_VERSION,
  CATEGORY_STATES,
  LAUNCH_CATEGORY_IDS,
  normalizeMetric,
  validateCategoryRegistry
} from '../src/category-contract.mjs';
import { validateWeeklyRetroReport } from '../src/weekly-retro-contract.mjs';

function cloneRegistry() {
  return structuredClone(CATEGORY_REGISTRY);
}

test('launch registry is versioned and carries required category metadata', () => {
  const result = validateCategoryRegistry(CATEGORY_REGISTRY);
  assert.equal(result.ok, true);
  assert.equal(result.version, CATEGORY_REGISTRY_VERSION);
  assert.deepEqual(result.categories.map(category => category.id), LAUNCH_CATEGORY_IDS);

  for (const category of result.categories) {
    assert.equal(typeof category.label, 'string');
    assert.ok(category.label.length > 0);
    assert.equal(typeof category.description, 'string');
    assert.ok(category.description.length > 0);
    assert.ok(Array.isArray(category.metrics));
    assert.ok(Array.isArray(category.required_source_fields));
    assert.ok(Array.isArray(category.quality_requirements));
    assert.equal(typeof category.supports_wow, 'boolean');
    assert.deepEqual(category.rolling_windows, [4, 8, 12]);
    assert.equal(typeof category.evidence, 'object');
    assert.equal(typeof category.state_copy.empty, 'string');
    assert.equal(typeof category.state_copy.partial, 'string');
    assert.equal(typeof category.state_copy.unavailable, 'string');
    assert.equal(typeof category.state_copy.zero_activity, 'string');
  }
});

test('every metric declares supported directionality and a source field', () => {
  const result = validateCategoryRegistry(CATEGORY_REGISTRY);
  assert.equal(result.ok, true);

  for (const category of result.categories) {
    for (const metric of category.metrics) {
      assert.ok(['higher_is_better', 'lower_is_better', 'neutral'].includes(metric.directionality));
      assert.equal(typeof metric.source_field, 'string');
      assert.ok(category.required_source_fields.includes(metric.source_field));
      assert.equal(typeof metric.calculation_rule, 'string');
    }
  }
});

test('rejects missing metadata, directionality, and source-field requirements', () => {
  const missingMetadata = cloneRegistry();
  delete missingMetadata.categories[0].description;
  const metadataResult = validateCategoryRegistry(missingMetadata);
  assert.equal(metadataResult.ok, false);
  assert.ok(metadataResult.errors.some(error => error.includes('categories[0].description')));

  const missingDirectionality = cloneRegistry();
  delete missingDirectionality.categories[0].metrics[0].directionality;
  const directionalityResult = validateCategoryRegistry(missingDirectionality);
  assert.equal(directionalityResult.ok, false);
  assert.ok(directionalityResult.errors.some(error => error.includes('directionality')));

  const missingSource = cloneRegistry();
  delete missingSource.categories[0].required_source_fields;
  const sourceResult = validateCategoryRegistry(missingSource);
  assert.equal(sourceResult.ok, false);
  assert.ok(sourceResult.errors.some(error => error.includes('required_source_fields')));
});

test('rejects duplicate, unknown, and incorrectly versioned registry entries', () => {
  const duplicate = cloneRegistry();
  duplicate.categories[3].id = duplicate.categories[0].id;
  const duplicateCategoryResult = validateCategoryRegistry(duplicate);
  assert.equal(duplicateCategoryResult.ok, false);
  assert.ok(duplicateCategoryResult.errors.some(error => error.includes('category IDs must be unique')));

  const duplicateMetric = cloneRegistry();
  duplicateMetric.categories[0].metrics.push(structuredClone(duplicateMetric.categories[0].metrics[0]));
  const duplicateMetricResult = validateCategoryRegistry(duplicateMetric);
  assert.equal(duplicateMetricResult.ok, false);
  assert.ok(duplicateMetricResult.errors.some(error => error.includes('must be unique within its category')));

  const duplicateSource = cloneRegistry();
  duplicateSource.categories[0].required_source_fields.push(duplicateSource.categories[0].required_source_fields[0]);
  const duplicateSourceResult = validateCategoryRegistry(duplicateSource);
  assert.equal(duplicateSourceResult.ok, false);
  assert.ok(duplicateSourceResult.errors.some(error => error.includes('required_source_fields') && error.includes('duplicates')));

  const duplicateMetricSource = cloneRegistry();
  duplicateMetricSource.categories[0].metrics[1].source_field = duplicateMetricSource.categories[0].metrics[0].source_field;
  const duplicateMetricSourceResult = validateCategoryRegistry(duplicateMetricSource);
  assert.equal(duplicateMetricSourceResult.ok, false);
  assert.ok(duplicateMetricSourceResult.errors.some(error => error.includes('source_field') && error.includes('unique')));

  const unknown = cloneRegistry();
  unknown.categories[0].id = 'security';
  assert.equal(validateCategoryRegistry(unknown).ok, false);

  const wrongVersion = cloneRegistry();
  wrongVersion.version = 'weekly-retro-category-registry.v2';
  assert.equal(validateCategoryRegistry(wrongVersion).ok, false);
});

test('normalizes a measured metric with direction, unit, and source provenance', () => {
  const normalized = normalizeMetric(
    { id: 'commits', value: 4 },
    { category_id: 'delivery', source: { metrics: { commits: 4 } } }
  );
  assert.deepEqual(normalized, {
    category_id: 'delivery',
    metric_id: 'commits',
    value: 4,
    unit: 'count',
    directionality: 'higher_is_better',
    source_field: 'metrics.commits',
    state: 'success'
  });
});

test('normalizes empty, partial, unavailable, and zero-activity states distinctly', () => {
  assert.deepEqual(CATEGORY_STATES, ['empty', 'partial', 'unavailable', 'success', 'zero_activity']);

  const cases = [
    ['empty', undefined, 'empty'],
    ['partial', 2, 'partial'],
    ['unavailable', undefined, 'unavailable'],
    ['success', 2, 'success'],
    ['zero_activity', 0, 'zero_activity']
  ];
  for (const [state, value, expectedState] of cases) {
    const normalized = normalizeMetric(
      { id: 'commits', ...(value === undefined ? {} : { value }) },
      { category_id: 'delivery', state, source: { metrics: { commits: value ?? null } } }
    );
    assert.equal(normalized.state, expectedState);
    assert.equal(normalized.value ?? null, value ?? null);
  }

  const partialMissing = normalizeMetric(
    { id: 'commits' },
    { category_id: 'delivery', state: 'partial', source: {} }
  );
  assert.equal(partialMissing.state, 'partial');
  assert.equal(partialMissing.value, null);

  const hyphenatedZero = normalizeMetric(
    { id: 'commits', value: 0 },
    { category_id: 'delivery', state: 'zero-activity' }
  );
  assert.equal(hyphenatedZero.state, 'zero_activity');
});

test('rejects source mismatches, unknown metrics, invalid values, and invalid states', () => {
  assert.throws(
    () => normalizeMetric({ id: 'commits', value: 1 }, { category_id: 'delivery', source: {} }),
    /metrics\.commits/
  );
  assert.throws(
    () => normalizeMetric({ id: 'unknown', value: 1 }, { category_id: 'delivery' }),
    /unknown metric/
  );
  assert.throws(
    () => normalizeMetric({ id: 'commits', value: -1 }, { category_id: 'delivery' }),
    /non-negative integer/
  );
  assert.throws(
    () => normalizeMetric({ id: 'commits', value: 0 }, { category_id: 'delivery', state: 'empty' }),
    /empty state requires a missing or null value/
  );
  assert.throws(
    () => normalizeMetric({ id: 'commits', value: 2 }, { category_id: 'delivery', state: 'zero_activity' }),
    /zero_activity state requires a zero value/
  );
  assert.throws(
    () => normalizeMetric({ id: 'commits', value: null }, { category_id: 'delivery' }),
    /non-negative integer/
  );
  assert.throws(
    () => normalizeMetric({ id: 'commits', value: 3 }, { category_id: 'delivery', source: { metrics: { commits: 2 } } }),
    /does not match source value/
  );
});

test('validates evidence drill-down shape, uniqueness, and source linkage', () => {
  const missingEvidence = cloneRegistry();
  missingEvidence.categories[0].evidence = {};
  const missingResult = validateCategoryRegistry(missingEvidence);
  assert.equal(missingResult.ok, false);

  const duplicateEvidenceSource = cloneRegistry();
  duplicateEvidenceSource.categories[0].evidence.source_fields.push(
    duplicateEvidenceSource.categories[0].evidence.source_fields[0]
  );
  const duplicateResult = validateCategoryRegistry(duplicateEvidenceSource);
  assert.equal(duplicateResult.ok, false);

  const unlinkedEvidenceSource = cloneRegistry();
  unlinkedEvidenceSource.categories[0].evidence.source_fields = ['metrics.unknown'];
  const unlinkedResult = validateCategoryRegistry(unlinkedEvidenceSource);
  assert.equal(unlinkedResult.ok, false);

  const invalidDrilldown = cloneRegistry();
  invalidDrilldown.categories[0].evidence.drilldown = 'true';
  const drilldownResult = validateCategoryRegistry(invalidDrilldown);
  assert.equal(drilldownResult.ok, false);
});

test('requires exact ordered unique rolling windows', () => {
  for (const windows of [[4, 8, 12, 16], [4, 4, 12], [12, 8, 4], ['4', 8, 12]]) {
    const registry = cloneRegistry();
    registry.categories[0].rolling_windows = windows;
    assert.equal(validateCategoryRegistry(registry).ok, false);
  }
});

test('validated report entry point rejects an invalid category registry without changing report shape', async () => {
  const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
  const invalidRegistry = cloneRegistry();
  invalidRegistry.categories[1].metrics[0].directionality = 'up';
  const result = validateWeeklyRetroReport(report, { categoryRegistry: invalidRegistry });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.startsWith('category_registry.categories[1].metrics[0].directionality')));
  assert.equal(result.missing.length, 0);
});

test('validated report entry point rejects malformed nested registry source values', async () => {
  const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
  report.test_health.total_test_files = '184';
  const result = validateWeeklyRetroReport(report);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('test_health.total_test_files')));
});

test('validated report entry point rejects an extra required nested source field', async () => {
  const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
  const registry = cloneRegistry();
  registry.categories[0].required_source_fields.push('test_health.missing_total_test_files');
  const result = validateWeeklyRetroReport(report, { categoryRegistry: registry });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('categories[0] (delivery).required_source_fields[4]')));
  assert.ok(result.errors.some(error => error.includes('test_health.missing_total_test_files')));
});

test('validated report entry point rejects an unmet runtime quality requirement', async () => {
  const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
  const registry = cloneRegistry();
  registry.categories[0].metrics[0].value_type = 'ratio';
  registry.categories[0].quality_requirements = ['metric values must use the declared numeric type'];
  const result = validateWeeklyRetroReport(report, { categoryRegistry: registry });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('categories[0] (delivery).quality_requirements[0]')));
  assert.ok(result.errors.some(error => error.includes('metrics.commits: must be a number from 0 to 1')));
});

test('validated report entry point rejects unsupported arbitrary quality requirements', async () => {
  const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
  const registry = cloneRegistry();
  registry.categories[0].quality_requirements.push('quality gate must pass');
  const result = validateWeeklyRetroReport(report, { categoryRegistry: registry });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('category_registry.categories[0].quality_requirements[2]')));
  assert.ok(result.errors.some(error => error.includes('supported runtime quality requirement')));
});

test('applies state semantics and copy across all launch categories', () => {
  for (const category of CATEGORY_REGISTRY.categories) {
    for (const state of ['empty', 'partial', 'unavailable', 'zero_activity']) {
      assert.equal(typeof category.state_copy[state], 'string');
      assert.ok(category.state_copy[state].length > 0);
    }
    const metric = category.metrics[0];
    const empty = normalizeMetric({ id: metric.id }, { category_id: category.id, state: 'empty' });
    const partial = normalizeMetric({ id: metric.id }, { category_id: category.id, state: 'partial' });
    const unavailable = normalizeMetric({ id: metric.id }, { category_id: category.id, state: 'unavailable' });
    const zero = normalizeMetric({ id: metric.id, value: 0 }, { category_id: category.id, state: 'zero_activity' });
    assert.equal(empty.state, 'empty');
    assert.equal(partial.state, 'partial');
    assert.equal(unavailable.state, 'unavailable');
    assert.equal(zero.state, 'zero_activity');
  }
});

test('normalizes every launch metric from the current validated report fixture', async () => {
  const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
  for (const category of CATEGORY_REGISTRY.categories) {
    for (const definition of category.metrics) {
      const value = definition.source_field.split('.').reduce((current, key) => current?.[key], report);
      const normalized = normalizeMetric(
        { id: definition.id, value },
        { category_id: category.id, source: report }
      );
      assert.equal(normalized.category_id, category.id);
      assert.equal(normalized.metric_id, definition.id);
      assert.equal(normalized.source_field, definition.source_field);
    }
  }
});
