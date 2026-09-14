/**
 * Frozen Task 1 contract for the existing weekly retro report and dashboard.
 *
 * The parent application is not part of this repository. These constants and
 * validators preserve the observed local contract so later tasks can consume
 * it without inventing an integration boundary.
 */

export const API_ROUTE = '/api/reporting/weekly-retro';
export const API_SUCCESS_STATUS = 'SUCCESS';
export const API_UNAVAILABLE_STATUS = 'UNAVAILABLE';
export const DASHBOARD_ELEMENT_NAME = 'weekly-reporting-dashboard';
export const DASHBOARD_SRC_ATTRIBUTE = 'src';

export const LAUNCH_CATEGORY_IDS = Object.freeze([
  'delivery',
  'quality',
  'reliability',
  'governance'
]);

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
  'note'
]);

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

export const CATEGORY_FIXTURE_STATES = Object.freeze(['empty']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function validateDate(value, errors) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    addError(errors, 'date', 'must be a YYYY-MM-DD string');
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

  const missing = CURRENT_REPORT_TOP_LEVEL_FIELDS.filter(field => !(field in report));
  const unknown = Object.keys(report).filter(field => !CURRENT_REPORT_TOP_LEVEL_FIELDS.includes(field));
  for (const field of unknown) addError(errors, field, 'is not part of the frozen current report contract');
  if (!allowPartial) {
    for (const field of missing) addError(errors, field, 'is required');
  }

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

  return { errors, missing };
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
  return { ok: errors.length === 0, errors };
}

export function validateWeeklyRetroReport(report, options = {}) {
  const allowPartial = options.allowPartial === true;
  const { errors, missing } = validateReportShape(report, { allowPartial });
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
