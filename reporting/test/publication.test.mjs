import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createSnapshotStore } from '../src/snapshot-store.mjs';
import { publishWeeklyRetro, writerEnabledFromEnvironment } from '../src/publication.mjs';

const identity = { sourceSystem: 'icf', sourceId: 'weekly-retro', weekKey: '2026-W37', categoryId: 'delivery' };

async function withStore(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'icf-weekly-retro-publication-'));
  const store = createSnapshotStore({ databasePath: join(directory, 'snapshots.sqlite') });
  try { return await callback(store); } finally { store.close(); }
}

test('writer flag is independent and disabled by default', async () => {
  await withStore(async store => {
    const result = await publishWeeklyRetro({ store, identity, writerEnabled: false, readReport: async () => JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url))) });
    assert.deepEqual(result, { status: 'WRITER_DISABLED', published: false });
    assert.equal(store.getSnapshot(identity), null);
  });
  assert.equal(writerEnabledFromEnvironment({}), false);
  assert.equal(writerEnabledFromEnvironment({ ICF_WEEKLY_RETRO_WRITER_ENABLED: 'true' }), true);
});

test('successful repeated generation is idempotent and failed generation preserves last valid report', async () => {
  await withStore(async store => {
    const valid = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url)));
    const first = await publishWeeklyRetro({ store, identity, writerEnabled: true, readReport: async () => valid });
    const second = await publishWeeklyRetro({ store, identity, writerEnabled: true, readReport: async () => valid });
    assert.equal(first.status, 'PUBLISHED');
    assert.equal(second.status, 'PUBLISHED');
    assert.deepEqual(second.record.envelope, first.record.envelope);
    await assert.rejects(() => publishWeeklyRetro({ store, identity, writerEnabled: true, readReport: async () => { throw new Error('generation failed'); } }), /generation failed/);
    assert.equal(store.getSnapshot(identity).envelope.report.date, '2026-09-13');
  });
});

test('invalid generation cannot replace the last valid snapshot', async () => {
  await withStore(async store => {
    const valid = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url)));
    await publishWeeklyRetro({ store, identity, writerEnabled: true, readReport: async () => valid });
    await assert.rejects(() => publishWeeklyRetro({ store, identity, writerEnabled: true, readReport: async () => ({ date: 'invalid' }) }), /Cannot publish invalid weekly retro report/);
    assert.equal(store.getSnapshot(identity).envelope.report.date, '2026-09-13');
  });
});

test('enabled publisher persists supplied projections without changing legacy metrics', async () => {
  await withStore(async store => {
    const valid = JSON.parse(await readFile(new URL('./fixtures/valid-report.json', import.meta.url)));
    const result = await publishWeeklyRetro({ store, identity, writerEnabled: true, readReport: async () => valid, categories: [{ id: 'delivery', name: 'Delivery' }], evidence: [{ label: 'commit abc' }], actions: [{ title: 'Review tests', status: 'open', sourceId: 'issue-1', categoryId: 'delivery', weekKey: '2026-W37' }] });
    assert.equal(result.record.envelope.report.metrics.commits, valid.metrics.commits);
    assert.deepEqual(result.record.envelope.report.categories, [{ id: 'delivery', name: 'Delivery' }]);
    assert.deepEqual(result.record.envelope.report.evidence, [{ label: 'commit abc' }]);
  });
});
