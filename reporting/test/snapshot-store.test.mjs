import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  SnapshotIdentityCollisionError,
  SnapshotRedactedError,
  createSnapshotStore
} from '../src/snapshot-store.mjs';
import { createReportingServer, publishWeeklyRetroSnapshot } from '../src/server.mjs';

const SCHEMA_PATH = new URL('../schema/001_snapshot_store.sql', import.meta.url);

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
  assert.match(schema, /snapshot_envelopes/);
  assert.match(schema, /snapshot_summary_state/);
  assert.match(schema, /snapshot_redactions/);
});

test('composite identity keeps source, week, and category snapshots distinct', async () => {
  await withStore(store => {
    store.upsertSnapshot(identity(), envelope({ marker: 'delivery-a' }));
    store.upsertSnapshot(identity({ categoryId: 'quality' }), envelope({ marker: 'quality' }));
    store.upsertSnapshot(identity({ weekKey: '2026-W38' }), envelope({ marker: 'delivery-b' }));
    store.upsertSnapshot(identity({ sourceId: 'icf-release-bot' }), envelope({ marker: 'other-source' }));

    assert.equal(store.listSnapshots({ fromWeek: '2026-W37', toWeek: '2026-W38' }).length, 4);
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

test('rejects identity collisions declared by an envelope', async () => {
  await withStore(store => {
    assert.throws(
      () => store.upsertSnapshot(identity(), envelope({ identity: { ...identity(), categoryId: 'quality' } })),
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
    assert.throws(() => store.listSnapshots({ categoryId: 'delivery' }), /fromWeek and toWeek/);
  });
});

test('redaction removes raw content, persists a tombstone, and marks summaries stale', async () => {
  await withStore(store => {
    store.upsertSnapshot(identity(), envelope({ sensitive: 'secret' }));
    const redaction = store.redactSnapshot(identity(), 'user requested removal');
    assert.equal(redaction.reason, 'user requested removal');
    assert.equal(redaction.summaryStale, true);

    const record = store.getSnapshot(identity());
    assert.equal(record.envelope, null);
    assert.equal(record.redacted, true);
    assert.equal(record.summaryStale, true);
    assert.equal(record.redaction.reason, 'user requested removal');
    assert.equal(store.redactSnapshot(identity(), 'different wording').reason, 'user requested removal');
    assert.throws(() => store.upsertSnapshot(identity(), envelope()), SnapshotRedactedError);
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
