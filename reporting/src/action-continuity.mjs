import { LAUNCH_CATEGORY_IDS } from './category-contract.mjs';

export const ACTION_STATUSES = Object.freeze([
  'open',
  'in_progress',
  'carried_over',
  'completed',
  'abandoned'
]);

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

function normalizeWeekKey(value, field = 'weekKey') {
  const weekKey = requiredString(value, field);
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(weekKey)) {
    throw new TypeError(`${field} must be an ISO week key from YYYY-W01 through YYYY-W53`);
  }
  return weekKey;
}

function normalizeStatus(value) {
  const status = requiredString(value ?? 'open', 'status').toLowerCase().replaceAll('-', '_');
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

function normalizeProvenance(action) {
  const value = firstDefined(action.provenanceLinks, action.provenance_links, action.provenance, action.links);
  if (value === undefined || value === null) return [];
  const links = Array.isArray(value) ? value : [value];
  return links.map((link, index) => {
    if (typeof link === 'string') return { url: requiredString(link, `provenanceLinks[${index}]`) };
    if (!isRecord(link)) throw new TypeError(`provenanceLinks[${index}] must be a URL string or object`);
    const url = firstDefined(link.url, link.href, link.path);
    return {
      ...link,
      url: requiredString(url, `provenanceLinks[${index}].url`)
    };
  });
}

export function normalizeAction(action, { identity = {} } = {}) {
  if (!isRecord(action)) throw new TypeError('action must be an object');
  const embedded = isRecord(action.identity) ? action.identity : {};
  const sourceSystem = requiredString(firstDefined(
    action.sourceSystem, action.source_system, embedded.sourceSystem, embedded.source_system,
    identity.sourceSystem, identity.source_system
  ), 'sourceSystem');
  const sourceId = requiredString(firstDefined(
    action.sourceId, action.source_id, action.actionId, action.action_id,
    embedded.sourceId, embedded.source_id, identity.sourceId, identity.source_id
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
    status: normalizeStatus(action.status),
    theme: themes[0] ?? null,
    themes,
    provenanceLinks: normalizeProvenance(action),
    carriedFromWeek: action.carriedFromWeek === undefined && action.carried_from_week === undefined
      ? null
      : normalizeWeekKey(firstDefined(action.carriedFromWeek, action.carried_from_week), 'carriedFromWeek')
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

export function normalizeActions(value, { identity = {} } = {}) {
  const container = isRecord(value) && isRecord(value.report) ? value :
    [value?.snapshot, value?.payload, value?.data].find(isRecord) ?? value;
  const report = isRecord(container) && isRecord(container.report) ? container.report : container;
  const entries = [];
  const direct = actionEntries(report);
  for (const action of direct) entries.push({ action, identity });
  if (isRecord(report) && Array.isArray(report.categories)) {
    for (const category of report.categories) {
      const categoryIdentity = { ...identity, categoryId: firstDefined(category.categoryId, category.category_id, identity.categoryId) };
      for (const action of actionEntries(category)) entries.push({ action, identity: categoryIdentity });
    }
  }
  return entries.map(({ action, identity: actionIdentity }) => normalizeAction(action, { identity: actionIdentity }));
}

export function createActionContinuity({ store, sourceSystem, sourceId, categoryId } = {}) {
  if (!store || typeof store.upsertAction !== 'function' || typeof store.listActions !== 'function' ||
      typeof store.carryForwardActions !== 'function') {
    throw new TypeError('A snapshot store with action continuity support is required');
  }
  const defaults = { sourceSystem, sourceId, categoryId };
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
