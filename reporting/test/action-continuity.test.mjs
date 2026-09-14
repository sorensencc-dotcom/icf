import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createActionContinuity } from '../src/action-continuity.mjs';
import { normalizeAction, normalizeActions } from '../src/action-continuity.mjs';
import { createSnapshotStore } from '../src/snapshot-store.mjs';
import { normalizeSnapshot } from '../src/snapshot-envelope.mjs';
import { publishWeeklyRetroSnapshot } from '../src/server.mjs';
import { validateApiResponse, validateWeeklyRetroReport } from '../src/weekly-retro-contract.mjs';

async function withStore(callback, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-actions-'));
  const store = createSnapshotStore({ databasePath: join(directory, 'snapshots.sqlite'), ...options });
  try {
    return await callback(store);
  } finally {
    store.close();
  }
}

function action(overrides = {}) {
  return {
    sourceSystem: 'github',
    sourceId: 'issue-42',
    weekKey: '2026-W37',
    categoryId: 'delivery',
    wording: 'Document release rollback steps',
    displayLabel: 'Release rollback runbook',
    owner: 'Chris',
    status: 'open',
    theme: 'release safety',
    provenanceLinks: [{ url: 'https://github.example/issues/42', label: 'Issue 42' }],
    ...overrides
  };
}

test('action identity, duplicate ingestion, owner/status changes, and history are durable', async () => {
  await withStore(store => {
    const first = store.upsertAction(action());
    const repeated = store.upsertAction({ ...action(), provenanceLinks: [{ label: 'Issue 42', url: 'https://github.example/issues/42' }] });
    assert.deepEqual(repeated, first);

    const changed = store.upsertAction({ ...action(), wording: 'Document and rehearse release rollback steps', displayLabel: 'Rollback runbook', owner: 'Maya', status: 'in_progress' });
    assert.equal(changed.owner, 'Maya');
    assert.equal(changed.status, 'in_progress');
    assert.equal(changed.wording, 'Document and rehearse release rollback steps');
    assert.equal(changed.history.length, 2);
    assert.equal(changed.history[0].wording, 'Document release rollback steps');
    assert.equal(changed.history[0].displayLabel, 'Release rollback runbook');
    assert.equal(changed.history[1].owner, 'Maya');
    assert.equal(changed.provenanceLinks[0].url, 'https://github.example/issues/42');
    assert.equal(store.listActions({ weekKey: '2026-W37', status: 'in_progress', owner: 'Maya' }).length, 1);

    store.upsertAction(action({ sourceId: 'issue-99', theme: 'release safety' }));
    assert.deepEqual(store.listActions({ weekKey: '2026-W37', categoryId: 'delivery' }).map(item => item.sourceId), ['issue-42', 'issue-99']);
  });
});

test('carry forward copies active actions, preserves completion and abandonment, and is idempotent', async () => {
  await withStore(store => {
    store.upsertAction(action({ weekKey: '2026-W36', sourceId: 'issue-open', status: 'open' }));
    store.upsertAction(action({ weekKey: '2026-W36', sourceId: 'issue-done', status: 'completed' }));
    store.upsertAction(action({ weekKey: '2026-W36', sourceId: 'issue-abandoned', status: 'abandoned' }));

    const carried = store.carryForwardActions('2026-W37');
    assert.deepEqual(carried.map(item => [item.sourceId, item.status]), [['issue-open', 'carried_over']]);
    assert.equal(carried[0].carriedFromWeek, '2026-W36');
    assert.equal(carried[0].history.at(-1).weekKey, '2026-W37');
    assert.equal(store.carryForwardActions('2026-W37').length, 1);

    const completed = store.upsertAction(action({ weekKey: '2026-W37', sourceId: 'issue-open', status: 'completed' }));
    assert.equal(completed.status, 'completed');
    assert.equal(completed.history.at(-1).status, 'completed');
    assert.equal(store.carryForwardActions('2026-W38').length, 0);
  });
});

test('report ingestion normalization exposes action records and provenance', () => {
  const snapshot = normalizeSnapshot({
    identity: { sourceSystem: 'github', sourceId: 'icf-main', weekKey: '2026-W37', categoryId: 'delivery' },
    report: {
      metrics: { commits: 1 },
      actions: [{ actionId: 'issue-7', title: 'Close flaky test gap', label: 'Flaky tests', owner: 'Maya', provenance: ['https://github.example/issues/7'] }]
    }
  });
  assert.equal(snapshot.actions.length, 1);
  assert.equal(snapshot.actions[0].sourceId, 'issue-7');
  assert.equal(snapshot.actions[0].displayLabel, 'Flaky tests');
  assert.deepEqual(snapshot.actions[0].provenanceLinks, [{
    url: 'https://github.example/issues/7',
    evidenceRecord: { sourceSystem: 'github', sourceId: 'icf-main', weekKey: '2026-W37', categoryId: 'delivery' }
  }]);
});

test('snapshot ingestion persists normalized actions in the same local store', async () => {
  await withStore(store => {
    store.upsertSnapshot({
      sourceSystem: 'github', sourceId: 'icf-main', weekKey: '2026-W37', categoryId: 'delivery'
    }, {
      schemaVersion: '1.0',
      report: {
        actions: [action({ sourceId: 'issue-ingested', wording: 'Publish weekly report' })]
      }
    });
    const [ingested] = store.listActions({ weekKey: '2026-W37', sourceId: 'issue-ingested' });
    assert.equal(ingested.wording, 'Publish weekly report');
    assert.equal(ingested.provenanceLinks[0].url, 'https://github.example/issues/42');
  });
});

test('validated weekly report publication ingests optional actions without changing the current response contract', async () => {
  await withStore(async store => {
    const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
    report.actions = [action({ sourceId: 'issue-published', weekKey: undefined })];
    delete report.actions[0].weekKey;
    publishWeeklyRetroSnapshot({
      store,
      identity: { sourceSystem: 'github', sourceId: 'icf-main', weekKey: '2026-W37', categoryId: 'delivery' },
      report
    });
    assert.equal(store.listActions({ weekKey: '2026-W37', sourceId: 'issue-published' }).length, 1);
  });
});

test('action writes roll back atomically and schema survives reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-action-rollback-'));
  const databasePath = join(directory, 'actions.sqlite');
  let fail = false;
  const store = createSnapshotStore({
    databasePath,
    onBeforeCommit({ operation }) {
      if (fail && operation === 'upsertAction') throw new Error('injected action failure');
    }
  });
  store.upsertAction(action());
  fail = true;
  assert.throws(() => store.upsertAction(action({ owner: 'Maya' })), /injected action failure/);
  assert.equal(store.listActions({ weekKey: '2026-W37' })[0].owner, 'Chris');
  store.close();

  const reopened = createSnapshotStore({ databasePath });
  try {
    assert.equal(reopened.listActions({ weekKey: '2026-W37' })[0].sourceId, 'issue-42');
    const db = new DatabaseSync(databasePath);
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM action_records').get().count, 1);
      assert.deepEqual(db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()
        .map(row => ({ version: row.version, name: row.name })), [
        { version: 1, name: 'snapshot_store' },
        { version: 2, name: 'snapshot_store_source_system' },
        { version: 3, name: 'snapshot_trend_summaries' },
        { version: 4, name: 'action_continuity' },
        { version: 5, name: 'action_redaction' }
      ]);
    } finally {
      db.close();
    }
  } finally {
    reopened.close();
  }
});

test('action continuity facade delegates the three public interfaces', async () => {
  await withStore(store => {
    const actions = createActionContinuity({ store, sourceSystem: 'github', sourceId: 'snapshot-id', categoryId: 'delivery' });
    assert.throws(() => actions.upsertAction({ weekKey: '2026-W37', wording: 'Missing explicit ID', provenanceLinks: ['https://github.example/issues/missing'] }), /sourceId must be a non-empty string/);
    actions.upsertAction({ sourceId: 'issue-1', weekKey: '2026-W37', wording: 'Review owners', provenanceLinks: ['https://github.example/issues/1'] });
    assert.equal(actions.listActions({ weekKey: '2026-W37' }).length, 1);
    assert.equal(actions.carryForwardActions('2026-W38')[0].status, 'carried_over');
  });
});

test('missing action IDs are rejected and distinct missing actions cannot collapse', async () => {
  await withStore(store => {
    const first = action({ wording: 'First distinct action' });
    const second = action({ wording: 'Second distinct action' });
    delete first.sourceId;
    delete second.sourceId;
    assert.throws(
      () => store.upsertSnapshot(
        { sourceSystem: 'github', sourceId: 'icf-main', weekKey: '2026-W37', categoryId: 'delivery' },
        { report: { actions: [first, second] } }
      ),
      /sourceId must be a non-empty string/
    );
    assert.deepEqual(store.listActions({ weekKey: '2026-W37' }), []);
    assert.throws(() => normalizeActions({ actions: [first] }, {
      identity: { sourceSystem: 'github', sourceId: 'icf-main', weekKey: '2026-W37', categoryId: 'delivery' }
    }), /sourceId must be a non-empty string/);
  });
});

test('unresolved actions carry forward and target completed or abandoned rows are not returned', async () => {
  await withStore(store => {
    store.upsertAction(action({ sourceId: 'unresolved', weekKey: '2026-W36', status: 'unresolved' }));
    store.upsertAction(action({ sourceId: 'completed-target', weekKey: '2026-W36', status: 'open' }));
    store.upsertAction(action({ sourceId: 'completed-target', weekKey: '2026-W37', status: 'completed' }));
    store.upsertAction(action({ sourceId: 'abandoned-target', weekKey: '2026-W36', status: 'open' }));
    store.upsertAction(action({ sourceId: 'abandoned-target', weekKey: '2026-W37', status: 'abandoned' }));

    const carried = store.carryForwardActions('2026-W37');
    assert.deepEqual(carried.map(item => [item.sourceId, item.status]), [['unresolved', 'carried_over']]);
    assert.equal(carried[0].carriedFromWeek, '2026-W36');
  });
});

test('week keys are real ISO weeks and carriedFromWeek must be earlier', async () => {
  await withStore(store => {
    assert.throws(() => store.upsertAction(action({ weekKey: '2025-W53' })), /real ISO week key/);
    assert.throws(() => store.upsertAction(action({ carriedFromWeek: '2026-W37' })), /earlier than weekKey/);
    assert.throws(() => store.upsertAction(action({ carriedFromWeek: '2026-W38' })), /earlier than weekKey/);
    assert.throws(() => store.carryForwardActions('2025-W53'), /real ISO week key/);
  });
});

test('provenance requires safe URL or path and links to the originating snapshot', () => {
  const origin = { sourceSystem: 'github', sourceId: 'icf-main', weekKey: '2026-W37', categoryId: 'delivery' };
  const base = action({ originatingSnapshot: origin });
  assert.deepEqual(normalizeAction({ ...base, provenanceLinks: [{ path: 'evidence/issue-42.md', evidenceRecord: origin }] }).provenanceLinks, [{
    path: 'evidence/issue-42.md', evidenceRecord: origin
  }]);
  assert.throws(() => normalizeAction({ ...base, provenanceLinks: ['javascript:alert(1)'] }), /safe HTTP\(S\) URL/);
  assert.throws(() => normalizeAction({ ...base, provenanceLinks: [{ path: '../secret.txt', evidenceRecord: origin }] }), /safe relative path/);
  assert.throws(() => normalizeAction({ ...base, provenanceLinks: [{ url: 'https://github.example/issues/42', evidenceRecord: { ...origin, sourceId: 'other' } }] }), /originating snapshot/);
  assert.throws(() => normalizeAction({ ...base, provenanceLinks: [{ label: 'missing target' }] }), /include url or path/);
});

test('report and API boundaries validate actions without a configured snapshot store', async () => {
  const report = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url), 'utf8'));
  const origin = { sourceSystem: 'github', sourceId: 'icf-main', weekKey: '2026-W37', categoryId: 'delivery' };
  report.actions = [action({ originatingSnapshot: origin, sourceId: 'boundary-1' })];
  assert.equal(validateWeeklyRetroReport(report).ok, true);
  assert.equal(validateApiResponse({ status: 'SUCCESS', data: report }).ok, true);

  const missingId = structuredClone(report);
  delete missingId.actions[0].sourceId;
  delete missingId.actions[0].actionId;
  assert.equal(validateWeeklyRetroReport(missingId).ok, false);

  const badProvenance = structuredClone(report);
  badProvenance.actions[0].provenanceLinks = [{ url: 'file:///secret', evidenceRecord: origin }];
  assert.equal(validateWeeklyRetroReport(badProvenance).ok, false);

  const badDate = structuredClone(report);
  badDate.date = '2026-02-30';
  assert.equal(validateWeeklyRetroReport(badDate).ok, false);

  const badStatus = structuredClone(report);
  badStatus.actions[0].status = 'not-a-status';
  assert.equal(validateWeeklyRetroReport(badStatus).ok, false);
});

test('redaction scrubs action wording, owner, history, and provenance and rolls back together', async () => {
  let fail = false;
  await withStore(async store => {
    const snapshot = { sourceSystem: 'github', sourceId: 'icf-main', weekKey: '2026-W37', categoryId: 'delivery' };
    const sensitive = action({
      sourceId: 'redact-me',
      originatingSnapshot: snapshot,
      wording: 'secret customer incident wording',
      owner: 'Private Owner',
      provenanceLinks: [{ url: 'https://github.example/private/secret', evidenceRecord: snapshot }]
    });
    store.upsertSnapshot(snapshot, {
      aggregate: { summaries: { action_wording: 'secret aggregate wording', headline: 'safe aggregate' } },
      report: { actions: [sensitive] }
    });
    store.upsertAction({ ...sensitive, status: 'in_progress', wording: 'secret changed wording' });
    const before = store.listActions({ weekKey: '2026-W37', sourceId: 'redact-me' })[0];
    assert.equal(before.history.length, 2);

    fail = true;
    assert.throws(() => store.redactSnapshot(snapshot, 'privacy request'), /injected redaction failure/);
    assert.equal(store.listActions({ weekKey: '2026-W37', sourceId: 'redact-me' })[0].wording, 'secret changed wording');

    fail = false;
    const redaction = store.redactSnapshot(snapshot, 'privacy request');
    assert.deepEqual(redaction.redactedAggregate, { summaries: { headline: 'safe aggregate' } });
    const sanitized = store.listActions({ weekKey: '2026-W37', sourceId: 'redact-me' })[0];
    assert.equal(sanitized.wording, '[redacted]');
    assert.equal(sanitized.displayLabel, '[redacted]');
    assert.equal(sanitized.owner, null);
    assert.deepEqual(sanitized.history, []);
    assert.deepEqual(sanitized.provenanceLinks, []);
    assert.equal(sanitized.redacted, true);
    assert.equal(store.getSnapshot(snapshot).envelope, null);

  }, { onBeforeCommit({ operation }) {
    if (fail && operation === 'redactSnapshot') throw new Error('injected redaction failure');
  } });
});

test('carry-forward selection and completion share the SQLite locking boundary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-locking-'));
  const databasePath = join(directory, 'actions.sqlite');
  let secondary;
  const primary = createSnapshotStore({
    databasePath,
    onBeforeCommit({ operation }) {
      if (operation === 'carryForwardActions') {
        assert.throws(
          () => secondary.upsertAction(action({ weekKey: '2026-W36', sourceId: 'locked', status: 'completed' })),
          /locked|transaction/i
        );
      }
    }
  });
  secondary = createSnapshotStore({ databasePath });
  try {
    primary.upsertAction(action({ weekKey: '2026-W36', sourceId: 'locked', status: 'open' }));
    assert.deepEqual(primary.carryForwardActions('2026-W37').map(item => item.status), ['carried_over']);
  } finally {
    secondary.close();
    primary.close();
  }
});

test('v3 databases migrate action schema to unresolved and redaction support', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-v3-migration-'));
  const databasePath = join(directory, 'actions.sqlite');
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (1, 'snapshot_store', '2026-09-14T00:00:00.000Z');
    INSERT INTO schema_migrations VALUES (2, 'snapshot_store_source_system', '2026-09-14T00:00:00.000Z');
    INSERT INTO schema_migrations VALUES (3, 'snapshot_trend_summaries', '2026-09-14T00:00:00.000Z');
    CREATE TABLE snapshot_envelopes (source_system TEXT NOT NULL, source_id TEXT NOT NULL, week_key TEXT NOT NULL, category_id TEXT NOT NULL, schema_version TEXT NOT NULL, envelope_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (source_system, source_id, week_key, category_id));
    CREATE TABLE snapshot_summary_state (source_system TEXT NOT NULL, source_id TEXT NOT NULL, week_key TEXT NOT NULL, category_id TEXT NOT NULL, is_stale INTEGER NOT NULL DEFAULT 0, stale_reason TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (source_system, source_id, week_key, category_id));
    CREATE TABLE snapshot_redactions (source_system TEXT NOT NULL, source_id TEXT NOT NULL, week_key TEXT NOT NULL, category_id TEXT NOT NULL, reason TEXT NOT NULL, aggregate_json TEXT, redacted_at TEXT NOT NULL, PRIMARY KEY (source_system, source_id, week_key, category_id));
    CREATE TABLE snapshot_trend_summaries (source_system TEXT NOT NULL, source_id TEXT NOT NULL, category_id TEXT NOT NULL, window INTEGER NOT NULL, from_week TEXT NOT NULL, to_week TEXT NOT NULL, summary_json TEXT NOT NULL, is_stale INTEGER NOT NULL DEFAULT 0, stale_reason TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (source_system, source_id, category_id, window, from_week, to_week));
    CREATE TABLE action_records (source_system TEXT NOT NULL, source_id TEXT NOT NULL, week_key TEXT NOT NULL, category_id TEXT NOT NULL, wording TEXT NOT NULL, display_label TEXT NOT NULL, owner TEXT, status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'carried_over', 'completed', 'abandoned')), theme TEXT, themes_json TEXT NOT NULL, provenance_json TEXT NOT NULL, history_json TEXT NOT NULL, carried_from_week TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (source_system, source_id, week_key, category_id));
  `);
  db.close();

  const store = createSnapshotStore({ databasePath });
  try {
    const migrated = new DatabaseSync(databasePath);
    try {
      assert.equal(migrated.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 5);
      assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 5);
      assert.ok(migrated.prepare('PRAGMA table_info(action_records)').all().some(column => column.name === 'origin_source_id'));
    } finally {
      migrated.close();
    }
    assert.equal(store.upsertAction(action({ sourceId: 'after-v3', status: 'unresolved' })).status, 'unresolved');
  } finally {
    store.close();
  }
});
