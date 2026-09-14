import { LAUNCH_CATEGORY_IDS } from './category-contract.mjs';

export const ACTION_STATUSES = Object.freeze([
  'open',
  'in_progress',
  'carried_over',
  'unresolved',
  'completed',
  'abandoned'
]);

export const ACTIVE_ACTION_STATUSES = Object.freeze(['open', 'in_progress', 'carried_over', 'unresolved']);

export const MAX_ACTION_LIST_RESULTS = 100;
export const MAX_ACTION_HISTORY_RESULTS = 1000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, field);
}

export function normalizeWeekKey(value, field = 'weekKey') {
  const weekKey = requiredString(value, field);
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(weekKey)) {
    throw new TypeError(`${field} must be an ISO week key from YYYY-W01 through YYYY-W53`);
  }
  const year = Number(weekKey.slice(0, 4));
  const week = Number(weekKey.slice(6));
  if (year < 1 || week > weeksInIsoYear(year)) {
    throw new TypeError(`${field} is not a real ISO week key`);
  }
  return weekKey;
}

function weeksInIsoYear(year) {
  const januaryFirst = new Date(Date.UTC(0, 0, 1));
  januaryFirst.setUTCFullYear(year, 0, 1);
  const day = januaryFirst.getUTCDay();
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day === 4 || (day === 3 && leapYear) ? 53 : 52;
}

function isoWeekKeyFromDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function normalizeActionStatus(value) {
  const status = requiredString(value === undefined ? 'open' : value, 'status').toLowerCase().replaceAll('-', '_');
  const aliases = {
    done: 'completed',
    complete: 'completed',
    closed: 'completed',
    dropped: 'abandoned',
    dropped_abandoned: 'abandoned',
    inprogress: 'in_progress',
    carryover: 'carried_over',
    carried: 'carried_over'
  };
  const normalized = aliases[status] ?? status;
  if (!ACTION_STATUSES.includes(normalized)) {
    throw new TypeError(`status must be one of: ${ACTION_STATUSES.join(', ')}`);
  }
  return normalized;
}

function normalizeThemes(action) {
  const values = firstDefined(action.themes, action.theme);
  if (values === undefined || values === null || values === '') return [];
  const themes = Array.isArray(values) ? values : [values];
  const normalized = themes.map((theme, index) => requiredString(theme, `themes[${index}]`));
  return [...new Set(normalized)];
}

function safeUrl(value, field) {
  const url = requiredString(value, field);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`${field} must be a valid HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || /\s/.test(url)) {
    throw new TypeError(`${field} must be a safe HTTP(S) URL`);
  }
  return url;
}

function safeRelativePath(value, field) {
  const path = requiredString(value, field);
  if (path.includes('\\') || /[\u0000-\u001f]/.test(path) || path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
    throw new TypeError(`${field} must be a safe relative path`);
  }
  return path;
}

function snapshotIdentity(value, field = 'originatingSnapshot') {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  const sourceSystem = requiredString(firstDefined(value.sourceSystem, value.source_system), `${field}.sourceSystem`);
  const sourceId = requiredString(firstDefined(value.sourceId, value.source_id), `${field}.sourceId`);
  const weekKey = normalizeWeekKey(firstDefined(value.weekKey, value.week_key), `${field}.weekKey`);
  const categoryId = requiredString(firstDefined(value.categoryId, value.category_id), `${field}.categoryId`);
  if (!LAUNCH_CATEGORY_IDS.includes(categoryId)) {
    throw new TypeError(`${field}.categoryId must be one of: ${LAUNCH_CATEGORY_IDS.join(', ')}`);
  }
  return { sourceSystem, sourceId, weekKey, categoryId };
}

function sameSnapshot(left, right) {
  return left && right && ['sourceSystem', 'sourceId', 'weekKey', 'categoryId']
    .every(field => left[field] === right[field]);
}

function normalizeEvidenceRecord(value, origin, field) {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  if (Object.keys(value).length === 0) throw new TypeError(`${field} must identify an evidence record`);
  const record = value;
  const candidate = {
    sourceSystem: firstDefined(record.sourceSystem, record.source_system, origin?.sourceSystem),
    sourceId: firstDefined(record.sourceId, record.source_id, origin?.sourceId),
    weekKey: firstDefined(record.weekKey, record.week_key, origin?.weekKey),
    categoryId: firstDefined(record.categoryId, record.category_id, origin?.categoryId),
    recordId: firstDefined(record.recordId, record.record_id, record.id)
  };
  const normalized = snapshotIdentity(candidate, field);
  if (candidate.recordId !== undefined && candidate.recordId !== null) {
    normalized.recordId = requiredString(candidate.recordId, `${field}.recordId`);
  }
  if (origin && !sameSnapshot(normalized, origin)) {
    throw new TypeError(`${field} must link to the originating snapshot`);
  }
  return normalized;
}

function normalizeProvenance(action, origin) {
  const value = firstDefined(action.provenanceLinks, action.provenance_links, action.provenance, action.links);
  if (value === undefined || value === null) {
    throw new TypeError('provenanceLinks must contain at least one originating evidence record link');
  }
  const links = Array.isArray(value) ? value : [value];
  if (links.length === 0) throw new TypeError('provenanceLinks must contain at least one originating evidence record link');
  return links.map((link, index) => {
    const field = `provenanceLinks[${index}]`;
    if (typeof link === 'string') {
      return { url: safeUrl(link, field), evidenceRecord: normalizeEvidenceRecord(origin, origin, `${field}.evidenceRecord`) };
    }
    if (!isRecord(link)) throw new TypeError(`${field} must be a URL/path object linked to an evidence record`);
    const urlValue = firstDefined(link.url, link.href);
    const pathValue = link.path;
    if (urlValue === undefined && pathValue === undefined) throw new TypeError(`${field} must include url or path`);
    const evidenceValue = firstDefined(link.evidenceRecord, link.evidence_record, link.record, link.linkage);
    const evidenceRecord = evidenceValue === undefined
      ? normalizeEvidenceRecord(origin, origin, `${field}.evidenceRecord`)
      : normalizeEvidenceRecord(evidenceValue, origin, `${field}.evidenceRecord`);
    const normalized = { evidenceRecord };
    if (urlValue !== undefined) normalized.url = safeUrl(urlValue, `${field}.url`);
    if (pathValue !== undefined) normalized.path = safeRelativePath(pathValue, `${field}.path`);
    if (link.label !== undefined) normalized.label = requiredString(link.label, `${field}.label`);
    if (link.kind !== undefined) normalized.kind = requiredString(link.kind, `${field}.kind`);
    return normalized;
  });
}

export function normalizeAction(action, { identity = {}, requireStatus = false } = {}) {
  if (!isRecord(action)) throw new TypeError('action must be an object');
  if (requireStatus && !Object.prototype.hasOwnProperty.call(action, 'status')) {
    throw new TypeError('status must be provided for report actions');
  }
  const embedded = isRecord(action.identity) ? action.identity : {};
  const sourceSystem = requiredString(firstDefined(
    action.sourceSystem, action.source_system, embedded.sourceSystem, embedded.source_system,
    identity.sourceSystem, identity.source_system
  ), 'sourceSystem');
  const sourceId = requiredString(firstDefined(
    action.sourceId, action.source_id, action.actionId, action.action_id,
    embedded.sourceId, embedded.source_id
  ), 'sourceId');
  const weekKey = normalizeWeekKey(firstDefined(
    action.weekKey, action.week_key, embedded.weekKey, embedded.week_key,
    identity.weekKey, identity.week_key
  ));
  const categoryId = requiredString(firstDefined(
    action.categoryId, action.category_id, embedded.categoryId, embedded.category_id,
    identity.categoryId, identity.category_id
  ), 'categoryId');
  if (!LAUNCH_CATEGORY_IDS.includes(categoryId)) {
    throw new TypeError(`categoryId must be one of: ${LAUNCH_CATEGORY_IDS.join(', ')}`);
  }

  const wording = requiredString(firstDefined(action.wording, action.title, action.action, action.text, action.description), 'wording');
  const displayLabel = requiredString(firstDefined(
    action.displayLabel, action.display_label, action.label, wording
  ), 'displayLabel');
  const themes = normalizeThemes(action);
  const explicitOrigin = firstDefined(
    action.originatingSnapshot, action.originating_snapshot,
    action.snapshotIdentity, action.snapshot_identity
  );
  const contextOrigin = ['sourceSystem', 'sourceId', 'weekKey', 'categoryId']
    .every(field => identity[field] !== undefined && identity[field] !== null)
    ? snapshotIdentity(identity, 'originatingSnapshot')
    : null;
  const originatingSnapshot = explicitOrigin === undefined
    ? contextOrigin ?? { sourceSystem, sourceId, weekKey, categoryId }
    : snapshotIdentity(explicitOrigin);
  if (originatingSnapshot && contextOrigin && !sameSnapshot(originatingSnapshot, contextOrigin)) {
    throw new TypeError('originatingSnapshot must match the containing snapshot identity');
  }
  const carriedFromWeek = action.carriedFromWeek === undefined && action.carried_from_week === undefined
    ? null
    : normalizeWeekKey(firstDefined(action.carriedFromWeek, action.carried_from_week), 'carriedFromWeek');
  if (carriedFromWeek !== null && carriedFromWeek >= weekKey) {
    throw new RangeError('carriedFromWeek must be earlier than weekKey');
  }
  return {
    sourceSystem,
    sourceId,
    actionId: sourceId,
    weekKey,
    categoryId,
    wording,
    title: wording,
    displayLabel,
    label: displayLabel,
    owner: optionalString(action.owner, 'owner'),
    status: normalizeActionStatus(action.status),
    theme: themes[0] ?? null,
    themes,
    provenanceLinks: normalizeProvenance(action, originatingSnapshot),
    carriedFromWeek,
    originatingSnapshot
  };
}

function actionEntries(value) {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) {
    const direct = firstDefined(value.actions, value.action_items, value.actionItems, value.items);
    if (direct !== undefined) return direct;
    const nested = [value.snapshot, value.payload, value.data].find(isRecord);
    return nested ? actionEntries(nested) : [];
  }
  return [];
}

export function normalizeActions(value, { identity = {}, requireStatus = false } = {}) {
  const container = isRecord(value) && isRecord(value.report) ? value :
    [value?.snapshot, value?.payload, value?.data].find(isRecord) ?? value;
  const report = isRecord(container) && isRecord(container.report) ? container.report : container;
  const reportIdentity = isRecord(report)
    ? { ...identity, weekKey: firstDefined(identity.weekKey, identity.week_key, report.weekKey, report.week_key, isoWeekKeyFromDate(report.date)) }
    : identity;
  const entries = [];
  const direct = actionEntries(report);
  for (const action of direct) entries.push({ action, identity: reportIdentity });
  if (isRecord(report) && Array.isArray(report.categories)) {
    for (const category of report.categories) {
      const categoryIdentity = { ...reportIdentity, categoryId: firstDefined(category.categoryId, category.category_id, reportIdentity.categoryId) };
      for (const action of actionEntries(category)) entries.push({ action, identity: categoryIdentity });
    }
  }
  return entries.map(({ action, identity: actionIdentity }) => normalizeAction(action, {
    identity: actionIdentity,
    requireStatus
  }));
}

export function createActionContinuity({ store, sourceSystem, sourceId, categoryId } = {}) {
  if (!store || typeof store.upsertAction !== 'function' || typeof store.listActions !== 'function' ||
      typeof store.carryForwardActions !== 'function') {
    throw new TypeError('A snapshot store with action continuity support is required');
  }
  const defaults = { sourceSystem, categoryId };
  return {
    upsertAction(action) {
      return store.upsertAction({ ...defaults, ...action });
    },
    listActions(options = {}) {
      return store.listActions({ ...defaults, ...options });
    },
    carryForwardActions(weekKey) {
      return store.carryForwardActions({ ...defaults, weekKey });
    }
  };
}
