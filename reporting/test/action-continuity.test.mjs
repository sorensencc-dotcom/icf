import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createActionContinuity } from '../src/action-continuity.mjs';
import { createSnapshotStore } from '../src/snapshot-store.mjs';
import { normalizeSnapshot } from '../src/snapshot-envelope.mjs';
import { publishWeeklyRetroSnapshot } from '../src/server.mjs';

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
  assert.deepEqual(snapshot.actions[0].provenanceLinks, [{ url: 'https://github.example/issues/7' }]);
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
        { version: 4, name: 'action_continuity' }
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
    const actions = createActionContinuity({ store, sourceSystem: 'github', categoryId: 'delivery' });
    actions.upsertAction({ sourceId: 'issue-1', weekKey: '2026-W37', wording: 'Review owners' });
    assert.equal(actions.listActions({ weekKey: '2026-W37' }).length, 1);
    assert.equal(actions.carryForwardActions('2026-W38')[0].status, 'carried_over');
  });
});
