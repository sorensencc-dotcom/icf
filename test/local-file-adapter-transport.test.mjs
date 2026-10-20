import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalFileAdapterTransport } from '../src/adapters/LocalFileAdapterTransport.mjs';

test('LocalFileAdapterTransport', async (t) => {
  await t.test('throws an error if the target file does not exist', async () => {
    const transport = new LocalFileAdapterTransport({ filePath: '/tmp/nonexistent-file.json' });
    await assert.rejects(
      async () => transport.fetch(),
      /File not found at transport path: \/tmp\/nonexistent-file.json/
    );
  });

  await t.test('fetches and parses a valid JSON file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'icf-local-file-transport-'));
    const filePath = join(dir, 'test.json');
    const data = { id: 1, name: 'Test' };
    await writeFile(filePath, JSON.stringify(data));

    const transport = new LocalFileAdapterTransport({ filePath });
    const result = await transport.fetch();

    assert.deepEqual(result, data);
  });

  await t.test('fetches and parses using a custom parse function', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'icf-local-file-transport-'));
    const filePath = join(dir, 'test.txt');
    const data = 'line1\nline2';
    await writeFile(filePath, data);

    const parse = (raw) => raw.split('\n');
    const transport = new LocalFileAdapterTransport({ filePath, parse });
    const result = await transport.fetch();

    assert.deepEqual(result, ['line1', 'line2']);
  });

  await t.test('throws SyntaxError when fetching an invalid JSON file with default parser', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'icf-local-file-transport-'));
    const filePath = join(dir, 'invalid.json');
    await writeFile(filePath, '{ invalid json');

    const transport = new LocalFileAdapterTransport({ filePath });
    await assert.rejects(
      async () => transport.fetch(),
      SyntaxError
    );
  });
});
