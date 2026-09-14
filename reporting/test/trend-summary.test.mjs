import assert from 'node:assert/strict';
import test from 'node:test';
import { computeTrend } from '../src/trend-summary.mjs';

function snapshot(weekKey, commits, state = 'success') {
  return {
    sourceSystem: 'github',
    sourceId: 'icf-main',
    weekKey,
    categoryId: 'delivery',
    schemaVersion: '1.0',
    state,
    report: {
      metrics: { commits, prs_merged: null, net_loc: commits * 10 },
      release_commits: 0
    }
  };
}

test('computes bounded 4-week trend with missing and partial weeks', () => {
  const trend = computeTrend([
    snapshot('2026-W34', 4),
    snapshot('2026-W36', 6, 'partial'),
    snapshot('2026-W37', 7)
  ], 4);

  assert.equal(trend.window, 4);
  assert.equal(trend.fromWeek, '2026-W34');
  assert.equal(trend.toWeek, '2026-W37');
  assert.deepEqual(trend.missingWeeks, ['2026-W35']);
  assert.deepEqual(trend.partialWeeks, ['2026-W36']);
  assert.equal(trend.status, 'partial');
  assert.deepEqual(trend.weeks.map(week => [week.weekKey, week.state]), [
    ['2026-W34', 'success'],
    ['2026-W35', 'missing'],
    ['2026-W36', 'partial'],
    ['2026-W37', 'success']
  ]);
  const commits = trend.metrics.find(metric => metric.metricId === 'commits');
  assert.deepEqual(commits.values.map(value => value.value), [4, null, 6, 7]);
  assert.equal(commits.latest, 7);
  assert.equal(commits.average, 17 / 3);
});

test('supports the contract windows 4, 8, and 12 and preserves zero activity', () => {
  const snapshots = [
    snapshot('2026-W26', 0, 'zero_activity'),
    snapshot('2026-W33', 3),
    snapshot('2026-W37', 5)
  ];
  for (const window of [4, 8, 12]) {
    const trend = computeTrend(snapshots, window);
    assert.equal(trend.window, window);
    assert.equal(trend.weeks.length, window);
  }
  assert.equal(computeTrend([snapshot('2026-W37', 5)], 4).status, 'insufficient_history');
  assert.equal(computeTrend([snapshot('2026-W37', 0, 'zero_activity')], 4).weeks.at(-1).state, 'zero_activity');
});
