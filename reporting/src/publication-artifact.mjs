import { validateWeeklyRetroReport } from './weekly-retro-contract.mjs';
import { validateRoutingFacts } from './routing-telemetry.mjs';

function list(value, name) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

/** Merge validated optional projections into the unchanged legacy report shape. */
export function buildWeeklyRetroArtifact({ report, categories, evidence, actions, routingFacts } = {}) {
  const baseValidation = validateWeeklyRetroReport(report);
  if (!baseValidation.ok) throw new TypeError(`Cannot publish invalid weekly retro report: ${baseValidation.errors.join('; ')}`);
  const artifact = { ...report };
  const categoryList = list(categories, 'categories');
  const evidenceList = list(evidence, 'evidence');
  const actionList = list(actions, 'actions');
  if (categoryList !== undefined) artifact.categories = categoryList;
  if (evidenceList !== undefined) artifact.evidence = evidenceList;
  if (actionList !== undefined) artifact.actions = actionList;
  if (routingFacts !== undefined) artifact.routingFacts = validateRoutingFacts(routingFacts);
  return Object.freeze(artifact);
}
