const ROUTING_STATES = Object.freeze(['selected', 'fallback', 'unavailable', 'human_review_required']);
const ALLOWED_KEYS = new Set(['selectedModel', 'evaluatorScore', 'confidence', 'fallbackOutcome', 'latencyMs', 'tokenUsage', 'reviewState', 'state']);

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function optionalNumber(value, field, { integer = false } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) throw new TypeError(`${field} must be a non-negative number`);
  return value;
}
function optionalString(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 200) throw new TypeError(`${field} must be a bounded string`);
  return value;
}

export const ROUTING_FACTS_VERSION = '1.0';
export const ROUTING_STATES_LIST = ROUTING_STATES;

export function validateRoutingFacts(input) {
  if (!isRecord(input)) throw new TypeError('routing facts must be an object');
  for (const key of Object.keys(input)) if (!ALLOWED_KEYS.has(key)) throw new TypeError(`routing facts contains unsupported field: ${key}`);
  const state = input.state ?? input.reviewState ?? 'unavailable';
  if (!ROUTING_STATES.includes(state)) throw new TypeError(`state must be one of: ${ROUTING_STATES.join(', ')}`);
  const selectedModel = optionalString(input.selectedModel, 'selectedModel');
  const fallbackOutcome = optionalString(input.fallbackOutcome, 'fallbackOutcome');
  const reviewState = optionalString(input.reviewState, 'reviewState') ?? state;
  return Object.freeze({
    schemaVersion: ROUTING_FACTS_VERSION,
    state,
    selectedModel,
    evaluatorScore: optionalNumber(input.evaluatorScore, 'evaluatorScore'),
    confidence: optionalNumber(input.confidence, 'confidence'),
    fallbackOutcome,
    latencyMs: optionalNumber(input.latencyMs, 'latencyMs', { integer: true }),
    tokenUsage: optionalNumber(input.tokenUsage, 'tokenUsage', { integer: true }),
    reviewState
  });
}

export function interpretReport(report, routingFacts) {
  if (!isRecord(report)) throw new TypeError('report must be an object');
  try {
    const facts = validateRoutingFacts(routingFacts);
    return { status: facts.state === 'unavailable' ? 'INTERPRETATION_UNAVAILABLE' : 'AVAILABLE', report, routingFacts: facts };
  } catch {
    return { status: 'INTERPRETATION_UNAVAILABLE', report, routingFacts: null };
  }
}
