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
  duplicate.categories.push(structuredClone(duplicate.categories[0]));
  assert.equal(validateCategoryRegistry(duplicate).ok, false);

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
