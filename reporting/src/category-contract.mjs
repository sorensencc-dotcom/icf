/**
 * Versioned category and metric contract for weekly retro reporting.
 *
 * This module is intentionally independent from publication and storage. It
 * describes what a category means, validates registry changes, and normalizes
 * one measured metric without inventing source data.
 */

export const CATEGORY_REGISTRY_VERSION = '1.0';

export const LAUNCH_CATEGORY_IDS = Object.freeze([
  'delivery',
  'quality',
  'reliability',
  'governance'
]);

export const CATEGORY_STATES = Object.freeze([
  'empty',
  'partial',
  'unavailable',
  'success',
  'zero_activity'
]);

export const METRIC_DIRECTIONALITIES = Object.freeze([
  'higher_is_better',
  'lower_is_better',
  'neutral'
]);

const REGISTRY_KEYS = new Set(['version', 'categories']);
const CATEGORY_KEYS = new Set([
  'id',
  'label',
  'description',
  'metrics',
  'required_source_fields',
  'quality_requirements',
  'supports_wow',
  'rolling_windows',
  'evidence',
  'state_copy'
]);
const METRIC_KEYS = new Set([
  'id',
  'label',
  'unit',
  'directionality',
  'calculation_rule',
  'source_field',
  'value_type'
]);
const EVIDENCE_KEYS = new Set(['drilldown', 'source_fields']);
const REQUIRED_ROLLING_WINDOWS = Object.freeze([4, 8, 12]);
const SUPPORTED_QUALITY_REQUIREMENTS = new Set([
  'source fields must be present in the validated report',
  'metric values must use the declared numeric type',
  'ratio values must be bounded from 0 to 1',
  'test health must identify the total test-file count',
  'activity counts must be non-negative integers',
  'streak fields must be present even when their value is zero',
  'participation and debt counts must be non-negative integers',
  'documentation share must be bounded from 0 to 1'
]);

const CATEGORY_DEFINITIONS = [
  {
    id: 'delivery',
    label: 'Delivery',
    description: 'Completed work and shipped change during the reporting window.',
    metrics: [
      {
        id: 'commits',
        label: 'Commits',
        unit: 'count',
        directionality: 'higher_is_better',
        calculation_rule: 'Count validated commits in the reporting window.',
        source_field: 'metrics.commits',
        value_type: 'non_negative_integer'
      },
      {
        id: 'prs_merged',
        label: 'Pull requests merged',
        unit: 'count',
        directionality: 'higher_is_better',
        calculation_rule: 'Count merged pull requests; null means source did not provide the measure.',
        source_field: 'metrics.prs_merged',
        value_type: 'nullable_non_negative_integer'
      },
      {
        id: 'net_loc',
        label: 'Net LOC',
        unit: 'lines',
        directionality: 'neutral',
        calculation_rule: 'Insertions minus deletions from the validated report.',
        source_field: 'metrics.net_loc',
        value_type: 'integer'
      },
      {
        id: 'release_commits',
        label: 'Release commits',
        unit: 'count',
        directionality: 'higher_is_better',
        calculation_rule: 'Count release commits in the reporting window.',
        source_field: 'release_commits',
        value_type: 'non_negative_integer'
      }
    ],
    required_source_fields: [
      'metrics.commits',
      'metrics.prs_merged',
      'metrics.net_loc',
      'release_commits'
    ],
    quality_requirements: [
      'source fields must be present in the validated report',
      'metric values must use the declared numeric type'
    ],
    supports_wow: true,
    rolling_windows: [4, 8, 12],
    evidence: { drilldown: true, source_fields: ['metrics.commits', 'metrics.prs_merged', 'metrics.net_loc', 'release_commits'] },
    state_copy: {
      empty: 'No delivery data for this period.',
      partial: 'Partial delivery data; affected metrics are marked.',
      unavailable: 'Delivery data unavailable for this period.',
      zero_activity: 'Zero delivery activity recorded for this period.'
    }
  },
  {
    id: 'quality',
    label: 'Quality',
    description: 'Test investment and change-quality signals from the reporting window.',
    metrics: [
      {
        id: 'test_ratio',
        label: 'Test ratio',
        unit: 'ratio',
        directionality: 'higher_is_better',
        calculation_rule: 'Test LOC divided by total logical LOC, expressed from 0 to 1.',
        source_field: 'metrics.test_ratio',
        value_type: 'ratio'
      },
      {
        id: 'test_loc',
        label: 'Test LOC',
        unit: 'lines',
        directionality: 'higher_is_better',
        calculation_rule: 'Count test lines added in the validated report.',
        source_field: 'metrics.test_loc',
        value_type: 'non_negative_integer'
      },
      {
        id: 'fix_pct',
        label: 'Fix share',
        unit: 'ratio',
        directionality: 'neutral',
        calculation_rule: 'Share of commits classified as fixes, expressed from 0 to 1.',
        source_field: 'metrics.fix_pct',
        value_type: 'ratio'
      },
      {
        id: 'test_health.total_test_files',
        label: 'Test files',
        unit: 'count',
        directionality: 'higher_is_better',
        calculation_rule: 'Count test files recorded by test health.',
        source_field: 'test_health.total_test_files',
        value_type: 'non_negative_integer'
      }
    ],
    required_source_fields: [
      'metrics.test_ratio',
      'metrics.test_loc',
      'metrics.fix_pct',
      'test_health.total_test_files'
    ],
    quality_requirements: [
      'ratio values must be bounded from 0 to 1',
      'test health must identify the total test-file count'
    ],
    supports_wow: true,
    rolling_windows: [4, 8, 12],
    evidence: { drilldown: true, source_fields: ['metrics.test_ratio', 'metrics.test_loc', 'metrics.fix_pct', 'test_health.total_test_files'] },
    state_copy: {
      empty: 'No quality data for this period.',
      partial: 'Partial quality data; affected metrics are marked.',
      unavailable: 'Quality data unavailable for this period.',
      zero_activity: 'Zero quality activity recorded for this period.'
    }
  },
  {
    id: 'reliability',
    label: 'Reliability',
    description: 'Continuity and operating cadence signals from the reporting window.',
    metrics: [
      {
        id: 'active_days',
        label: 'Active days',
        unit: 'count',
        directionality: 'neutral',
        calculation_rule: 'Count distinct active days in the reporting window.',
        source_field: 'metrics.active_days',
        value_type: 'non_negative_integer'
      },
      {
        id: 'sessions',
        label: 'Sessions',
        unit: 'count',
        directionality: 'neutral',
        calculation_rule: 'Count recorded work sessions in the reporting window.',
        source_field: 'metrics.sessions',
        value_type: 'non_negative_integer'
      },
      {
        id: 'streak_days',
        label: 'Streak days',
        unit: 'days',
        directionality: 'higher_is_better',
        calculation_rule: 'Use the validated current streak-day count.',
        source_field: 'streak_days',
        value_type: 'non_negative_integer'
      },
      {
        id: 'user_streak_days',
        label: 'User streak days',
        unit: 'days',
        directionality: 'higher_is_better',
        calculation_rule: 'Use the validated user streak-day count.',
        source_field: 'user_streak_days',
        value_type: 'non_negative_integer'
      }
    ],
    required_source_fields: [
      'metrics.active_days',
      'metrics.sessions',
      'streak_days',
      'user_streak_days'
    ],
    quality_requirements: [
      'activity counts must be non-negative integers',
      'streak fields must be present even when their value is zero'
    ],
    supports_wow: true,
    rolling_windows: [4, 8, 12],
    evidence: { drilldown: true, source_fields: ['metrics.active_days', 'metrics.sessions', 'streak_days', 'user_streak_days'] },
    state_copy: {
      empty: 'No reliability data for this period.',
      partial: 'Partial reliability data; affected metrics are marked.',
      unavailable: 'Reliability data unavailable for this period.',
      zero_activity: 'Zero reliability activity recorded for this period.'
    }
  },
  {
    id: 'governance',
    label: 'Governance',
    description: 'Participation, documentation, and shortcut-debt signals from the reporting window.',
    metrics: [
      {
        id: 'contributors',
        label: 'Contributors',
        unit: 'count',
        directionality: 'neutral',
        calculation_rule: 'Count contributors represented in the validated report.',
        source_field: 'metrics.contributors',
        value_type: 'non_negative_integer'
      },
      {
        id: 'docs_pct',
        label: 'Documentation share',
        unit: 'ratio',
        directionality: 'higher_is_better',
        calculation_rule: 'Share of commits classified as documentation, expressed from 0 to 1.',
        source_field: 'metrics.docs_pct',
        value_type: 'ratio'
      },
      {
        id: 'shortcut_debt.markers_found',
        label: 'Shortcut-debt markers',
        unit: 'count',
        directionality: 'lower_is_better',
        calculation_rule: 'Count shortcut-debt markers found in the validated report.',
        source_field: 'shortcut_debt.markers_found',
        value_type: 'non_negative_integer'
      }
    ],
    required_source_fields: [
      'metrics.contributors',
      'metrics.docs_pct',
      'shortcut_debt.markers_found'
    ],
    quality_requirements: [
      'participation and debt counts must be non-negative integers',
      'documentation share must be bounded from 0 to 1'
    ],
    supports_wow: true,
    rolling_windows: [4, 8, 12],
    evidence: { drilldown: true, source_fields: ['metrics.contributors', 'metrics.docs_pct', 'shortcut_debt.markers_found'] },
    state_copy: {
      empty: 'No governance data for this period.',
      partial: 'Partial governance data; affected metrics are marked.',
      unavailable: 'Governance data unavailable for this period.',
      zero_activity: 'Zero governance activity recorded for this period.'
    }
  }
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const CATEGORY_REGISTRY = deepFreeze({
  version: CATEGORY_REGISTRY_VERSION,
  categories: CATEGORY_DEFINITIONS
});

export const DEFAULT_CATEGORY_REGISTRY = CATEGORY_REGISTRY;
export const WEEKLY_RETRO_CATEGORY_REGISTRY = CATEGORY_REGISTRY;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function validateString(value, path, errors) {
  if (typeof value !== 'string' || value.length === 0) addError(errors, path, 'must be a non-empty string');
}

function validateKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, `${path}.${key}`, 'is not part of the category registry contract');
  }
}

function validateCategory(category, index, errors) {
  const path = `categories[${index}]`;
  if (!isRecord(category)) {
    addError(errors, path, 'must be an object');
    return;
  }
  validateKeys(category, CATEGORY_KEYS, path, errors);
  validateString(category.id, `${path}.id`, errors);
  if (!LAUNCH_CATEGORY_IDS.includes(category.id)) addError(errors, `${path}.id`, 'must be one of the launch category IDs');
  validateString(category.label, `${path}.label`, errors);
  validateString(category.description, `${path}.description`, errors);
  if (!Array.isArray(category.metrics) || category.metrics.length === 0) {
    addError(errors, `${path}.metrics`, 'must be a non-empty array');
  }
  if (!Array.isArray(category.required_source_fields) || category.required_source_fields.length === 0) {
    addError(errors, `${path}.required_source_fields`, 'must be a non-empty array');
  } else {
    for (const [fieldIndex, field] of category.required_source_fields.entries()) {
      validateString(field, `${path}.required_source_fields[${fieldIndex}]`, errors);
    }
    if (new Set(category.required_source_fields).size !== category.required_source_fields.length) {
      addError(errors, `${path}.required_source_fields`, 'must not contain duplicates');
    }
  }
  if (!Array.isArray(category.quality_requirements) || category.quality_requirements.length === 0) {
    addError(errors, `${path}.quality_requirements`, 'must be a non-empty array');
  } else {
    for (const [requirementIndex, requirement] of category.quality_requirements.entries()) {
      validateString(requirement, `${path}.quality_requirements[${requirementIndex}]`, errors);
      if (typeof requirement === 'string' && !SUPPORTED_QUALITY_REQUIREMENTS.has(requirement)) {
        addError(errors, `${path}.quality_requirements[${requirementIndex}]`, 'is not a supported runtime quality requirement');
      }
    }
  }
  if (typeof category.supports_wow !== 'boolean') addError(errors, `${path}.supports_wow`, 'must be a boolean');
  if (!Array.isArray(category.rolling_windows) ||
      category.rolling_windows.length !== REQUIRED_ROLLING_WINDOWS.length ||
      category.rolling_windows.some((window, index) => window !== REQUIRED_ROLLING_WINDOWS[index])) {
    addError(errors, `${path}.rolling_windows`, 'must equal [4, 8, 12] in ascending order');
  }
  if (!isRecord(category.evidence)) {
    addError(errors, `${path}.evidence`, 'must be an object');
  } else {
    validateKeys(category.evidence, EVIDENCE_KEYS, `${path}.evidence`, errors);
    if (typeof category.evidence.drilldown !== 'boolean') {
      addError(errors, `${path}.evidence.drilldown`, 'must be a boolean');
    }
    if (!Array.isArray(category.evidence.source_fields) || category.evidence.source_fields.length === 0) {
      addError(errors, `${path}.evidence.source_fields`, 'must be a non-empty array');
    } else {
      for (const [fieldIndex, field] of category.evidence.source_fields.entries()) {
        validateString(field, `${path}.evidence.source_fields[${fieldIndex}]`, errors);
        if (Array.isArray(category.required_source_fields) && !category.required_source_fields.includes(field)) {
          addError(errors, `${path}.evidence.source_fields[${fieldIndex}]`, 'must link to a required source field');
        }
      }
      if (new Set(category.evidence.source_fields).size !== category.evidence.source_fields.length) {
        addError(errors, `${path}.evidence.source_fields`, 'must not contain duplicates');
      }
    }
  }
  if (!isRecord(category.state_copy)) {
    addError(errors, `${path}.state_copy`, 'must be an object');
  } else {
    for (const state of ['empty', 'partial', 'unavailable', 'zero_activity']) {
      validateString(category.state_copy[state], `${path}.state_copy.${state}`, errors);
    }
  }

  if (Array.isArray(category.metrics)) {
    const metricIds = new Set();
    const metricSourceFields = new Set();
    for (const [metricIndex, metric] of category.metrics.entries()) {
      const metricPath = `${path}.metrics[${metricIndex}]`;
      if (!isRecord(metric)) {
        addError(errors, metricPath, 'must be an object');
        continue;
      }
      validateKeys(metric, METRIC_KEYS, metricPath, errors);
      validateString(metric.id, `${metricPath}.id`, errors);
      if (metricIds.has(metric.id)) addError(errors, `${metricPath}.id`, 'must be unique within its category');
      metricIds.add(metric.id);
      validateString(metric.label, `${metricPath}.label`, errors);
      validateString(metric.unit, `${metricPath}.unit`, errors);
      if (!METRIC_DIRECTIONALITIES.includes(metric.directionality)) {
        addError(errors, `${metricPath}.directionality`, 'must be higher_is_better, lower_is_better, or neutral');
      }
      validateString(metric.calculation_rule, `${metricPath}.calculation_rule`, errors);
      validateString(metric.source_field, `${metricPath}.source_field`, errors);
      if (metricSourceFields.has(metric.source_field)) {
        addError(errors, `${metricPath}.source_field`, 'must be unique within its category');
      }
      metricSourceFields.add(metric.source_field);
      if (Array.isArray(category.required_source_fields) && !category.required_source_fields.includes(metric.source_field)) {
        addError(errors, `${metricPath}.source_field`, 'must be listed in required_source_fields');
      }
      if (!['non_negative_integer', 'nullable_non_negative_integer', 'integer', 'ratio'].includes(metric.value_type)) {
        addError(errors, `${metricPath}.value_type`, 'must declare a supported value type');
      }
    }
  }
}

export function validateCategoryRegistry(registry) {
  const errors = [];
  if (!isRecord(registry)) return { ok: false, errors: ['registry: must be an object'] };
  validateKeys(registry, REGISTRY_KEYS, 'registry', errors);
  if (registry.version !== CATEGORY_REGISTRY_VERSION) {
    addError(errors, 'version', `must equal ${CATEGORY_REGISTRY_VERSION}`);
  }
  if (!Array.isArray(registry.categories) || registry.categories.length !== LAUNCH_CATEGORY_IDS.length) {
    addError(errors, 'categories', `must contain exactly ${LAUNCH_CATEGORY_IDS.length} categories`);
  } else {
    const ids = registry.categories.map(category => category?.id);
    if (new Set(ids).size !== ids.length) addError(errors, 'categories', 'category IDs must be unique');
    if (ids.some((id, index) => id !== LAUNCH_CATEGORY_IDS[index])) {
      addError(errors, 'categories', `must use launch order: ${LAUNCH_CATEGORY_IDS.join(', ')}`);
    }
    registry.categories.forEach((category, index) => validateCategory(category, index, errors));
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    version: registry.version,
    categories: registry.categories,
    byId: Object.freeze(Object.fromEntries(registry.categories.map(category => [category.id, category])))
  };
}

function getPath(source, path) {
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined || !(key in Object(current))) return undefined;
    return current[key];
  }, source);
}

function valueIsValid(value, valueType) {
  if (valueType === 'nullable_non_negative_integer') {
    return value === null || (Number.isInteger(value) && value >= 0);
  }
  if (valueType === 'non_negative_integer') return Number.isInteger(value) && value >= 0;
  if (valueType === 'integer') return Number.isInteger(value);
  if (valueType === 'ratio') return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  return false;
}

function valueError(valueType) {
  if (valueType === 'ratio') return 'must be a number from 0 to 1';
  if (valueType === 'integer') return 'must be an integer';
  if (valueType === 'nullable_non_negative_integer') return 'must be a non-negative integer or null';
  return 'must be a non-negative integer';
}

function enforceRequiredSourceFields(source, category, categoryIndex, { allowPartial }) {
  for (const [fieldIndex, field] of category.required_source_fields.entries()) {
    if (getPath(source, field) === undefined && !allowPartial) {
      throw new TypeError(
        `categories[${categoryIndex}] (${category.id}).required_source_fields[${fieldIndex}] (${field}): required source field is missing`
      );
    }
  }
}

function enforceQualityRequirement(source, category, categoryIndex, requirementIndex, requirement, { allowPartial }) {
  const context = `categories[${categoryIndex}] (${category.id}).quality_requirements[${requirementIndex}] (${requirement})`;
  const fail = message => { throw new TypeError(`${context}: ${message}`); };
  const definitions = category.metrics;
  const values = definitions.map(definition => ({
    definition,
    value: getPath(source, definition.source_field)
  }));
  const presentValues = values.filter(({ value }) => value !== undefined || !allowPartial);

  if (requirement === 'source fields must be present in the validated report') return;

  if (requirement === 'metric values must use the declared numeric type') {
    for (const { definition, value } of presentValues) {
      if (!valueIsValid(value, definition.value_type)) {
        fail(`${definition.source_field}: ${valueError(definition.value_type)}`);
      }
    }
    return;
  }

  if (requirement === 'ratio values must be bounded from 0 to 1') {
    for (const { definition, value } of presentValues.filter(({ definition }) => definition.value_type === 'ratio')) {
      if (!valueIsValid(value, 'ratio')) fail(`${definition.source_field}: must be a number from 0 to 1`);
    }
    return;
  }

  if (requirement === 'test health must identify the total test-file count') {
    const value = getPath(source, 'test_health.total_test_files');
    if (value === undefined && allowPartial) return;
    if (!valueIsValid(value, 'non_negative_integer')) {
      fail('test_health.total_test_files: must be a non-negative integer');
    }
    return;
  }

  if (requirement === 'activity counts must be non-negative integers' ||
      requirement === 'participation and debt counts must be non-negative integers') {
    const countValues = requirement === 'participation and debt counts must be non-negative integers'
      ? presentValues.filter(({ definition }) => ['contributors', 'shortcut_debt.markers_found'].includes(definition.id))
      : presentValues;
    for (const { definition, value } of countValues) {
      if (!valueIsValid(value, 'non_negative_integer')) {
        fail(`${definition.source_field}: must be a non-negative integer`);
      }
    }
    return;
  }

  if (requirement === 'streak fields must be present even when their value is zero') {
    for (const field of ['streak_days', 'user_streak_days']) {
      if (getPath(source, field) === undefined && !allowPartial) fail(`${field}: required source field is missing`);
    }
    return;
  }

  if (requirement === 'documentation share must be bounded from 0 to 1') {
    const value = getPath(source, 'metrics.docs_pct');
    if (value === undefined && allowPartial) return;
    if (!valueIsValid(value, 'ratio')) fail('metrics.docs_pct: must be a number from 0 to 1');
  }
}

function enforceQualityRequirements(source, category, categoryIndex, { allowPartial }) {
  for (const [requirementIndex, requirement] of category.quality_requirements.entries()) {
    enforceQualityRequirement(source, category, categoryIndex, requirementIndex, requirement, { allowPartial });
  }
}

export function normalizeCategoryMetrics(source, { registry = CATEGORY_REGISTRY, allowPartial = false } = {}) {
  const registryValidation = validateCategoryRegistry(registry);
  if (!registryValidation.ok) {
    throw new TypeError(`Cannot normalize categories with invalid registry: ${registryValidation.errors.join('; ')}`);
  }
  if (!isRecord(source)) throw new TypeError('Report source must be an object');

  return registryValidation.categories.map((category, categoryIndex) => {
    enforceRequiredSourceFields(source, category, categoryIndex, { allowPartial });
    enforceQualityRequirements(source, category, categoryIndex, { allowPartial });
    return {
      category_id: category.id,
      metrics: category.metrics.map(definition => {
        const value = getPath(source, definition.source_field);
        if (value === undefined && allowPartial) {
          return normalizeMetric(
            { id: definition.id },
            { category_id: category.id, state: 'partial', source, registry }
          );
        }
        return normalizeMetric(
          { id: definition.id, value },
          { category_id: category.id, source, registry }
        );
      })
    };
  });
}

function findCategory(categoryId, registry) {
  const result = validateCategoryRegistry(registry);
  if (!result.ok) throw new TypeError(`Cannot normalize metric with invalid registry: ${result.errors.join('; ')}`);
  const category = result.byId[categoryId];
  if (!category) throw new TypeError(`Unknown category: ${categoryId}`);
  return category;
}

export function normalizeMetric(metric, context = {}) {
  if (!isRecord(metric)) throw new TypeError('Metric must be an object');
  const categoryId = context.category_id ?? context.categoryId ?? metric.category_id;
  if (typeof categoryId !== 'string') throw new TypeError('Metric context requires category_id');
  const category = findCategory(categoryId, context.registry ?? CATEGORY_REGISTRY);
  const metricId = metric.id ?? metric.metric_id;
  const definition = category.metrics.find(candidate => candidate.id === metricId);
  if (!definition) throw new TypeError(`unknown metric ${metricId} for category ${categoryId}`);
  if ('source_field' in metric && metric.source_field !== definition.source_field) {
    throw new TypeError(`${metricId}: source_field does not match the registry`);
  }

  const requestedStateValue = context.state ?? context.status ?? metric.state;
  const requestedState = requestedStateValue === 'zero-activity' ? 'zero_activity' : requestedStateValue;
  const state = requestedState ?? ('value' in metric && metric.value === 0 ? 'zero_activity' : 'success');
  if (!CATEGORY_STATES.includes(state)) throw new TypeError(`Invalid metric state: ${state}`);
  const hasValue = Object.prototype.hasOwnProperty.call(metric, 'value');
  const value = hasValue ? metric.value : null;
  if ((state === 'empty' || state === 'unavailable') && hasValue && value !== null) {
    throw new TypeError(`${metricId}: ${state} state requires a missing or null value`);
  }
  if ((state === 'success' || state === 'zero_activity') && !hasValue) {
    throw new TypeError(`${metricId}: ${state} state requires a value`);
  }
  const nullAllowedByState = ['empty', 'partial', 'unavailable'].includes(state);
  if (hasValue && !(value === null && nullAllowedByState) && !valueIsValid(value, definition.value_type)) {
    throw new TypeError(`${metricId}: ${valueError(definition.value_type)}`);
  }
  if (state === 'zero_activity' && value !== 0) {
    throw new TypeError(`${metricId}: zero_activity state requires a zero value`);
  }

  const source = context.source ?? context.report;
  if (source !== undefined) {
    const sourceValue = getPath(source, definition.source_field);
    if ((state === 'success' || state === 'zero_activity') && sourceValue === undefined) {
      throw new TypeError(`${definition.source_field}: required source field is missing`);
    }
    if (hasValue && sourceValue !== undefined && !Object.is(value, sourceValue)) {
      throw new TypeError(`${metricId}: value does not match source value at ${definition.source_field}`);
    }
  }

  return {
    category_id: categoryId,
    metric_id: metricId,
    value,
    unit: definition.unit,
    directionality: definition.directionality,
    source_field: definition.source_field,
    state
  };
}
