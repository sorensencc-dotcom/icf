import { LAUNCH_CATEGORY_IDS } from './category-contract.mjs';
import { normalizeSnapshot } from './snapshot-envelope.mjs';
import { computeTrend, SUPPORTED_TREND_WINDOWS, weekRange } from './trend-summary.mjs';

export const TREND_RECALCULATING_STATE = 'TrendRecalculating';

function normalizeSource(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function recalculate({ categoryId, window, fromWeek = null, toWeek = null, reason }) {
  return {
    state: TREND_RECALCULATING_STATE,
    status: 'recalculating',
    categoryId,
    window,
    fromWeek,
    toWeek,
    reason,
    summary: null
  };
}

function currentSourceVersion(snapshot) {
  return ['1.0', 'current'].includes(snapshot.sourceSchemaVersion);
}

export function createHistoryAdapter({ store, sourceSystem, sourceId, toWeek = null } = {}) {
  if (!store || typeof store.listSnapshots !== 'function') throw new TypeError('A local snapshot store is required');
  const configuredSourceSystem = normalizeSource(sourceSystem, 'sourceSystem');
  const configuredSourceId = normalizeSource(sourceId, 'sourceId');

  function readSnapshots(categoryId, from, to) {
    const rows = store.listSnapshots({
      fromWeek: from,
      toWeek: to,
      categoryId,
      sourceSystem: configuredSourceSystem,
      sourceId: configuredSourceId
    });
    const snapshots = rows.map(normalizeSnapshot);
    for (const snapshot of snapshots) {
      if (!currentSourceVersion(snapshot)) {
        store.invalidateSummaries({
          sourceSystem: configuredSourceSystem,
          sourceId: configuredSourceId,
          categoryId,
          weekKey: snapshot.weekKey,
          reason: 'snapshot_normalized'
        });
      }
    }
    return snapshots;
  }

  function latestWeek(categoryId) {
    const rows = store.listSnapshots({
      fromWeek: '0001-W01',
      toWeek: '9999-W53',
      categoryId,
      sourceSystem: configuredSourceSystem,
      sourceId: configuredSourceId
    });
    return rows.reduce((latest, row) => !latest || row.weekKey > latest ? row.weekKey : latest, null);
  }

  return {
    getTrend({ categoryId, window } = {}) {
      if (!LAUNCH_CATEGORY_IDS.includes(categoryId)) throw new TypeError(`Unknown category: ${categoryId}`);
      if (!SUPPORTED_TREND_WINDOWS.includes(window)) throw new RangeError(`window must be one of: ${SUPPORTED_TREND_WINDOWS.join(', ')}`);
      const resolvedToWeek = toWeek ?? latestWeek(categoryId);
      if (!resolvedToWeek) return recalculate({ categoryId, window, reason: 'no_snapshot_history' });
      const resolvedFromWeek = weekRange(resolvedToWeek, window)[0];
      readSnapshots(categoryId, resolvedFromWeek, resolvedToWeek);
      const persisted = store.getTrendSummary({
        sourceSystem: configuredSourceSystem,
        sourceId: configuredSourceId,
        categoryId,
        window,
        fromWeek: resolvedFromWeek,
        toWeek: resolvedToWeek
      });
      if (!persisted || persisted.isStale) {
        return recalculate({
          categoryId,
          window,
          fromWeek: resolvedFromWeek,
          toWeek: resolvedToWeek,
          reason: persisted?.staleReason ?? 'summary_missing'
        });
      }
      return {
        ...persisted.summary,
        state: 'ready',
        status: 'ready',
        categoryId,
        window,
        summary: persisted.summary
      };
    },

    rebuildSummaries({ fromWeek, toWeek: requestedToWeek, categoryId } = {}) {
      if (!LAUNCH_CATEGORY_IDS.includes(categoryId)) throw new TypeError(`Unknown category: ${categoryId}`);
      if (typeof fromWeek !== 'string' || typeof requestedToWeek !== 'string') {
        throw new TypeError('fromWeek, toWeek, and categoryId are required to rebuild summaries');
      }
      const window = weekRange(requestedToWeek, 12).indexOf(fromWeek) >= 0
        ? weekRange(requestedToWeek, 12).length - weekRange(requestedToWeek, 12).indexOf(fromWeek)
        : null;
      if (!SUPPORTED_TREND_WINDOWS.includes(window)) {
        throw new RangeError('rebuild range must be exactly 4, 8, or 12 weeks');
      }
      const snapshots = readSnapshots(categoryId, fromWeek, requestedToWeek);
      const summary = computeTrend(snapshots, { categoryId, window, toWeek: requestedToWeek });
      const saved = store.saveTrendSummary({
        sourceSystem: configuredSourceSystem,
        sourceId: configuredSourceId,
        summary
      });
      return { state: 'ready', status: 'ready', rebuilt: 1, summary: saved.summary };
    }
  };
}
