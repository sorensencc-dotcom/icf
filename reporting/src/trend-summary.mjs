import { CATEGORY_REGISTRY } from './category-contract.mjs';
import { normalizeSnapshot } from './snapshot-envelope.mjs';

export const SUPPORTED_TREND_WINDOWS = Object.freeze([4, 8, 12]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isoWeekDate(weekKey) {
  const [yearText, weekText] = weekKey.split('-W');
  const year = Number(yearText);
  const week = Number(weekText);
  const fourthOfJanuary = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(fourthOfJanuary);
  monday.setUTCDate(fourthOfJanuary.getUTCDate() - (fourthOfJanuary.getUTCDay() || 7) + 1 + ((week - 1) * 7));
  return monday;
}

function formatWeekKey(date) {
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstMonday = new Date(yearStart);
  firstMonday.setUTCDate(yearStart.getUTCDate() - (yearStart.getUTCDay() || 7) + 1);
  const week = Math.floor((date - firstMonday) / 604800000) + 1;
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekRange(toWeek, window) {
  const end = isoWeekDate(toWeek);
  return Array.from({ length: window }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - ((window - index - 1) * 7));
    return formatWeekKey(date);
  });
}

function metricDefinitions(categoryId) {
  const category = CATEGORY_REGISTRY.categories.find(candidate => candidate.id === categoryId);
  if (!category) throw new TypeError(`Unknown category: ${categoryId}`);
  return category.metrics;
}

function metricTrend(values) {
  const observed = values.filter(entry => typeof entry.value === 'number' && Number.isFinite(entry.value));
  if (observed.length < 2) return 'insufficient_history';
  const first = observed[0].value;
  const last = observed.at(-1).value;
  return last > first ? 'up' : last < first ? 'down' : 'flat';
}

function metricSummary(definition, weeks, snapshotsByWeek) {
  const values = weeks.map(weekKey => {
    const snapshot = snapshotsByWeek.get(weekKey);
    const metric = snapshot?.metrics.find(candidate => candidate.metric_id === definition.id);
    return {
      weekKey,
      value: metric?.value ?? null,
      state: snapshot ? (metric?.state ?? snapshot.state) : 'missing'
    };
  });
  const observed = values
    .map(entry => entry.value)
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  const sum = observed.length > 0 ? observed.reduce((total, value) => total + value, 0) : null;
  return {
    metricId: definition.id,
    metric_id: definition.id,
    label: definition.label,
    unit: definition.unit,
    directionality: definition.directionality,
    values,
    series: values,
    observedWeeks: observed.length,
    average: sum === null ? null : sum / observed.length,
    sum,
    min: observed.length > 0 ? Math.min(...observed) : null,
    max: observed.length > 0 ? Math.max(...observed) : null,
    latest: observed.length > 0 ? observed.at(-1) : null,
    trend: metricTrend(values)
  };
}

function normalizedInput(snapshots) {
  if (!Array.isArray(snapshots)) throw new TypeError('snapshots must be an array');
  return snapshots.map(normalizeSnapshot);
}

/**
 * Build a deterministic rolling summary. Missing calendar weeks stay visible
 * as slots, and null/partial values never become zeroes.
 */
export function computeTrend(snapshots, windowOrOptions) {
  const options = isRecord(windowOrOptions) ? windowOrOptions : { window: windowOrOptions };
  const window = options.window;
  if (!SUPPORTED_TREND_WINDOWS.includes(window)) {
    throw new RangeError(`window must be one of: ${SUPPORTED_TREND_WINDOWS.join(', ')}`);
  }
  const normalized = normalizedInput(snapshots);
  if (normalized.length === 0) {
    return {
      categoryId: options.categoryId ?? null,
      window,
      fromWeek: null,
      toWeek: null,
      status: 'insufficient_history',
      state: 'insufficient_history',
      missingWeeks: [],
      partialWeeks: [],
      unavailableWeeks: [],
      completeWeeks: 0,
      weeks: [],
      metrics: []
    };
  }
  const categoryId = options.categoryId ?? normalized[0].categoryId;
  if (normalized.some(snapshot => snapshot.categoryId !== categoryId)) {
    throw new TypeError('trend snapshots must share one categoryId');
  }
  const toWeek = options.toWeek ?? normalized.reduce((latest, snapshot) => snapshot.weekKey > latest ? snapshot.weekKey : latest, normalized[0].weekKey);
  const weeks = weekRange(toWeek, window);
  const snapshotsByWeek = new Map();
  for (const snapshot of normalized) {
    if (snapshot.weekKey <= toWeek && weeks.includes(snapshot.weekKey)) snapshotsByWeek.set(snapshot.weekKey, snapshot);
  }
  const weekRecords = weeks.map(weekKey => {
    const snapshot = snapshotsByWeek.get(weekKey);
    return {
      weekKey,
      state: snapshot?.state ?? 'missing',
      snapshot: snapshot ?? null,
      metrics: snapshot?.metrics ?? []
    };
  });
  const missingWeeks = weekRecords.filter(week => week.state === 'missing').map(week => week.weekKey);
  const partialWeeks = weekRecords.filter(week => week.state === 'partial').map(week => week.weekKey);
  const unavailableWeeks = weekRecords.filter(week => week.state === 'unavailable').map(week => week.weekKey);
  const completeWeeks = weekRecords.filter(week => ['success', 'zero_activity'].includes(week.state)).length;
  const status = completeWeeks < 2
    ? 'insufficient_history'
    : missingWeeks.length > 0 || partialWeeks.length > 0 || unavailableWeeks.length > 0
      ? 'partial'
      : 'complete';
  return {
    categoryId,
    window,
    fromWeek: weeks[0],
    toWeek,
    status,
    state: status,
    complete: status === 'complete',
    completeWeeks,
    missingWeeks,
    partialWeeks,
    unavailableWeeks,
    weeks: weekRecords,
    metrics: metricDefinitions(categoryId).map(definition => metricSummary(definition, weeks, snapshotsByWeek))
  };
}

export { formatWeekKey, isoWeekDate, weekRange };
