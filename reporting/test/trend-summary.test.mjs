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
    snapshot('2026-W31', 2, 'partial'),
    snapshot('2026-W33', 3),
    snapshot('2026-W37', 5)
  ];
  const eightWeeks = computeTrend(snapshots, 8);
  assert.equal(eightWeeks.window, 8);
  assert.equal(eightWeeks.fromWeek, '2026-W30');
  assert.equal(eightWeeks.toWeek, '2026-W37');
  assert.equal(eightWeeks.status, 'partial');
  assert.equal(eightWeeks.state, 'partial');
  assert.equal(eightWeeks.complete, false);
  assert.equal(eightWeeks.completeWeeks, 2);
  assert.deepEqual(eightWeeks.missingWeeks, ['2026-W30', '2026-W32', '2026-W34', '2026-W35', '2026-W36']);
  assert.deepEqual(eightWeeks.partialWeeks, ['2026-W31']);
  assert.deepEqual(eightWeeks.weeks.map(week => [week.weekKey, week.state]), [
    ['2026-W30', 'missing'],
    ['2026-W31', 'partial'],
    ['2026-W32', 'missing'],
    ['2026-W33', 'success'],
    ['2026-W34', 'missing'],
    ['2026-W35', 'missing'],
    ['2026-W36', 'missing'],
    ['2026-W37', 'success']
  ]);
  const eightWeekCommits = eightWeeks.metrics.find(metric => metric.metricId === 'commits');
  assert.deepEqual(eightWeekCommits.values.map(value => value.value), [null, 2, null, 3, null, null, null, 5]);
  assert.equal(eightWeekCommits.sum, 10);
  assert.equal(eightWeekCommits.average, 10 / 3);
  assert.equal(eightWeekCommits.latest, 5);

  const twelveWeeks = computeTrend(snapshots, 12);
  assert.equal(twelveWeeks.window, 12);
  assert.equal(twelveWeeks.fromWeek, '2026-W26');
  assert.equal(twelveWeeks.toWeek, '2026-W37');
  assert.equal(twelveWeeks.status, 'partial');
  assert.equal(twelveWeeks.completeWeeks, 3);
  assert.deepEqual(twelveWeeks.missingWeeks, [
    '2026-W27', '2026-W28', '2026-W29', '2026-W30', '2026-W32', '2026-W34', '2026-W35', '2026-W36'
  ]);
  assert.deepEqual(twelveWeeks.partialWeeks, ['2026-W31']);
  const twelveWeekCommits = twelveWeeks.metrics.find(metric => metric.metricId === 'commits');
  assert.deepEqual(twelveWeekCommits.values.map(value => value.value), [0, null, null, null, null, 2, null, 3, null, null, null, 5]);
  assert.equal(twelveWeekCommits.sum, 10);
  assert.equal(twelveWeekCommits.average, 10 / 4);
  assert.equal(twelveWeekCommits.latest, 5);
  assert.equal(twelveWeeks.weeks[0].state, 'zero_activity');

  const insufficient = computeTrend([snapshot('2026-W37', 5)], 4);
  assert.equal(insufficient.status, 'insufficient_history');
  assert.equal(insufficient.state, 'insufficient_history');
  assert.equal(insufficient.complete, false);
  assert.equal(insufficient.completeWeeks, 1);
  assert.deepEqual(insufficient.missingWeeks, ['2026-W34', '2026-W35', '2026-W36']);
  assert.equal(computeTrend([snapshot('2026-W37', 0, 'zero_activity')], 4).weeks.at(-1).state, 'zero_activity');
});

test('classifies an empty window as incomplete partial history', () => {
  const trend = computeTrend([], { window: 4, categoryId: 'delivery', toWeek: '2026-W37' });

  assert.equal(trend.status, 'partial');
  assert.equal(trend.state, 'partial');
  assert.equal(trend.complete, false);
  assert.equal(trend.incomplete, true);
  assert.equal(trend.completeWeeks, 0);
  assert.deepEqual(trend.missingWeeks, ['2026-W34', '2026-W35', '2026-W36', '2026-W37']);
  assert.deepEqual(trend.partialWeeks, []);
  assert.deepEqual(trend.metrics.find(metric => metric.metricId === 'commits').values.map(value => value.value), [null, null, null, null]);
});
