import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { LAUNCH_CATEGORY_IDS } from './category-contract.mjs';

const DEFAULT_SCHEMA_PATH = fileURLToPath(new URL('../schema/001_snapshot_store.sql', import.meta.url));
const DEFAULT_SCHEMA_VERSION = '1.0';
const MAX_LIST_RESULTS = 100;

export class SnapshotIdentityCollisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SnapshotIdentityCollisionError';
    this.code = 'SNAPSHOT_IDENTITY_COLLISION';
  }
}

export class SnapshotRedactedError extends Error {
  constructor(identity) {
    super(`Snapshot is redacted and cannot be restored for ${formatIdentity(identity)}`);
    this.name = 'SnapshotRedactedError';
    this.code = 'SNAPSHOT_REDACTED';
  }
}

export class SnapshotNotFoundError extends Error {
  constructor(identity) {
    super(`Snapshot not found for ${formatIdentity(identity)}`);
    this.name = 'SnapshotNotFoundError';
    this.code = 'SNAPSHOT_NOT_FOUND';
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function formatIdentity(identity) {
  return `${identity.sourceId}/${identity.weekKey}/${identity.categoryId}`;
}

function normalizeString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function normalizeWeekKey(value) {
  const weekKey = normalizeString(value, 'weekKey');
  if (!/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(weekKey)) {
    throw new TypeError('weekKey must be an ISO week key from YYYY-W01 through YYYY-W53');
  }
  return weekKey;
}

function normalizeCategoryId(value) {
  const categoryId = normalizeString(value, 'categoryId');
  if (!LAUNCH_CATEGORY_IDS.includes(categoryId)) {
    throw new TypeError(`categoryId must be one of: ${LAUNCH_CATEGORY_IDS.join(', ')}`);
  }
  return categoryId;
}

function normalizeIdentity(value) {
  if (!isRecord(value)) throw new TypeError('identity must be an object');
  const sourceId = value.sourceId ?? value.source_id ?? value.sourceIdentity ?? value.source_identity;
  const weekKey = value.weekKey ?? value.week_key;
  const categoryId = value.categoryId ?? value.category_id;
  return Object.freeze({
    sourceId: normalizeString(sourceId, 'sourceId'),
    weekKey: normalizeWeekKey(weekKey),
    categoryId: normalizeCategoryId(categoryId)
  });
}

function identityFromEnvelope(envelope) {
  const candidate = envelope.identity;
  if (candidate === undefined) return null;
  if (!isRecord(candidate)) throw new TypeError('envelope.identity must be an object');
  return normalizeIdentity(candidate);
}

function normalizeEnvelope(value) {
  if (!isRecord(value)) throw new TypeError('envelope must be an object');
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`envelope must be JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (serialized === undefined) throw new TypeError('envelope must be JSON serializable');
  const parsed = JSON.parse(serialized);
  const embeddedIdentity = identityFromEnvelope(parsed);
  const schemaVersion = parsed.schemaVersion ?? parsed.schema_version ?? DEFAULT_SCHEMA_VERSION;
  normalizeString(schemaVersion, 'envelope schemaVersion');
  return { parsed, serialized, embeddedIdentity, schemaVersion };
}

function assertIdentityMatches(identity, embeddedIdentity) {
  if (!embeddedIdentity) return;
  for (const field of ['sourceId', 'weekKey', 'categoryId']) {
    if (identity[field] !== embeddedIdentity[field]) {
      throw new SnapshotIdentityCollisionError(
        `Envelope identity ${formatIdentity(embeddedIdentity)} does not match key ${formatIdentity(identity)}`
      );
    }
  }
}

function now() {
  return new Date().toISOString();
}

function rowParams(identity) {
  return [identity.sourceId, identity.weekKey, identity.categoryId];
}

function toRedaction(row) {
  if (!row.redaction_reason) return null;
  return {
    sourceId: row.source_id,
    weekKey: row.week_key,
    categoryId: row.category_id,
    reason: row.redaction_reason,
    redactedAt: row.redacted_at,
    summaryStale: true
  };
}

function toRecord(row) {
  return {
    sourceId: row.source_id,
    weekKey: row.week_key,
    categoryId: row.category_id,
    schemaVersion: row.schema_version,
    envelope: row.envelope_json === null ? null : JSON.parse(row.envelope_json),
    redacted: row.redaction_reason !== null,
    redaction: toRedaction(row),
    summaryStale: row.is_stale === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toRedactionRecord(row) {
  return {
    sourceId: row.source_id,
    weekKey: row.week_key,
    categoryId: row.category_id,
    reason: row.reason,
    redactedAt: row.redacted_at,
    summaryStale: true
  };
}

function queryRecord(db, identity) {
  return db.prepare(`
    SELECT
      e.source_id,
      e.week_key,
      e.category_id,
      e.schema_version,
      e.envelope_json,
      e.created_at,
      e.updated_at,
      s.is_stale,
      r.reason AS redaction_reason,
      r.redacted_at
    FROM snapshot_envelopes e
    JOIN snapshot_summary_state s
      ON s.source_id = e.source_id
     AND s.week_key = e.week_key
     AND s.category_id = e.category_id
    LEFT JOIN snapshot_redactions r
      ON r.source_id = e.source_id
     AND r.week_key = e.week_key
     AND r.category_id = e.category_id
    WHERE e.source_id = ? AND e.week_key = ? AND e.category_id = ?
  `).get(...rowParams(identity));
}

function withTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original error; SQLite connection failures are reported by the caller.
    }
    throw error;
  }
}

export function createSnapshotStore({ databasePath = ':memory:', schemaPath = DEFAULT_SCHEMA_PATH } = {}) {
  if (typeof databasePath !== 'string' || databasePath.length === 0) {
    throw new TypeError('databasePath must be a non-empty string');
  }
  const db = new DatabaseSync(databasePath);
  db.exec(readFileSync(schemaPath, 'utf8'));
  let closed = false;

  function ensureOpen() {
    if (closed) throw new Error('Snapshot store is closed');
  }

  return {
    upsertSnapshot(identityValue, envelopeValue) {
      ensureOpen();
      const identity = normalizeIdentity(identityValue);
      const normalizedEnvelope = normalizeEnvelope(envelopeValue);
      assertIdentityMatches(identity, normalizedEnvelope.embeddedIdentity);
      const timestamp = now();
      return withTransaction(db, () => {
        const existing = queryRecord(db, identity);
        if (existing && existing.redaction_reason !== null) throw new SnapshotRedactedError(identity);
        if (existing && existing.envelope_json === normalizedEnvelope.serialized &&
            existing.schema_version === normalizedEnvelope.schemaVersion) {
          return toRecord(existing);
        }

        if (existing) {
          db.prepare(`
            UPDATE snapshot_envelopes
            SET schema_version = ?, envelope_json = ?, updated_at = ?
            WHERE source_id = ? AND week_key = ? AND category_id = ?
          `).run(normalizedEnvelope.schemaVersion, normalizedEnvelope.serialized, timestamp, ...rowParams(identity));
          db.prepare(`
            UPDATE snapshot_summary_state
            SET is_stale = 1, stale_reason = 'snapshot_changed', updated_at = ?
            WHERE source_id = ? AND week_key = ? AND category_id = ?
          `).run(timestamp, ...rowParams(identity));
        } else {
          db.prepare(`
            INSERT INTO snapshot_envelopes
              (source_id, week_key, category_id, schema_version, envelope_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(...rowParams(identity), normalizedEnvelope.schemaVersion, normalizedEnvelope.serialized, timestamp, timestamp);
          db.prepare(`
            INSERT INTO snapshot_summary_state
              (source_id, week_key, category_id, is_stale, stale_reason, updated_at)
            VALUES (?, ?, ?, 0, NULL, ?)
          `).run(...rowParams(identity), timestamp);
        }
        return toRecord(queryRecord(db, identity));
      });
    },

    getSnapshot(identityValue) {
      ensureOpen();
      const identity = normalizeIdentity(identityValue);
      const row = queryRecord(db, identity);
      return row ? toRecord(row) : null;
    },

    listSnapshots({ fromWeek, toWeek, categoryId } = {}) {
      ensureOpen();
      if (fromWeek === undefined || toWeek === undefined) {
        throw new TypeError('fromWeek and toWeek are required for bounded snapshot queries');
      }
      const from = normalizeWeekKey(fromWeek);
      const to = normalizeWeekKey(toWeek);
      if (from > to) throw new RangeError('fromWeek must be less than or equal to toWeek');
      const category = categoryId === undefined ? null : normalizeCategoryId(categoryId);
      const rows = db.prepare(`
        SELECT
          e.source_id,
          e.week_key,
          e.category_id,
          e.schema_version,
          e.envelope_json,
          e.created_at,
          e.updated_at,
          s.is_stale,
          r.reason AS redaction_reason,
          r.redacted_at
        FROM snapshot_envelopes e
        JOIN snapshot_summary_state s
          ON s.source_id = e.source_id
         AND s.week_key = e.week_key
         AND s.category_id = e.category_id
        LEFT JOIN snapshot_redactions r
          ON r.source_id = e.source_id
         AND r.week_key = e.week_key
         AND r.category_id = e.category_id
        WHERE e.week_key >= ? AND e.week_key <= ?
          AND (? IS NULL OR e.category_id = ?)
        ORDER BY e.week_key ASC, e.source_id ASC, e.category_id ASC
        LIMIT ${MAX_LIST_RESULTS}
      `).all(from, to, category, category);
      return rows.map(toRecord);
    },

    redactSnapshot(identityValue, reasonValue) {
      ensureOpen();
      const identity = normalizeIdentity(identityValue);
      const reason = normalizeString(reasonValue, 'reason');
      const timestamp = now();
      return withTransaction(db, () => {
        const existingRedaction = db.prepare(`
          SELECT source_id, week_key, category_id, reason, redacted_at
          FROM snapshot_redactions
          WHERE source_id = ? AND week_key = ? AND category_id = ?
        `).get(...rowParams(identity));
        if (existingRedaction) return toRedactionRecord(existingRedaction);

        const existing = queryRecord(db, identity);
        if (existing) {
          db.prepare(`
            UPDATE snapshot_envelopes
            SET envelope_json = NULL, updated_at = ?
            WHERE source_id = ? AND week_key = ? AND category_id = ?
          `).run(timestamp, ...rowParams(identity));
        } else {
          db.prepare(`
            INSERT INTO snapshot_envelopes
              (source_id, week_key, category_id, schema_version, envelope_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?)
          `).run(...rowParams(identity), DEFAULT_SCHEMA_VERSION, timestamp, timestamp);
          db.prepare(`
            INSERT INTO snapshot_summary_state
              (source_id, week_key, category_id, is_stale, stale_reason, updated_at)
            VALUES (?, ?, ?, 1, 'snapshot_redacted', ?)
          `).run(...rowParams(identity), timestamp);
        }
        db.prepare(`
          INSERT INTO snapshot_redactions
            (source_id, week_key, category_id, reason, redacted_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(...rowParams(identity), reason, timestamp);
        db.prepare(`
          UPDATE snapshot_summary_state
          SET is_stale = 1, stale_reason = 'snapshot_redacted', updated_at = ?
          WHERE source_id = ? AND week_key = ? AND category_id = ?
        `).run(timestamp, ...rowParams(identity));
        return toRedactionRecord({
          source_id: identity.sourceId,
          week_key: identity.weekKey,
          category_id: identity.categoryId,
          reason,
          redacted_at: timestamp
        });
      });
    },

    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    }
  };
}

export { DEFAULT_SCHEMA_PATH, DEFAULT_SCHEMA_VERSION, MAX_LIST_RESULTS };
