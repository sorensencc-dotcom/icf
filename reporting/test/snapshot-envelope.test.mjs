import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSnapshot } from '../src/snapshot-envelope.mjs';

function legacyEnvelope(overrides = {}) {
  return {
    schema_version: '0.9',
    source_system: 'github',
    source_id: 'icf-main',
    week_key: '2026-W37',
    category_id: 'delivery',
    snapshot: {
      date: '2026-09-13',
      metrics: { commits: 7, prs_merged: null },
      release_commits: 1
    },
    ...overrides
  };
}

test('normalizes a legacy nested envelope into the current snapshot shape', () => {
  const snapshot = normalizeSnapshot(legacyEnvelope());

  assert.equal(snapshot.schemaVersion, 'current');
  assert.equal(snapshot.sourceSchemaVersion, '0.9');
  assert.deepEqual(snapshot.identity, {
    sourceSystem: 'github',
    sourceId: 'icf-main',
    weekKey: '2026-W37',
    categoryId: 'delivery'
  });
  assert.equal(snapshot.state, 'partial');
  assert.deepEqual(
    snapshot.metrics.find(metric => metric.metric_id === 'commits'),
    {
      category_id: 'delivery',
      metric_id: 'commits',
      value: 7,
      unit: 'count',
      directionality: 'higher_is_better',
      source_field: 'metrics.commits',
      state: 'success'
    }
  );
  assert.equal(snapshot.originalEnvelope.schema_version, '0.9');
});

test('normalizes explicit empty, partial, and zero-activity states without rewriting history', () => {
  const empty = normalizeSnapshot(legacyEnvelope({ state: 'empty', snapshot: { metrics: {} } }));
  const partial = normalizeSnapshot(legacyEnvelope({ state: 'partial' }));
  const zero = normalizeSnapshot(legacyEnvelope({
    state: 'zero-activity',
    snapshot: { metrics: { commits: 0, prs_merged: null, net_loc: 0 }, release_commits: 0 }
  }));

  assert.equal(empty.state, 'empty');
  assert.equal(partial.state, 'partial');
  assert.equal(zero.state, 'zero_activity');
  assert.equal(zero.metrics.find(metric => metric.metric_id === 'commits').value, 0);
  assert.equal(zero.sourceSchemaVersion, '0.9');
});
