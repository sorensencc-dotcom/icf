import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildWeeklyRetroArtifact } from '../src/publication-artifact.mjs';

test('publication artifact preserves legacy fields and adds only supplied projections', async () => {
  const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
  const artifact = buildWeeklyRetroArtifact({ report, categories: [{ id: 'delivery', name: 'Delivery' }], evidence: [{ label: 'commit abc' }], actions: [{ title: 'Review tests' }], routingFacts: { state: 'selected', selectedModel: 'local-evaluator', confidence: 0.9 } });
  assert.equal(artifact.metrics.commits, report.metrics.commits);
  assert.deepEqual(artifact.categories, [{ id: 'delivery', name: 'Delivery' }]);
  assert.deepEqual(artifact.evidence, [{ label: 'commit abc' }]);
  assert.equal(artifact.routingFacts.state, 'selected');
});

test('publication artifact rejects malformed optional projections without mutating source', async () => {
  const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
  assert.throws(() => buildWeeklyRetroArtifact({ report, actions: {} }), /actions must be an array/);
  assert.equal(report.actions, undefined);
});
