import { publishWeeklyRetroSnapshot } from './server.mjs';
import { buildWeeklyRetroArtifact } from './publication-artifact.mjs';

export const WEEKLY_RETRO_WRITER_FLAG = 'ICF_WEEKLY_RETRO_WRITER_ENABLED';

function flagEnabled(value) {
  return value === true || value === '1' || value === 'true' || value === 'TRUE';
}

/** Publish only after generation and validation succeed. Reader availability is independent. */
export async function publishWeeklyRetro({ readReport, store, identity, writerEnabled = false, categories, evidence, actions, routingFacts }) {
  if (!flagEnabled(writerEnabled)) {
    return { status: 'WRITER_DISABLED', published: false };
  }
  if (typeof readReport !== 'function') throw new TypeError('A report generator is required');
  const report = buildWeeklyRetroArtifact({ report: await readReport(), categories, evidence, actions, routingFacts });
  const record = publishWeeklyRetroSnapshot({ store, identity, report });
  return { status: 'PUBLISHED', published: true, record };
}

export function writerEnabledFromEnvironment(environment = process.env) {
  return flagEnabled(environment[WEEKLY_RETRO_WRITER_FLAG]);
}
