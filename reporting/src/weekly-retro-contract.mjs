/**
 * Frozen Task 1 contract for the existing weekly retro report and dashboard.
 *
 * The parent application is not part of this repository. These constants and
 * validators preserve the observed local contract so later tasks can consume
 * it without inventing an integration boundary.
 */

import {
  CATEGORY_REGISTRY,
  CATEGORY_REGISTRY_VERSION,
  CATEGORY_STATES,
  LAUNCH_CATEGORY_IDS,
  METRIC_DIRECTIONALITIES,
  normalizeCategoryMetrics,
  normalizeMetric,
  validateCategoryRegistry
} from './category-contract.mjs';
import { normalizeActions } from './action-continuity.mjs';

export {
  CATEGORY_REGISTRY,
  CATEGORY_REGISTRY_VERSION,
  CATEGORY_STATES,
  LAUNCH_CATEGORY_IDS,
  METRIC_DIRECTIONALITIES,
  normalizeCategoryMetrics,
  normalizeMetric,
  validateCategoryRegistry
};

export const API_ROUTE = '/api/reporting/weekly-retro';
export const API_SUCCESS_STATUS = 'SUCCESS';
export const API_UNAVAILABLE_STATUS = 'UNAVAILABLE';
export const DASHBOARD_ELEMENT_NAME = 'weekly-reporting-dashboard';
export const DASHBOARD_SRC_ATTRIBUTE = 'src';

export const CURRENT_REPORT_TOP_LEVEL_FIELDS = Object.freeze([
  'date',
  'window',
  'metrics',
  'authors',
  'automation',
  'version_range',
  'release_commits',
  'streak_days',
  'user_streak_days',
  'streak_anchor',
  'tweetable',
  'test_health',
  'backlog',
  'shortcut_debt',
  'note',
  'actions',
  'since',
  'until',
  'base_branch',
  'session_focus'
  , 'categories'
  , 'evidence'
  , 'routingFacts'
]);

export const CURRENT_REQUIRED_REPORT_TOP_LEVEL_FIELDS = Object.freeze([
  'date',
  'window',
  'metrics',
  'authors',
  'automation',
  'version_range',
  'release_commits',
  'streak_days',
  'user_streak_days',
  'streak_anchor',
  'tweetable',
  'test_health',
  'backlog',
  'shortcut_debt',
  'note'
]);

export const OPTIONAL_PROVENANCE_FIELDS = Object.freeze(['since', 'until', 'base_branch', 'session_focus']);
export const OPTIONAL_ACTION_FIELDS = Object.freeze(['actions']);

export const CURRENT_METRIC_FIELDS = Object.freeze([
  'commits',
  'contributors',
  'prs_merged',
  'prs_referenced',
  'insertions',
  'deletions',
  'net_loc',
  'logical_sloc_added',
  'test_loc',
  'test_ratio',
  'active_days',
  'sessions',
  'deep_sessions',
  'medium_sessions',
  'micro_sessions',
  'avg_session_minutes',
  'loc_per_session_hour',
  'feat_pct',
  'fix_pct',
  'docs_pct',
  'chore_pct',
  'peak_hour',
  'ai_assisted_commits',
  'focus_score',
  'focus_area'
]);

export const CATEGORY_FIXTURE_STATES = Object.freeze(['empty', 'success']);

const METRIC_RULES = Object.freeze({
  commits: 'nonNegativeInteger',
  contributors: 'nonNegativeInteger',
  prs_merged: 'nullableNonNegativeInteger',
  prs_referenced: 'nonNegativeInteger',
  insertions: 'integer',
  deletions: 'integer',
  net_loc: 'integer',
  logical_sloc_added: 'integer',
  test_loc: 'nonNegativeInteger',
  test_ratio: 'ratio',
  active_days: 'nonNegativeInteger',
  sessions: 'nonNegativeInteger',
  deep_sessions: 'nonNegativeInteger',
  medium_sessions: 'nonNegativeInteger',
  micro_sessions: 'nonNegativeInteger',
  avg_session_minutes: 'nonNegativeInteger',
  loc_per_session_hour: 'nonNegativeInteger',
  feat_pct: 'ratio',
  fix_pct: 'ratio',
  docs_pct: 'ratio',
  chore_pct: 'ratio',
  peak_hour: 'hour',
  ai_assisted_commits: 'nonNegativeInteger',
  focus_score: 'ratio',
  focus_area: 'string'
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function validateDate(value, errors) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    addError(errors, 'date', 'must be a YYYY-MM-DD string');
    return;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    addError(errors, 'date', 'must be a real calendar date');
  }
}

function validateMetricValue(field, value, errors) {
  const rule = METRIC_RULES[field];
  const validInteger = Number.isInteger(value);
  const validNumber = typeof value === 'number' && Number.isFinite(value);
  if (rule === 'string') {
    if (typeof value !== 'string') addError(errors, `metrics.${field}`, 'must be a string');
  } else if (rule === 'nullableNonNegativeInteger') {
    if (value !== null && (!validInteger || value < 0)) {
      addError(errors, `metrics.${field}`, 'must be a non-negative integer or null');
    }
  } else if (rule === 'nonNegativeInteger') {
    if (!validInteger || value < 0) addError(errors, `metrics.${field}`, 'must be a non-negative integer');
  } else if (rule === 'integer') {
    if (!validInteger) addError(errors, `metrics.${field}`, 'must be an integer');
  } else if (rule === 'ratio') {
    if (!validNumber || value < 0 || value > 1) addError(errors, `metrics.${field}`, 'must be a number from 0 to 1');
  } else if (rule === 'hour') {
    if (!validInteger || value < 0 || value > 23) addError(errors, `metrics.${field}`, 'must be an integer from 0 to 23');
  }
}

function validateMetricShape(metrics, { allowPartial }) {
  const errors = [];
  const missing = CURRENT_METRIC_FIELDS.filter(field => !(field in metrics));
  const unknown = Object.keys(metrics).filter(field => !CURRENT_METRIC_FIELDS.includes(field));
  for (const field of unknown) addError(errors, `metrics.${field}`, 'is not part of the frozen metric contract');
  if (!allowPartial) {
    for (const field of missing) addError(errors, `metrics.${field}`, 'is required');
  }
  for (const field of Object.keys(metrics)) {
    if (METRIC_RULES[field]) validateMetricValue(field, metrics[field], errors);
  }
  return { errors, missing };
}

function validateSessionFocus(value, errors) {
  if (!isRecord(value)) {
    addError(errors, 'session_focus', 'must be an object');
    return;
  }
  for (const field of ['summary']) {
    if (typeof value[field] !== 'string') addError(errors, `session_focus.${field}`, 'must be a string');
  }
  for (const field of ['incidents', 'process_learnings']) {
    if (!Array.isArray(value[field]) || value[field].some(item => typeof item !== 'string')) {
      addError(errors, `session_focus.${field}`, 'must be an array of strings');
    }
  }
}

function validateReportShape(report, { allowPartial }) {
  const errors = [];
  if (!isRecord(report)) return { errors: ['report: must be an object'], missing: [] };

  validateDate(report.date, errors);
  if (typeof report.window !== 'string' || report.window.length === 0) {
    addError(errors, 'window', 'must be a non-empty string');
  }
  if (!isRecord(report.metrics)) addError(errors, 'metrics', 'must be an object');

  const missingTopLevel = CURRENT_REQUIRED_REPORT_TOP_LEVEL_FIELDS.filter(field => !(field in report));
  const unknown = Object.keys(report).filter(field => !CURRENT_REPORT_TOP_LEVEL_FIELDS.includes(field));
  for (const field of unknown) addError(errors, field, 'is not part of the frozen current report contract');
  if (!allowPartial) {
    for (const field of missingTopLevel) addError(errors, field, 'is required');
  }

  const metricResult = isRecord(report.metrics)
    ? validateMetricShape(report.metrics, { allowPartial })
    : { errors: [], missing: [] };
  errors.push(...metricResult.errors);

  for (const field of ['since', 'until']) {
    if (field in report && (typeof report[field] !== 'string' || Number.isNaN(Date.parse(report[field])))) {
      addError(errors, field, 'must be an ISO timestamp');
    }
  }
  if ('base_branch' in report && (typeof report.base_branch !== 'string' || report.base_branch.length === 0)) {
    addError(errors, 'base_branch', 'must be a non-empty string');
  }
  if ('session_focus' in report) validateSessionFocus(report.session_focus, errors);
  if ('actions' in report && (!Array.isArray(report.actions) || report.actions.some(action => !isRecord(action)))) {
    addError(errors, 'actions', 'must be an array of action objects');
  } else if (Array.isArray(report.actions)) {
    try {
      normalizeActions(report, { requireStatus: true });
    } catch (error) {
      addError(errors, 'actions', error instanceof Error ? error.message : String(error));
    }
  }
  for (const field of ['categories', 'evidence']) {
    if (field in report && (!Array.isArray(report[field]) || report[field].some(item => !isRecord(item)))) {
      addError(errors, field, 'must be an array of objects');
    }
  }
  if ('routingFacts' in report && !isRecord(report.routingFacts)) addError(errors, 'routingFacts', 'must be an object');

  if ('version_range' in report &&
      (!Array.isArray(report.version_range) ||
       report.version_range.length !== 2 ||
       report.version_range.some(value => typeof value !== 'string'))) {
    addError(errors, 'version_range', 'must contain exactly two strings');
  }

  for (const field of ['authors', 'automation', 'test_health', 'backlog', 'shortcut_debt']) {
    if (field in report && !isRecord(report[field])) addError(errors, field, 'must be an object');
  }

  for (const field of ['release_commits', 'streak_days', 'user_streak_days']) {
    if (field in report && !Number.isInteger(report[field])) addError(errors, field, 'must be an integer');
  }
  for (const field of ['tweetable', 'streak_anchor']) {
    if (field in report && typeof report[field] !== 'string') addError(errors, field, 'must be a string');
  }
  if ('note' in report && report.note !== null && typeof report.note !== 'string') {
    addError(errors, 'note', 'must be a string or null');
  }

  return { errors, missing: [...missingTopLevel, ...metricResult.missing.map(field => `metrics.${field}`)] };
}

export function validateCategoryFixture(category) {
  const errors = [];
  if (!isRecord(category)) return { ok: false, errors: ['category: must be an object'] };
  if (typeof category.week_key !== 'string' || !/^\d{4}-W\d{2}$/.test(category.week_key)) {
    addError(errors, 'week_key', 'must be an ISO week key');
  }
  if (!LAUNCH_CATEGORY_IDS.includes(category.category_id)) {
    addError(errors, 'category_id', 'must be one of the launch category IDs');
  }
  if (!CATEGORY_FIXTURE_STATES.includes(category.state)) {
    addError(errors, 'state', 'must be an accepted category fixture state');
  }
  if (!Array.isArray(category.records)) addError(errors, 'records', 'must be an array');
  if (category.state === 'success' && Array.isArray(category.records) && category.records.length === 0) {
    addError(errors, 'records', 'must contain at least one record for success');
  }
  if (Array.isArray(category.records)) {
    for (const [index, record] of category.records.entries()) {
      if (!isRecord(record) || typeof record.record_id !== 'string' || record.record_id.length === 0) {
        addError(errors, `records[${index}].record_id`, 'must be a non-empty string');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateWeeklyRetroReport(report, options = {}) {
  const allowPartial = options.allowPartial === true;
  const { errors, missing } = validateReportShape(report, { allowPartial });
  const registry = options.categoryRegistry ?? CATEGORY_REGISTRY;
  const registryValidation = validateCategoryRegistry(registry);
  if (!registryValidation.ok) {
    errors.push(...registryValidation.errors.map(error => `category_registry.${error}`));
  }
  if (isRecord(report) && isRecord(report.metrics) && registryValidation.ok) {
    try {
      normalizeCategoryMetrics(report, { registry, allowPartial });
    } catch (error) {
      addError(errors, 'category_metrics', error instanceof Error ? error.message : String(error));
    }
  }
  return {
    ok: errors.length === 0,
    partial: allowPartial && missing.length > 0,
    missing,
    errors
  };
}

export function validateApiResponse(response, options = {}) {
  const errors = [];
  if (!isRecord(response)) return { ok: false, errors: ['response: must be an object'] };

  if (response.status === API_SUCCESS_STATUS) {
    if (!('data' in response)) addError(errors, 'data', 'is required for SUCCESS');
    else {
      const reportResult = validateWeeklyRetroReport(response.data, options);
      errors.push(...reportResult.errors.map(error => `data.${error}`));
    }
  } else if (response.status === API_UNAVAILABLE_STATUS) {
    if (typeof response.error !== 'string' || response.error.length === 0) {
      addError(errors, 'error', 'must be a non-empty string for UNAVAILABLE');
    }
  } else {
    addError(errors, 'status', `must be ${API_SUCCESS_STATUS} or ${API_UNAVAILABLE_STATUS}`);
  }

  return { ok: errors.length === 0, errors };
}

export function serializeApiSuccess(report) {
  const validation = validateWeeklyRetroReport(report);
  if (!validation.ok) {
    throw new TypeError(`Cannot serialize invalid weekly retro report: ${validation.errors.join('; ')}`);
  }
  return { status: API_SUCCESS_STATUS, data: report };
}

export function serializeApiUnavailable(reportPath, cause) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    status: API_UNAVAILABLE_STATUS,
    error: `Weekly retro artifact missing or unreadable at ${reportPath}: ${detail}`
  };
}
