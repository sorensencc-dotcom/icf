import { createHmac, timingSafeEqual } from 'node:crypto';
import { readWeeklyRetro } from '../reporting/src/server.mjs';

export const MOBILE_SCHEMA_VERSION = '1.0';
export const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function signManifest(manifest, key) {
  return createHmac('sha256', key).update(JSON.stringify(manifest)).digest('hex');
}

function verifySignature(manifest, signature, key) {
  const expected = Buffer.from(signManifest(manifest, key), 'utf8');
  const actual = Buffer.from(signature || '', 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createMobileSnapshotService({ reportPath, signingKey = process.env.ICF_SNAPSHOT_SIGNING_KEY, authToken = process.env.ICF_MOBILE_AUTH_TOKEN, staleAfterMs = DEFAULT_STALE_AFTER_MS, now = () => Date.now(), readReport = readWeeklyRetro } = {}) {
  if (!signingKey) throw new Error('ICF_SNAPSHOT_SIGNING_KEY is required');
  if (!authToken) throw new Error('ICF_MOBILE_AUTH_TOKEN is required');
  let current = null;
  let lastFailure = null;

  async function refresh() {
    try {
      const report = await readReport(reportPath);
      const createdAt = new Date(now()).toISOString();
      const manifest = { schema_version: MOBILE_SCHEMA_VERSION, snapshot_id: `${createdAt}:${report.weekKey || 'weekly-retro'}`, created_at: createdAt, source_revision: report.weekKey || 'unknown' };
      current = { manifest, data: report, signature: signManifest({ ...manifest, data: report }, signingKey) };
      lastFailure = null;
      return current;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      return current;
    }
  }

  async function getSnapshot() {
    if (!current) await refresh();
    if (!current) return null;
    const ageMs = Math.max(0, now() - Date.parse(current.manifest.created_at));
    return { ...current, freshness: ageMs <= staleAfterMs ? 'fresh' : 'stale', age_ms: ageMs, last_failure: lastFailure };
  }

  return { authToken, refresh, getSnapshot, verify: (snapshot) => Boolean(snapshot && verifySignature({ ...snapshot.manifest, data: snapshot.data }, snapshot.signature, signingKey)) };
}
