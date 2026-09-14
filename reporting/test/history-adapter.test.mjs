import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createHistoryAdapter, TREND_RECALCULATING_STATE } from '../src/history-adapter.mjs';
import { createSnapshotStore } from '../src/snapshot-store.mjs';
import { createReportingServer, HISTORY_API_ROUTE } from '../src/server.mjs';
import { weekRange } from '../src/trend-summary.mjs';

function identity(weekKey = '2026-W37') {
  return { sourceSystem: 'github', sourceId: 'icf-main', weekKey, categoryId: 'delivery' };
}

function envelope(commits, schemaVersion = '1.0') {
  return {
    schemaVersion,
    report: { metrics: { commits, prs_merged: null, net_loc: commits * 10 }, release_commits: 0 }
  };
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-trend-'));
  const store = createSnapshotStore({ databasePath: join(directory, 'snapshots.sqlite') });
  const history = createHistoryAdapter({ store, sourceSystem: 'github', sourceId: 'icf-main' });
  return { store, history };
}

test('returns explicit recalculating state until a materialized trend is rebuilt', async () => {
  const { store, history } = await setup();
  try {
    for (const [week, commits] of [['2026-W34', 4], ['2026-W35', 5], ['2026-W36', 6], ['2026-W37', 7]]) {
      store.upsertSnapshot(identity(week), envelope(commits));
    }

    const stale = history.getTrend({ categoryId: 'delivery', window: 4 });
    assert.equal(stale.state, TREND_RECALCULATING_STATE);

    const rebuilt = history.rebuildSummaries({
      fromWeek: '2026-W34',
      toWeek: '2026-W37',
      categoryId: 'delivery'
    });
    assert.equal(rebuilt.state, 'ready');
    assert.equal(history.getTrend({ categoryId: 'delivery', window: 4 }).state, 'ready');

    store.upsertSnapshot(identity('2026-W36'), envelope(99));
    assert.equal(history.getTrend({ categoryId: 'delivery', window: 4 }).state, TREND_RECALCULATING_STATE);

    history.rebuildSummaries({ fromWeek: '2026-W34', toWeek: '2026-W37', categoryId: 'delivery' });
    store.redactSnapshot(identity('2026-W35'), 'remove source');
    assert.equal(history.getTrend({ categoryId: 'delivery', window: 4 }).state, TREND_RECALCULATING_STATE);
  } finally {
    store.close();
  }
});

test('latest-week lookup uses the newest snapshot beyond the list cap', async () => {
  const { store, history } = await setup();
  try {
    const weeks = weekRange('2026-W37', 101);
    for (const [index, week] of weeks.entries()) {
      store.upsertSnapshot(identity(week), envelope(index + 1));
    }

    const trend = history.getTrend({ categoryId: 'delivery', window: 4 });
    assert.equal(trend.state, TREND_RECALCULATING_STATE);
    assert.equal(trend.toWeek, '2026-W37');
    assert.equal(store.getLatestSnapshotWeek({
      sourceSystem: 'github',
      sourceId: 'icf-main',
      categoryId: 'delivery'
    }), '2026-W37');
  } finally {
    store.close();
  }
});

test('new redaction invalidates overlapping summaries without a raw envelope', async () => {
  const { store, history } = await setup();
  try {
    for (const [week, commits] of [['2026-W34', 4], ['2026-W35', 5], ['2026-W36', 6], ['2026-W37', 7]]) {
      store.upsertSnapshot(identity(week), envelope(commits));
    }
    history.rebuildSummaries({ fromWeek: '2026-W30', toWeek: '2026-W37', categoryId: 'delivery' });
    assert.equal(store.getTrendSummary({
      sourceSystem: 'github',
      sourceId: 'icf-main',
      categoryId: 'delivery',
      window: 8,
      fromWeek: '2026-W30',
      toWeek: '2026-W37'
    }).isStale, false);

    const redaction = store.redactSnapshot(identity('2026-W32'), 'remove unknown snapshot');
    assert.equal(redaction.redactedAggregate, null);
    assert.equal(store.getTrendSummary({
      sourceSystem: 'github',
      sourceId: 'icf-main',
      categoryId: 'delivery',
      window: 8,
      fromWeek: '2026-W30',
      toWeek: '2026-W37'
    }).isStale, true);
    assert.equal(history.getTrend({ categoryId: 'delivery', window: 8 }).state, TREND_RECALCULATING_STATE);
  } finally {
    store.close();
  }
});

test('getTrend preserves materialized insufficient-history status', async () => {
  const { store, history } = await setup();
  try {
    store.upsertSnapshot(identity('2026-W37'), envelope(7));
    history.rebuildSummaries({ fromWeek: '2026-W34', toWeek: '2026-W37', categoryId: 'delivery' });

    const trend = history.getTrend({ categoryId: 'delivery', window: 4 });
    assert.equal(trend.state, 'insufficient_history');
    assert.equal(trend.status, 'insufficient_history');
    assert.equal(trend.summary.state, 'insufficient_history');
    assert.equal(trend.summary.status, 'insufficient_history');
    assert.equal(trend.summary.completeWeeks, 1);
  } finally {
    store.close();
  }
});

test('reader normalization invalidates a previously materialized summary', async () => {
  const { store, history } = await setup();
  try {
    for (const [week, commits] of [['2026-W34', 4], ['2026-W35', 5], ['2026-W36', 6], ['2026-W37', 7]]) {
      store.upsertSnapshot(identity(week), envelope(commits, '0.9'));
    }
    history.rebuildSummaries({ fromWeek: '2026-W34', toWeek: '2026-W37', categoryId: 'delivery' });
    assert.equal(history.getTrend({ categoryId: 'delivery', window: 4 }).state, TREND_RECALCULATING_STATE);
  } finally {
    store.close();
  }
});

test('serves bounded local history through the history API adapter', async () => {
  const { store, history } = await setup();
  const server = createReportingServer({ historyAdapter: history });
  try {
    for (const [week, commits] of [['2026-W34', 4], ['2026-W35', 5], ['2026-W36', 6], ['2026-W37', 7]]) {
      store.upsertSnapshot(identity(week), envelope(commits));
    }
    history.rebuildSummaries({ fromWeek: '2026-W34', toWeek: '2026-W37', categoryId: 'delivery' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}${HISTORY_API_ROUTE}?categoryId=delivery&window=4`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, 'SUCCESS');
    assert.equal(payload.data.state, 'ready');
    assert.equal(payload.data.summary.toWeek, '2026-W37');
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});
