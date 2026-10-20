import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadArchivedCard } from '../src/server.mjs';

test('loadArchivedCard tests', async (t) => {
  let tmpBase;
  let inboxDir;
  let inboxCompleted;

  t.beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), 'icf-test-'));
    inboxDir = join(tmpBase, 'inbox');
    inboxCompleted = join(inboxDir, 'completed');
    mkdirSync(inboxDir);
    mkdirSync(inboxCompleted);
  });

  t.afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  await t.test('returns null if card is not found', () => {
    const result = loadArchivedCard('non-existent-card', null, inboxDir);
    assert.equal(result, null);
  });

  await t.test('loads from lockRow.archived_path when valid', () => {
    const directPath = join(tmpBase, 'direct.json');
    const mockCard = { id: 'card-1', title: 'Direct Path' };
    writeFileSync(directPath, JSON.stringify(mockCard));

    const result = loadArchivedCard('card-1', { archived_path: directPath }, inboxDir);
    assert.deepEqual(result, mockCard);
  });

  await t.test('loads JSON from inbox completed directory using exact cardId', () => {
    const mockCard = { id: 'card-2', title: 'Completed Path' };
    const exactPath = join(inboxCompleted, 'card-2.json');
    writeFileSync(exactPath, JSON.stringify(mockCard));

    const result = loadArchivedCard('card-2', null, inboxDir);
    assert.deepEqual(result, mockCard);
  });

  await t.test('loads Markdown with frontmatter from inbox completed directory', () => {
    const exactPath = join(inboxCompleted, 'card-3.md');
    const mdContent = `---
id: card-3
title: Markdown Title
status: COMPLETED
---
# Body content
This is the body.
`;
    writeFileSync(exactPath, mdContent);

    const result = loadArchivedCard('card-3', null, inboxDir);
    assert.equal(result.id, 'card-3');
    assert.equal(result.title, 'Markdown Title');
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.body, '# Body content\nThis is the body.');
  });

  await t.test('loads JSON from dynamically matched filename in inbox completed directory', () => {
    const mockCard = { id: 'card-4', title: 'Dynamic Name' };
    // Filename includes cardId but not exactly cardId.json
    const dynamicPath = join(inboxCompleted, 'some-prefix-card-4-suffix.json');
    writeFileSync(dynamicPath, JSON.stringify(mockCard));

    const result = loadArchivedCard('card-4', null, inboxDir);
    assert.deepEqual(result, mockCard);
  });

  await t.test('ignores non-files even if name matches', () => {
    // Create a directory that matches the cardId
    const dirPath = join(inboxCompleted, 'card-5.json');
    mkdirSync(dirPath);

    const result = loadArchivedCard('card-5', null, inboxDir);
    assert.equal(result, null);
  });

  await t.test('loads Markdown frontmatter cleanly when there is no body', () => {
    const exactPath = join(inboxCompleted, 'card-6.md');
    const mdContent = `---
id: card-6
title: Only Frontmatter
---`;
    writeFileSync(exactPath, mdContent);

    const result = loadArchivedCard('card-6', null, inboxDir);
    assert.equal(result.id, 'card-6');
    assert.equal(result.title, 'Only Frontmatter');
    assert.equal(result.body, '');
  });
});
