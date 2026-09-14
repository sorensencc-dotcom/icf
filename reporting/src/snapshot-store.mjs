import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAUNCH_CATEGORY_IDS } from './category-contract.mjs';
import { computeTrend } from './trend-summary.mjs';

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (error) {
  throw new Error(
    'icf-weekly-retro-reporting requires Node.js >=22.5.0 with node:sqlite support',
    { cause: error }
  );
}
if (typeof DatabaseSync !== 'function') {
  throw new Error('icf-weekly-retro-reporting requires DatabaseSync from node:sqlite');
}

const DEFAULT_SCHEMA_PATH = fileURLToPath(new URL('../schema/001_snapshot_store.sql', import.meta.url));
const DEFAULT_MIGRATION_PATH = fileURLToPath(new URL('../schema/002_snapshot_store_source_system.sql', import.meta.url));
const DEFAULT_SUMMARY_MIGRATION_PATH = fileURLToPath(new URL('../schema/003_snapshot_trend_summaries.sql', import.meta.url));
const DEFAULT_SCHEMA_VERSION = '1.0';
const CURRENT_SCHEMA_VERSION = 3;
const LEGACY_SOURCE_SYSTEM = 'legacy';
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
  return `${identity.sourceSystem}/${identity.sourceId}/${identity.weekKey}/${identity.categoryId}`;
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
  const sourceSystem = value.sourceSystem ?? value.source_system;
  const sourceId = value.sourceId ?? value.source_id ?? value.sourceIdentity ?? value.source_identity;
  const weekKey = value.weekKey ?? value.week_key;
  const categoryId = value.categoryId ?? value.category_id;
  return Object.freeze({
    sourceSystem: normalizeString(sourceSystem, 'sourceSystem'),
    sourceId: normalizeString(sourceId, 'sourceId'),
    weekKey: normalizeWeekKey(weekKey),
    categoryId: normalizeCategoryId(categoryId)
  });
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalizeJson(value[key])])
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalizeJson(value));
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
    throw new TypeError(
      `envelope.toJSON output validation failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (serialized === undefined) {
    throw new TypeError('envelope.toJSON output validation failed: must produce a JSON object');
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new TypeError(
      `envelope.toJSON output validation failed: invalid JSON (${error instanceof Error ? error.message : String(error)})`
    );
  }
  if (!isRecord(parsed)) {
    throw new TypeError('envelope.toJSON output validation failed: must produce a JSON object');
  }

  const canonicalParsed = canonicalizeJson(parsed);
  const embeddedIdentity = identityFromEnvelope(canonicalParsed);
  const schemaVersion = canonicalParsed.schemaVersion ?? canonicalParsed.schema_version ?? DEFAULT_SCHEMA_VERSION;
  normalizeString(schemaVersion, 'envelope schemaVersion');
  return {
    parsed: canonicalParsed,
    serialized: canonicalJson(canonicalParsed),
    embeddedIdentity,
    schemaVersion
  };
}

function assertIdentityMatches(identity, embeddedIdentity) {
  if (!embeddedIdentity) return;
  for (const field of ['sourceSystem', 'sourceId', 'weekKey', 'categoryId']) {
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

function hasTable(db, tableName) {
  return db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName) !== undefined;
}

function tableColumns(db, tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map(column => column.name));
}

function migrationVersion(db) {
  if (!hasTable(db, 'schema_migrations')) return 0;
  return db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version;
}

function hasCurrentSchema(db) {
  if (!hasTable(db, 'snapshot_envelopes') ||
      !hasTable(db, 'snapshot_summary_state') ||
      !hasTable(db, 'snapshot_redactions')) {
    return false;
  }
  return [
    ['snapshot_envelopes', 'source_system'],
    ['snapshot_summary_state', 'source_system'],
    ['snapshot_redactions', 'source_system', 'aggregate_json']
  ].every(([tableName, ...columns]) => {
    const existingColumns = tableColumns(db, tableName);
    return columns.every(column => existingColumns.has(column));
  });
}

function hasSummarySchema(db) {
  if (!hasTable(db, 'snapshot_trend_summaries')) return false;
  return ['source_system', 'source_id', 'category_id', 'window', 'from_week', 'to_week', 'summary_json', 'is_stale']
    .every(column => tableColumns(db, 'snapshot_trend_summaries').has(column));
}

function recordMigration(db, version, name) {
  db.prepare(`
    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (?, ?, ?)
  `).run(version, name, now());
}

function migrateSchema(db, schemaPath) {
  if (!hasTable(db, 'snapshot_envelopes')) {
    db.exec(readFileSync(schemaPath, 'utf8'));
  } else if (!hasTable(db, 'schema_migrations')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
    recordMigration(db, 1, 'snapshot_store');
  }

  if (!hasTable(db, 'schema_migrations')) {
    throw new Error('snapshot store schema did not create schema_migrations');
  }

  const appliedVersion = migrationVersion(db);
  if (!hasCurrentSchema(db)) {
    if (appliedVersion >= CURRENT_SCHEMA_VERSION) {
      throw new Error('snapshot store migration metadata is ahead of the physical schema');
    }
    const migrationPath = schemaPath === DEFAULT_SCHEMA_PATH
      ? DEFAULT_MIGRATION_PATH
      : join(dirname(schemaPath), '002_snapshot_store_source_system.sql');
    const migrationSql = readFileSync(migrationPath, 'utf8');
    try {
      db.exec(migrationSql);
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the original migration error.
      }
      throw error;
    }
  } else if (appliedVersion < CURRENT_SCHEMA_VERSION) {
    recordMigration(db, 2, 'snapshot_store_source_system');
  }

  if (!hasSummarySchema(db)) {
    const summaryMigrationPath = schemaPath === DEFAULT_SCHEMA_PATH
      ? DEFAULT_SUMMARY_MIGRATION_PATH
      : join(dirname(schemaPath), '003_snapshot_trend_summaries.sql');
    try {
      db.exec(readFileSync(summaryMigrationPath, 'utf8'));
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the original migration error.
      }
      throw error;
    }
  } else if (migrationVersion(db) < CURRENT_SCHEMA_VERSION) {
    recordMigration(db, CURRENT_SCHEMA_VERSION, 'snapshot_trend_summaries');
  }

  db.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
}

function rowParams(identity) {
  return [identity.sourceSystem, identity.sourceId, identity.weekKey, identity.categoryId];
}

function projectNumericRecord(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.keys(value).sort()
      .filter(key => value[key] === null || (typeof value[key] === 'number' && Number.isFinite(value[key])))
      .map(key => [key, value[key]])
  );
}

function projectStringRecord(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.keys(value).sort()
      .filter(key => typeof value[key] === 'string' && value[key].trim().length > 0)
      .map(key => [key, value[key]])
  );
}

function redactedAggregateProjection(envelope) {
  const report = isRecord(envelope.report) ? envelope.report : envelope;
  const declared = isRecord(envelope.aggregate)
    ? envelope.aggregate
    : isRecord(report.aggregate) ? report.aggregate : null;
  const counts = {
    ...projectNumericRecord(report.metrics),
    ...projectNumericRecord(report.test_health),
    ...projectNumericRecord(report.backlog),
    ...projectNumericRecord(report.shortcut_debt)
  };
  for (const key of ['release_commits', 'streak_days', 'user_streak_days']) {
    if (report[key] === null || (typeof report[key] === 'number' && Number.isFinite(report[key]))) {
      counts[key] = report[key];
    }
  }
  if (declared) Object.assign(counts, projectNumericRecord(declared.counts));
  const summaries = declared ? projectStringRecord(declared.summaries) : {};
  const projection = {};
  if (Object.keys(counts).length > 0) projection.counts = counts;
  if (Object.keys(summaries).length > 0) projection.summaries = summaries;
  return Object.keys(projection).length > 0 ? canonicalizeJson(projection) : null;
}

function toRedaction(row) {
  if (row.redaction_reason === null || row.redaction_reason === undefined) return null;
  return {
    sourceSystem: row.source_system,
    sourceId: row.source_id,
    weekKey: row.week_key,
    categoryId: row.category_id,
    reason: row.redaction_reason,
    redactedAt: row.redacted_at,
    summaryStale: true
  };
}

function parseAggregate(row) {
  return row.aggregate_json === null || row.aggregate_json === undefined
    ? null
    : JSON.parse(row.aggregate_json);
}

function toRecord(row) {
  const redacted = row.redaction_reason !== null && row.redaction_reason !== undefined;
  return {
    sourceSystem: row.source_system,
    sourceId: row.source_id,
    weekKey: row.week_key,
    categoryId: row.category_id,
    schemaVersion: row.schema_version ?? DEFAULT_SCHEMA_VERSION,
    envelope: row.envelope_json === null || row.envelope_json === undefined ? null : JSON.parse(row.envelope_json),
    redactedAggregate: parseAggregate(row),
    redacted,
    redaction: toRedaction(row),
    summaryStale: redacted || row.is_stale === 1,
    createdAt: row.created_at ?? row.redacted_at,
    updatedAt: row.updated_at ?? row.redacted_at
  };
}

function toRedactionRecord(row) {
  return {
    sourceSystem: row.source_system,
    sourceId: row.source_id,
    weekKey: row.week_key,
    categoryId: row.category_id,
    reason: row.reason,
    redactedAt: row.redacted_at,
    redactedAggregate: parseAggregate(row),
    summaryStale: true
  };
}

const IDENTITY_QUERY = `
  WITH identities AS (
    SELECT source_system, source_id, week_key, category_id
    FROM snapshot_envelopes
    UNION
    SELECT source_system, source_id, week_key, category_id
    FROM snapshot_redactions
  )
  SELECT
    i.source_system,
    i.source_id,
    i.week_key,
    i.category_id,
    e.schema_version,
    e.envelope_json,
    e.created_at,
    e.updated_at,
    s.is_stale,
    r.reason AS redaction_reason,
    r.aggregate_json,
    r.redacted_at
  FROM identities i
  LEFT JOIN snapshot_envelopes e
    ON e.source_system = i.source_system
   AND e.source_id = i.source_id
   AND e.week_key = i.week_key
   AND e.category_id = i.category_id
  LEFT JOIN snapshot_summary_state s
    ON s.source_system = i.source_system
   AND s.source_id = i.source_id
   AND s.week_key = i.week_key
   AND s.category_id = i.category_id
  LEFT JOIN snapshot_redactions r
    ON r.source_system = i.source_system
   AND r.source_id = i.source_id
   AND r.week_key = i.week_key
   AND r.category_id = i.category_id
`;

function queryRecord(db, identity) {
  return db.prepare(`${IDENTITY_QUERY} WHERE i.source_system = ? AND i.source_id = ? AND i.week_key = ? AND i.category_id = ?`)
    .get(...rowParams(identity));
}

function withTransaction(db, operation, callback, beforeCommit) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    beforeCommit?.({ operation, phase: 'before_commit' });
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

function invalidateSummaryRows(db, { sourceSystem, sourceId, weekKey, fromWeek, toWeek, categoryId, reason }) {
  const clauses = [];
  const params = [];
  if (sourceSystem !== undefined) {
    clauses.push('source_system = ?');
    params.push(sourceSystem);
  }
  if (sourceId !== undefined) {
    clauses.push('source_id = ?');
    params.push(sourceId);
  }
  if (categoryId !== undefined) {
    clauses.push('category_id = ?');
    params.push(categoryId);
  }
  if (weekKey !== undefined) {
    clauses.push('from_week <= ? AND to_week >= ?');
    params.push(weekKey, weekKey);
  }
  if (fromWeek !== undefined && toWeek !== undefined) {
    clauses.push('from_week <= ? AND to_week >= ?');
    params.push(toWeek, fromWeek);
  }
  if (clauses.length === 0) throw new TypeError('summary invalidation requires an identity, week, or range');
  const result = db.prepare(`
    UPDATE snapshot_trend_summaries
    SET is_stale = 1, stale_reason = ?, updated_at = ?
    WHERE ${clauses.join(' AND ')}
  `).run(reason, now(), ...params);
  return result.changes;
}

function summaryKey(summary, identity) {
  if (!summary || typeof summary !== 'object') throw new TypeError('summary must be an object');
  const window = Number(summary.window);
  if (![4, 8, 12].includes(window)) throw new RangeError('summary window must be one of: 4, 8, 12');
  const fromWeek = normalizeWeekKey(summary.fromWeek);
  const toWeek = normalizeWeekKey(summary.toWeek);
  if (fromWeek > toWeek) throw new RangeError('summary fromWeek must be less than or equal to toWeek');
  return { ...identity, window, fromWeek, toWeek };
}

export function createSnapshotStore({
  databasePath = ':memory:',
  schemaPath = DEFAULT_SCHEMA_PATH,
  onBeforeCommit = null
} = {}) {
  if (typeof databasePath !== 'string' || databasePath.length === 0) {
    throw new TypeError('databasePath must be a non-empty string');
  }
  if (onBeforeCommit !== null && typeof onBeforeCommit !== 'function') {
    throw new TypeError('onBeforeCommit must be a function when provided');
  }
  const db = new DatabaseSync(databasePath);
  migrateSchema(db, schemaPath);
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
      return withTransaction(db, 'upsertSnapshot', () => {
        const existing = queryRecord(db, identity);
        if (existing && existing.redaction_reason !== null && existing.redaction_reason !== undefined) {
          throw new SnapshotRedactedError(identity);
        }
        if (existing && existing.envelope_json === normalizedEnvelope.serialized &&
            existing.schema_version === normalizedEnvelope.schemaVersion) {
          return toRecord(existing);
        }

        if (existing) {
          db.prepare(`
            UPDATE snapshot_envelopes
            SET schema_version = ?, envelope_json = ?, updated_at = ?
            WHERE source_system = ? AND source_id = ? AND week_key = ? AND category_id = ?
          `).run(normalizedEnvelope.schemaVersion, normalizedEnvelope.serialized, timestamp, ...rowParams(identity));
          db.prepare(`
            UPDATE snapshot_summary_state
            SET is_stale = 1, stale_reason = 'snapshot_changed', updated_at = ?
            WHERE source_system = ? AND source_id = ? AND week_key = ? AND category_id = ?
          `).run(timestamp, ...rowParams(identity));
          invalidateSummaryRows(db, {
            ...identity,
            weekKey: identity.weekKey,
            reason: 'snapshot_changed'
          });
        } else {
          db.prepare(`
            INSERT INTO snapshot_envelopes
              (source_system, source_id, week_key, category_id, schema_version, envelope_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(...rowParams(identity), normalizedEnvelope.schemaVersion, normalizedEnvelope.serialized, timestamp, timestamp);
          db.prepare(`
            INSERT INTO snapshot_summary_state
              (source_system, source_id, week_key, category_id, is_stale, stale_reason, updated_at)
            VALUES (?, ?, ?, ?, 0, NULL, ?)
          `).run(...rowParams(identity), timestamp);
          invalidateSummaryRows(db, {
            ...identity,
            weekKey: identity.weekKey,
            reason: 'snapshot_upserted'
          });
        }
        return toRecord(queryRecord(db, identity));
      }, onBeforeCommit);
    },

    getSnapshot(identityValue) {
      ensureOpen();
      const identity = normalizeIdentity(identityValue);
      const row = queryRecord(db, identity);
      return row ? toRecord(row) : null;
    },

    listSnapshots({ fromWeek, toWeek, categoryId, sourceSystem, sourceId, order = 'asc', limit = MAX_LIST_RESULTS } = {}) {
      ensureOpen();
      if (fromWeek === undefined || toWeek === undefined) {
        throw new TypeError('fromWeek and toWeek are required for bounded snapshot queries');
      }
      const from = normalizeWeekKey(fromWeek);
      const to = normalizeWeekKey(toWeek);
      if (from > to) throw new RangeError('fromWeek must be less than or equal to toWeek');
      const category = categoryId === undefined ? null : normalizeCategoryId(categoryId);
      const system = sourceSystem === undefined ? null : normalizeString(sourceSystem, 'sourceSystem');
      const source = sourceId === undefined ? null : normalizeString(sourceId, 'sourceId');
      if (!['asc', 'desc'].includes(order)) throw new TypeError('order must be asc or desc');
      if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
      const boundedLimit = Math.min(limit, MAX_LIST_RESULTS);
      const sortDirection = order === 'desc' ? 'DESC' : 'ASC';
      const rows = db.prepare(`
        ${IDENTITY_QUERY}
        WHERE i.week_key >= ? AND i.week_key <= ?
          AND (? IS NULL OR i.category_id = ?)
          AND (? IS NULL OR i.source_system = ?)
          AND (? IS NULL OR i.source_id = ?)
        ORDER BY i.week_key ${sortDirection}, i.source_system ${sortDirection}, i.source_id ${sortDirection}, i.category_id ${sortDirection}
        LIMIT ${boundedLimit}
      `).all(from, to, category, category, system, system, source, source);
      return rows.map(toRecord);
    },

    getLatestSnapshotWeek({ categoryId, sourceSystem, sourceId } = {}) {
      ensureOpen();
      const category = normalizeCategoryId(categoryId);
      const system = normalizeString(sourceSystem, 'sourceSystem');
      const source = normalizeString(sourceId, 'sourceId');
      const row = db.prepare(`
        ${IDENTITY_QUERY}
        WHERE i.week_key >= '0001-W01' AND i.week_key <= '9999-W53'
          AND i.category_id = ?
          AND i.source_system = ?
          AND i.source_id = ?
        ORDER BY i.week_key DESC
        LIMIT 1
      `).get(category, system, source);
      return row?.week_key ?? null;
    },

    invalidateSummaries(filter = {}) {
      ensureOpen();
      const normalized = { ...filter };
      for (const field of ['sourceSystem', 'sourceId', 'categoryId']) {
        if (normalized[field] !== undefined) {
          normalized[field] = field === 'categoryId'
            ? normalizeCategoryId(normalized[field])
            : normalizeString(normalized[field], field);
        }
      }
      if (normalized.weekKey !== undefined) normalized.weekKey = normalizeWeekKey(normalized.weekKey);
      if (normalized.fromWeek !== undefined) normalized.fromWeek = normalizeWeekKey(normalized.fromWeek);
      if (normalized.toWeek !== undefined) normalized.toWeek = normalizeWeekKey(normalized.toWeek);
      return withTransaction(db, 'invalidateSummaries', () => invalidateSummaryRows(db, normalized));
    },

    getTrendSummary({ sourceSystem, sourceId, categoryId, window, fromWeek, toWeek } = {}) {
      ensureOpen();
      const identity = normalizeIdentity({ sourceSystem, sourceId, weekKey: toWeek, categoryId });
      const key = summaryKey({ window, fromWeek, toWeek }, identity);
      const row = db.prepare(`
        SELECT summary_json, is_stale, stale_reason, updated_at
        FROM snapshot_trend_summaries
        WHERE source_system = ? AND source_id = ? AND category_id = ?
          AND window = ? AND from_week = ? AND to_week = ?
      `).get(identity.sourceSystem, identity.sourceId, identity.categoryId, key.window, key.fromWeek, key.toWeek);
      if (!row) return null;
      return {
        summary: JSON.parse(row.summary_json),
        isStale: row.is_stale === 1,
        staleReason: row.stale_reason,
        updatedAt: row.updated_at
      };
    },

    saveTrendSummary({ sourceSystem, sourceId, summary } = {}) {
      ensureOpen();
      const identity = normalizeIdentity({
        sourceSystem,
        sourceId,
        weekKey: summary?.toWeek,
        categoryId: summary?.categoryId
      });
      const key = summaryKey(summary, identity);
      const serialized = canonicalJson(summary);
      const timestamp = now();
      return withTransaction(db, 'saveTrendSummary', () => {
        db.prepare(`
          INSERT INTO snapshot_trend_summaries
            (source_system, source_id, category_id, window, from_week, to_week, summary_json, is_stale, stale_reason, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
          ON CONFLICT (source_system, source_id, category_id, window, from_week, to_week)
          DO UPDATE SET summary_json = excluded.summary_json, is_stale = 0, stale_reason = NULL, updated_at = excluded.updated_at
        `).run(identity.sourceSystem, identity.sourceId, identity.categoryId, key.window, key.fromWeek, key.toWeek, serialized, timestamp);
        return { state: 'ready', status: 'ready', updatedAt: timestamp, summary: JSON.parse(serialized) };
      });
    },

    redactSnapshot(identityValue, reasonValue) {
      ensureOpen();
      const identity = normalizeIdentity(identityValue);
      const reason = normalizeString(reasonValue, 'reason');
      const timestamp = now();
      return withTransaction(db, 'redactSnapshot', () => {
        const existingRedaction = db.prepare(`
          SELECT source_system, source_id, week_key, category_id, reason, aggregate_json, redacted_at
          FROM snapshot_redactions
          WHERE source_system = ? AND source_id = ? AND week_key = ? AND category_id = ?
        `).get(...rowParams(identity));
        if (existingRedaction) return toRedactionRecord(existingRedaction);

        const existing = queryRecord(db, identity);
        const aggregate = existing?.envelope_json === null || existing?.envelope_json === undefined
          ? null
          : redactedAggregateProjection(JSON.parse(existing.envelope_json));
        if (existing?.envelope_json !== null && existing?.envelope_json !== undefined) {
          db.prepare(`
            UPDATE snapshot_envelopes
            SET envelope_json = NULL, updated_at = ?
            WHERE source_system = ? AND source_id = ? AND week_key = ? AND category_id = ?
          `).run(timestamp, ...rowParams(identity));
          const summaryUpdate = db.prepare(`
            UPDATE snapshot_summary_state
            SET is_stale = 1, stale_reason = 'snapshot_redacted', updated_at = ?
            WHERE source_system = ? AND source_id = ? AND week_key = ? AND category_id = ?
          `).run(timestamp, ...rowParams(identity));
          if (summaryUpdate.changes === 0) {
            db.prepare(`
              INSERT INTO snapshot_summary_state
                (source_system, source_id, week_key, category_id, is_stale, stale_reason, updated_at)
              VALUES (?, ?, ?, ?, 1, 'snapshot_redacted', ?)
            `).run(...rowParams(identity), timestamp);
          }
        }
        invalidateSummaryRows(db, {
          ...identity,
          weekKey: identity.weekKey,
          reason: 'snapshot_redacted'
        });
        const aggregateJson = aggregate === null ? null : canonicalJson(aggregate);
        db.prepare(`
          INSERT INTO snapshot_redactions
            (source_system, source_id, week_key, category_id, reason, aggregate_json, redacted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(...rowParams(identity), reason, aggregateJson, timestamp);
        return toRedactionRecord({
          source_system: identity.sourceSystem,
          source_id: identity.sourceId,
          week_key: identity.weekKey,
          category_id: identity.categoryId,
          reason,
          aggregate_json: aggregateJson,
          redacted_at: timestamp
        });
      }, onBeforeCommit);
    },

    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    }
  };
}

export {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_MIGRATION_PATH,
  DEFAULT_SUMMARY_MIGRATION_PATH,
  DEFAULT_SCHEMA_PATH,
  DEFAULT_SCHEMA_VERSION,
  LEGACY_SOURCE_SYSTEM,
  MAX_LIST_RESULTS
};
