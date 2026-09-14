import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  SnapshotIdentityCollisionError,
  SnapshotRedactedError,
  CURRENT_SCHEMA_VERSION,
  LEGACY_SOURCE_SYSTEM,
  createSnapshotStore
} from '../src/snapshot-store.mjs';
import { createReportingServer, publishWeeklyRetroSnapshot } from '../src/server.mjs';

const SCHEMA_PATH = new URL('../schema/001_snapshot_store.sql', import.meta.url);
const MIGRATION_PATH = new URL('../schema/002_snapshot_store_source_system.sql', import.meta.url);

async function withStore(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-'));
  const store = createSnapshotStore({ databasePath: join(directory, 'snapshots.sqlite') });
  try {
    return await callback(store);
  } finally {
    store.close();
  }
}

function identity(overrides = {}) {
  return {
    sourceSystem: 'github',
    sourceId: 'icf-main',
    weekKey: '2026-W37',
    categoryId: 'delivery',
    ...overrides
  };
}

function envelope(overrides = {}) {
  return {
    schemaVersion: '1.0',
    report: { commits: 37, sensitive_note: 'keep private' },
    ...overrides
  };
}

test('snapshot schema migration creates raw, summary-state, and tombstone tables', async () => {
  const schema = await readFile(SCHEMA_PATH, 'utf8');
  assert.match(schema, /source_system TEXT NOT NULL/);
  assert.match(schema, /PRIMARY KEY \(source_system, source_id, week_key, category_id\)/);
  assert.match(schema, /snapshot_envelopes/);
  assert.match(schema, /snapshot_summary_state/);
  assert.match(schema, /snapshot_redactions/);
  assert.match(schema, /snapshot_trend_summaries/);
  const redactionTable = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS snapshot_redactions'));
  assert.doesNotMatch(redactionTable, /FOREIGN KEY/);
});

test('schema metadata includes the versioned pre-fix compatibility migration', async () => {
  const migration = await readFile(MIGRATION_PATH, 'utf8');
  assert.match(migration, /BEGIN IMMEDIATE/);
  assert.match(migration, /legacy/);
  assert.match(migration, /VALUES \(2, 'snapshot_store_source_system'/);
  assert.equal(CURRENT_SCHEMA_VERSION, 4);
});

test('reporting package declares the minimum node:sqlite runtime', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.engines.node, '>=22.5.0');
});

test('composite identity keeps source system, source, week, and category snapshots distinct', async () => {
  await withStore(store => {
    store.upsertSnapshot(identity(), envelope({ marker: 'delivery-a' }));
    store.upsertSnapshot(identity({ categoryId: 'quality' }), envelope({ marker: 'quality' }));
    store.upsertSnapshot(identity({ weekKey: '2026-W38' }), envelope({ marker: 'delivery-b' }));
    store.upsertSnapshot(identity({ sourceId: 'icf-release-bot' }), envelope({ marker: 'other-source' }));
    store.upsertSnapshot(identity({ sourceSystem: 'gitlab' }), envelope({ marker: 'other-system' }));

    const snapshots = store.listSnapshots({ fromWeek: '2026-W37', toWeek: '2026-W38' });
    assert.equal(snapshots.length, 5);
    assert.deepEqual(
      snapshots
        .filter(record => record.sourceId === 'icf-main' && record.weekKey === '2026-W37' && record.categoryId === 'delivery')
        .map(record => record.sourceSystem),
      ['github', 'gitlab']
    );
    assert.equal(store.getSnapshot(identity({ sourceSystem: 'gitlab' })).envelope.marker, 'other-system');
    assert.equal(store.getSnapshot(identity({ categoryId: 'quality' })).envelope.marker, 'quality');
    assert.equal(store.getSnapshot(identity({ weekKey: '2026-W38' })).envelope.marker, 'delivery-b');
  });
});

test('SQLite snapshots remain available after reopening the local database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-reopen-'));
  const databasePath = join(directory, 'snapshots.sqlite');
  const firstStore = createSnapshotStore({ databasePath });
  firstStore.upsertSnapshot(identity(), envelope({ marker: 'durable-local-state' }));
  firstStore.close();

  const reopenedStore = createSnapshotStore({ databasePath });
  try {
    assert.equal(reopenedStore.getSnapshot(identity()).envelope.marker, 'durable-local-state');
  } finally {
    reopenedStore.close();
  }
});

test('reopening a pre-fix database upgrades raw and tombstone data safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-legacy-migration-'));
  const databasePath = join(directory, 'snapshots.sqlite');
  const legacyDb = new DatabaseSync(databasePath);
  legacyDb.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE snapshot_envelopes (
      source_id TEXT NOT NULL,
      week_key TEXT NOT NULL,
      category_id TEXT NOT NULL,
      schema_version TEXT NOT NULL,
      envelope_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_id, week_key, category_id)
    );
    CREATE TABLE snapshot_summary_state (
      source_id TEXT NOT NULL,
      week_key TEXT NOT NULL,
      category_id TEXT NOT NULL,
      is_stale INTEGER NOT NULL DEFAULT 0 CHECK (is_stale IN (0, 1)),
      stale_reason TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (source_id, week_key, category_id),
      FOREIGN KEY (source_id, week_key, category_id)
        REFERENCES snapshot_envelopes (source_id, week_key, category_id)
        ON DELETE CASCADE
    );
    CREATE TABLE snapshot_redactions (
      source_id TEXT NOT NULL,
      week_key TEXT NOT NULL,
      category_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      redacted_at TEXT NOT NULL,
      PRIMARY KEY (source_id, week_key, category_id),
      FOREIGN KEY (source_id, week_key, category_id)
        REFERENCES snapshot_envelopes (source_id, week_key, category_id)
        ON DELETE CASCADE
    );
    INSERT INTO schema_migrations (version, name, applied_at)
    VALUES (1, 'snapshot_store', '2026-09-14T00:00:00.000Z');
  `);
  legacyDb.prepare(`
    INSERT INTO snapshot_envelopes
      (source_id, week_key, category_id, schema_version, envelope_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'legacy-raw', '2026-W37', 'delivery', '1.0',
    JSON.stringify({ marker: 'pre-fix-raw', report: { metrics: { commits: 11 } } }),
    '2026-09-14T00:00:01.000Z', '2026-09-14T00:00:01.000Z'
  );
  legacyDb.prepare(`
    INSERT INTO snapshot_summary_state
      (source_id, week_key, category_id, is_stale, stale_reason, updated_at)
    VALUES (?, ?, ?, 0, NULL, ?)
  `).run('legacy-raw', '2026-W37', 'delivery', '2026-09-14T00:00:01.000Z');
  legacyDb.prepare(`
    INSERT INTO snapshot_envelopes
      (source_id, week_key, category_id, schema_version, envelope_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
  `).run(
    'legacy-redacted', '2026-W37', 'quality', '1.0',
    '2026-09-14T00:00:02.000Z', '2026-09-14T00:00:02.000Z'
  );
  legacyDb.prepare(`
    INSERT INTO snapshot_summary_state
      (source_id, week_key, category_id, is_stale, stale_reason, updated_at)
    VALUES (?, ?, ?, 1, 'snapshot_redacted', ?)
  `).run('legacy-redacted', '2026-W37', 'quality', '2026-09-14T00:00:02.000Z');
  legacyDb.prepare(`
    INSERT INTO snapshot_redactions
      (source_id, week_key, category_id, reason, redacted_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'legacy-redacted', '2026-W37', 'quality', 'pre-fix tombstone', '2026-09-14T00:00:02.000Z'
  );
  legacyDb.close();

  const store = createSnapshotStore({ databasePath });
  try {
    const raw = store.getSnapshot({
      sourceSystem: LEGACY_SOURCE_SYSTEM,
      sourceId: 'legacy-raw',
      weekKey: '2026-W37',
      categoryId: 'delivery'
    });
    assert.equal(raw.envelope.marker, 'pre-fix-raw');
    assert.equal(raw.sourceSystem, LEGACY_SOURCE_SYSTEM);
    assert.equal(raw.summaryStale, false);

    const tombstone = store.getSnapshot({
      sourceSystem: LEGACY_SOURCE_SYSTEM,
      sourceId: 'legacy-redacted',
      weekKey: '2026-W37',
      categoryId: 'quality'
    });
    assert.equal(tombstone.envelope, null);
    assert.equal(tombstone.redacted, true);
    assert.equal(tombstone.redaction.reason, 'pre-fix tombstone');
    assert.equal(tombstone.redactedAggregate, null);
    assert.equal(tombstone.summaryStale, true);

    const listed = store.listSnapshots({ fromWeek: '2026-W37', toWeek: '2026-W37' });
    assert.deepEqual(listed.map(record => [record.sourceSystem, record.sourceId]), [
      [LEGACY_SOURCE_SYSTEM, 'legacy-raw'],
      [LEGACY_SOURCE_SYSTEM, 'legacy-redacted']
    ]);

    const metadata = new DatabaseSync(databasePath);
    try {
      assert.equal(metadata.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, CURRENT_SCHEMA_VERSION);
      assert.equal(metadata.prepare('PRAGMA user_version').get().user_version, CURRENT_SCHEMA_VERSION);
      assert.equal(metadata.prepare('SELECT COUNT(*) AS count FROM snapshot_envelopes WHERE source_system = ?').get(LEGACY_SOURCE_SYSTEM).count, 2);
    } finally {
      metadata.close();
    }

    const postMigrationRedaction = store.redactSnapshot(
      { sourceSystem: LEGACY_SOURCE_SYSTEM, sourceId: 'legacy-raw', weekKey: '2026-W37', categoryId: 'delivery' },
      'post-migration redaction'
    );
    assert.deepEqual(postMigrationRedaction.redactedAggregate, { counts: { commits: 11 } });
  } finally {
    store.close();
  }

  const reopenedStore = createSnapshotStore({ databasePath });
  try {
    const migrated = reopenedStore.getSnapshot({
      sourceSystem: LEGACY_SOURCE_SYSTEM,
      sourceId: 'legacy-raw',
      weekKey: '2026-W37',
      categoryId: 'delivery'
    });
    assert.equal(migrated.envelope, null);
    assert.equal(migrated.redacted, true);
    assert.deepEqual(migrated.redactedAggregate, { counts: { commits: 11 } });
  } finally {
    reopenedStore.close();
  }
});

test('rejects identity collisions declared by an envelope', async () => {
  await withStore(store => {
    assert.throws(
      () => store.upsertSnapshot(identity(), envelope({ identity: { ...identity(), sourceSystem: 'gitlab' } })),
      error => error instanceof SnapshotIdentityCollisionError && error.code === 'SNAPSHOT_IDENTITY_COLLISION'
    );
    assert.equal(store.getSnapshot(identity()), null);
  });
});

test('upsert is atomic and repeat-identical writes are idempotent', async () => {
  await withStore(store => {
    const first = store.upsertSnapshot(identity(), envelope({ marker: 'first' }));
    const repeated = store.upsertSnapshot(identity(), envelope({ marker: 'first' }));
    assert.deepEqual(repeated, first);

    const updated = store.upsertSnapshot(identity(), envelope({ marker: 'updated' }));
    assert.equal(updated.envelope.marker, 'updated');
    assert.equal(updated.summaryStale, true);

    assert.throws(
      () => store.upsertSnapshot(identity({ categoryId: 'not-a-category' }), envelope()),
      /categoryId/
    );
    assert.equal(store.listSnapshots({ fromWeek: '2026-W37', toWeek: '2026-W37' }).length, 1);
  });
});

test('canonical JSON makes equivalent property order idempotent', async () => {
  await withStore(store => {
    const first = store.upsertSnapshot(identity(), { schemaVersion: '1.0', z: 3, nested: { b: 2, a: 1 }, a: 1 });
    const repeated = store.upsertSnapshot(identity(), { a: 1, nested: { a: 1, b: 2 }, z: 3, schemaVersion: '1.0' });
    assert.deepEqual(repeated, first);
  });
});

test('rollback removes all writes after a transaction has begun', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-rollback-'));
  let injectFailure = false;
  const store = createSnapshotStore({
    databasePath: join(directory, 'snapshots.sqlite'),
    onBeforeCommit({ operation, phase }) {
      if (injectFailure && operation === 'upsertSnapshot' && phase === 'before_commit') {
        throw new Error('injected failure after transaction writes');
      }
    }
  });
  try {
    store.upsertSnapshot(identity(), envelope({ marker: 'before' }));
    injectFailure = true;
    assert.throws(
      () => store.upsertSnapshot(identity(), envelope({ marker: 'after' })),
      /injected failure after transaction writes/
    );
    assert.equal(store.getSnapshot(identity()).envelope.marker, 'before');
    assert.equal(store.listSnapshots({ fromWeek: '2026-W37', toWeek: '2026-W37' }).length, 1);
  } finally {
    store.close();
  }
});

test('listSnapshots requires week bounds, filters category, and caps results', async () => {
  await withStore(store => {
    for (let index = 1; index <= 101; index += 1) {
      store.upsertSnapshot(
        identity({ sourceId: `icf-source-${index}`, categoryId: 'delivery' }),
        envelope({ marker: index })
      );
    }
    store.upsertSnapshot(identity({ weekKey: '2026-W37', categoryId: 'quality' }), envelope({ marker: 'other' }));

    const result = store.listSnapshots({ fromWeek: '2026-W01', toWeek: '2026-W53', categoryId: 'delivery' });
    assert.equal(result.length, 100);
    assert.ok(result.every(record => record.categoryId === 'delivery'));
    const oversizedLimit = store.listSnapshots({
      fromWeek: '2026-W01',
      toWeek: '2026-W53',
      categoryId: 'delivery',
      limit: 1000
    });
    assert.equal(oversizedLimit.length, 100);
    assert.equal(store.listSnapshots({
      fromWeek: '2026-W01',
      toWeek: '2026-W53',
      categoryId: 'delivery',
      limit: 2
    }).length, 2);
    assert.throws(() => store.listSnapshots({ categoryId: 'delivery' }), /fromWeek and toWeek/);
  });
});

test('redaction removes raw content, persists a tombstone, and marks summaries stale', async () => {
  await withStore(store => {
    store.upsertSnapshot(identity(), envelope({
      report: {
        metrics: { commits: 37, contributors: 2 },
        aggregate: { summaries: { headline: 'safe aggregate summary' } },
        sensitive_note: 'secret'
      }
    }));
    const redaction = store.redactSnapshot(identity(), 'user requested removal');
    assert.equal(redaction.reason, 'user requested removal');
    assert.equal(redaction.summaryStale, true);
    assert.deepEqual(redaction.redactedAggregate, {
      counts: { commits: 37, contributors: 2 },
      summaries: { headline: 'safe aggregate summary' }
    });

    const record = store.getSnapshot(identity());
    assert.equal(record.envelope, null);
    assert.equal(record.redacted, true);
    assert.equal(record.summaryStale, true);
    assert.equal(record.redaction.reason, 'user requested removal');
    assert.deepEqual(record.redactedAggregate, redaction.redactedAggregate);
    assert.equal(store.redactSnapshot(identity(), 'different wording').reason, 'user requested removal');
    assert.throws(() => store.upsertSnapshot(identity(), envelope()), SnapshotRedactedError);
  });
});

test('redaction tombstone and aggregate survive raw-row deletion', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-tombstone-'));
  const databasePath = join(directory, 'snapshots.sqlite');
  const store = createSnapshotStore({ databasePath });
  store.upsertSnapshot(identity(), envelope({ report: { metrics: { commits: 8 } } }));
  const redaction = store.redactSnapshot(identity(), 'durable removal');
  store.close();

  const db = new DatabaseSync(databasePath);
  db.prepare(`
    DELETE FROM snapshot_envelopes
    WHERE source_system = ? AND source_id = ? AND week_key = ? AND category_id = ?
  `).run(identity().sourceSystem, identity().sourceId, identity().weekKey, identity().categoryId);
  db.close();

  const reopenedStore = createSnapshotStore({ databasePath });
  try {
    const record = reopenedStore.getSnapshot(identity());
    assert.equal(record.redacted, true);
    assert.equal(record.envelope, null);
    assert.deepEqual(record.redactedAggregate, redaction.redactedAggregate);
    assert.equal(reopenedStore.listSnapshots({ fromWeek: '2026-W37', toWeek: '2026-W37' }).length, 1);
  } finally {
    reopenedStore.close();
  }
});

test('malformed toJSON output is reported as contextual envelope validation', async () => {
  await withStore(store => {
    assert.throws(
      () => store.upsertSnapshot(identity(), { toJSON: () => ['not', 'an', 'envelope'] }),
      error => error instanceof TypeError && /envelope\.toJSON output validation failed.*JSON object/.test(error.message)
    );
    assert.equal(store.getSnapshot(identity()), null);
  });
});

test('publication boundary validates and persists an explicit local snapshot', async () => {
  await withStore(async store => {
    const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
    const record = publishWeeklyRetroSnapshot({ store, identity: identity(), report });
    assert.equal(record.weekKey, '2026-W37');
    assert.deepEqual(store.getSnapshot(identity()).envelope.report, report);
  });
});

test('reporting server publishes only when an explicit local store is configured', async t => {
  await withStore(async store => {
    const server = createReportingServer({ snapshotStore: store, snapshotIdentity: identity() });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/reporting/weekly-retro`);
    assert.equal(response.status, 200);
    assert.equal(store.getSnapshot(identity()).envelope.report.date, '2026-09-13');
  });
});
