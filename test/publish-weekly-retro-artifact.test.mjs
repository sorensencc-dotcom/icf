import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deriveProjections } from '../scripts/publish-weekly-retro-artifact.mjs';

test('deriveProjections derives correct projections from a valid report', async () => {
  const reportContent = await readFile(new URL('../reporting/test/fixtures/valid-report.json', import.meta.url), 'utf8');
  const report = JSON.parse(reportContent);

  const projections = deriveProjections(report);

  // Assert basic structure
  assert.ok(Array.isArray(projections.categories));
  assert.ok(Array.isArray(projections.evidence));
  assert.equal(projections.actions, undefined);

  // Verify categories
  assert.ok(projections.categories.length > 0);
  const deliveryCategory = projections.categories.find(c => c.id === 'delivery');
  assert.ok(deliveryCategory, 'delivery category should be present');
  assert.equal(deliveryCategory.name, 'Delivery');
  assert.match(deliveryCategory.summary, /measured from the weekly report/);

  // Verify evidence
  // Ensure that evidence contains the metrics from the valid report
  const commitsEvidence = projections.evidence.find(e => e.source === 'metrics.commits');
  assert.ok(commitsEvidence, 'evidence for metrics.commits should be present');
  assert.equal(commitsEvidence.category, 'delivery');
  assert.match(commitsEvidence.label, /commits = 37/);

  // Unavailable metrics shouldn't be in evidence (e.g. metrics that are missing or null where unexpected)
  // Prs_merged isn't part of the category contract output here, but we check length as proxy
  assert.ok(projections.evidence.length > 0);
});

test('deriveProjections handles missing/unavailable metrics gracefully', async () => {
  const reportContent = await readFile(new URL('../reporting/test/fixtures/partial-report.json', import.meta.url), 'utf8');
  const partialReport = JSON.parse(reportContent);

  const projections = deriveProjections(partialReport);

  // It shouldn't crash and should return categories with measured counts
  assert.ok(projections.categories.length > 0);
  const deliveryCategory = projections.categories.find(c => c.id === 'delivery');
  assert.ok(deliveryCategory, 'delivery category should be present');

  // Evidence should only include available metrics
  const commitsEvidence = projections.evidence.find(e => e.source === 'metrics.commits');
  assert.ok(commitsEvidence, 'metrics.commits is present in partial-report.json');
});

test('deriveProjections passes through actions if it is an array', () => {
  // Use a minimal viable structure that validly normalizes metrics
  // Using an empty object will fail normalizeCategoryMetrics validation if it enforces required fields,
  // but allowPartial: true skips many.
  // Wait, let's just supply an empty object for metrics since we know allowPartial skips everything not present.
  const report = {
    actions: [
      { type: 'create_issue', title: 'Fix bug' },
      { type: 'update_docs', title: 'Add docs' }
    ]
  };

  const projections = deriveProjections(report);
  assert.deepEqual(projections.actions, [
    { type: 'create_issue', title: 'Fix bug' },
    { type: 'update_docs', title: 'Add docs' }
  ]);
});

test('deriveProjections sets actions to undefined if it is not an array', () => {
  const report1 = { actions: 'not an array' };
  assert.equal(deriveProjections(report1).actions, undefined);

  const report2 = {};
  assert.equal(deriveProjections(report2).actions, undefined);
});
