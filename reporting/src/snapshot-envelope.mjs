import {
  CATEGORY_REGISTRY,
  CATEGORY_STATES,
  LAUNCH_CATEGORY_IDS,
  normalizeCategoryMetrics,
  normalizeMetric
} from './category-contract.mjs';
import { normalizeActions } from './action-continuity.mjs';

export const CURRENT_SNAPSHOT_SCHEMA_VERSION = 'current';
export const LEGACY_SNAPSHOT_SCHEMA_VERSION = 'legacy';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function normalizeState(value) {
  if (value === undefined || value === null) return null;
  const state = value === 'zero-activity' ? 'zero_activity' : value;
  if (!CATEGORY_STATES.includes(state)) throw new TypeError(`Invalid snapshot state: ${value}`);
  return state;
}

function isoWeekKeyFromDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function identityFrom(value, envelope, report, record, container = envelope) {
  const embedded = firstDefined(envelope.identity, container.identity, report.identity);
  const sourceSystem = firstDefined(
    record?.sourceSystem, record?.source_system,
    embedded?.sourceSystem, embedded?.source_system,
    container.sourceSystem, container.source_system,
    envelope.sourceSystem, envelope.source_system,
    'legacy'
  );
  const sourceId = firstDefined(
    record?.sourceId, record?.source_id,
    embedded?.sourceId, embedded?.source_id,
    container.sourceId, container.source_id,
    envelope.sourceId, envelope.source_id,
    'legacy-snapshot'
  );
  const weekKey = firstDefined(
    record?.weekKey, record?.week_key,
    embedded?.weekKey, embedded?.week_key,
    container.weekKey, container.week_key,
    envelope.weekKey, envelope.week_key,
    report.weekKey, report.week_key,
    isoWeekKeyFromDate(report.date)
  );
  const categoryId = firstDefined(
    record?.categoryId, record?.category_id,
    embedded?.categoryId, embedded?.category_id,
    container.categoryId, container.category_id,
    envelope.categoryId, envelope.category_id,
    report.categoryId, report.category_id,
    envelope.category?.id, report.category?.id
  );
  if (![sourceSystem, sourceId, weekKey, categoryId].every(item => typeof item === 'string' && item.length > 0)) {
    throw new TypeError('snapshot envelope requires source identity, week key, and category ID');
  }
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(weekKey)) {
    throw new TypeError('snapshot weekKey must be an ISO week key from YYYY-W01 through YYYY-W53');
  }
  if (!LAUNCH_CATEGORY_IDS.includes(categoryId)) {
    throw new TypeError(`snapshot categoryId must be one of: ${LAUNCH_CATEGORY_IDS.join(', ')}`);
  }
  return Object.freeze({ sourceSystem, sourceId, weekKey, categoryId });
}

function unwrap(value) {
  let record = null;
  let envelope = value;
  let canonicalMetrics = null;
  if (isRecord(value) && value.normalized === true && Array.isArray(value.metrics) && isRecord(value.identity)) {
    record = value;
    canonicalMetrics = value.metrics;
  }
  if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'envelope')) {
    record = value;
    envelope = value.envelope;
  }
  if (typeof envelope === 'string') {
    try {
      envelope = JSON.parse(envelope);
    } catch (error) {
      throw new TypeError(`snapshot envelope JSON is invalid: ${error.message}`);
    }
  }
  if (envelope === null && record) {
    return { record, envelope: {}, report: {} };
  }
  if (!isRecord(envelope)) throw new TypeError('snapshot envelope must be an object');
  const nested = [envelope.snapshot, envelope.payload, envelope.data].find(isRecord) ?? null;
  const report = isRecord(envelope.report)
    ? envelope.report
    : isRecord(nested?.report) ? nested.report
      : isRecord(nested?.data) ? nested.data
        : nested ?? envelope;
  return { record, envelope, report, canonicalMetrics, container: nested ?? envelope };
}

function explicitCategoryMetrics(report, categoryId) {
  const categories = Array.isArray(report.categories) ? report.categories : null;
  const category = categories?.find(item => item?.category_id === categoryId || item?.categoryId === categoryId)
    ?? (isRecord(report.category) ? report.category : null);
  if (!category || !Array.isArray(category.metrics)) return null;
  return category.metrics.map(metric => normalizeMetric(metric, {
    categoryId,
    registry: CATEGORY_REGISTRY,
    state: metric.state
  }));
}

function deriveState(metrics, explicitState, redacted) {
  if (explicitState) return explicitState;
  if (redacted) return 'unavailable';
  if (metrics.length === 0 || metrics.every(metric => metric.value === null)) return 'empty';
  if (metrics.some(metric => metric.state === 'partial')) return 'partial';
  if (metrics.length > 0 && metrics.every(metric => metric.state === 'zero_activity' || metric.value === 0)) {
    return 'zero_activity';
  }
  return 'success';
}

/**
 * Convert current and pre-current envelope layouts into one reader shape.
 * This function never writes or mutates the supplied historical envelope.
 */
export function normalizeSnapshot(value) {
  const { record, envelope, report, canonicalMetrics, container } = unwrap(value);
  const identity = identityFrom(value, envelope, report, record, container);
  const sourceSchemaVersion = firstDefined(
    record?.sourceSchemaVersion, record?.schemaVersion, record?.schema_version,
    envelope.schemaVersion, envelope.schema_version,
    LEGACY_SNAPSHOT_SCHEMA_VERSION
  );
  const redacted = record?.redacted === true || record?.envelope === null;
  const explicitState = normalizeState(firstDefined(
    record?.state, envelope.state, envelope.status, report.state, report.status
  ));
  let metrics = [];
  if (!redacted) {
    metrics = canonicalMetrics
      ?? explicitCategoryMetrics(report, identity.categoryId)
      ?? normalizeCategoryMetrics(report, { registry: CATEGORY_REGISTRY, allowPartial: true })
        .find(category => category.category_id === identity.categoryId)?.metrics
      ?? [];
  }
  const state = deriveState(metrics, explicitState, redacted);
  const actions = redacted ? [] : normalizeActions(envelope, { identity });
  return {
    schemaVersion: CURRENT_SNAPSHOT_SCHEMA_VERSION,
    sourceSchemaVersion: String(sourceSchemaVersion),
    identity,
    sourceSystem: identity.sourceSystem,
    sourceId: identity.sourceId,
    weekKey: identity.weekKey,
    categoryId: identity.categoryId,
    state,
    metrics,
    report: redacted ? null : report,
    originalEnvelope: envelope,
    redacted,
    redactedAggregate: record?.redactedAggregate ?? null,
    summaryStale: record?.summaryStale === true,
    actions,
    normalized: true,
    normalizationChanged: !['1.0', CURRENT_SNAPSHOT_SCHEMA_VERSION].includes(String(sourceSchemaVersion))
  };
}
