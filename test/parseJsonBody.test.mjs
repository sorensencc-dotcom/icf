import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonBody } from '../src/server.mjs';
import { PassThrough } from 'node:stream';

test('parseJsonBody successfully parses valid JSON', async () => {
  const req = new PassThrough();
  const promise = parseJsonBody(req);
  req.write('{"foo": "bar"}');
  req.end();

  const result = await promise;
  assert.deepEqual(result, { foo: 'bar' });
});

test('parseJsonBody handles empty body as empty object', async () => {
  const req = new PassThrough();
  const promise = parseJsonBody(req);
  req.end();

  const result = await promise;
  assert.deepEqual(result, {});
});

test('parseJsonBody rejects on invalid JSON', async () => {
  const req = new PassThrough();
  const promise = parseJsonBody(req);
  req.write('{"foo": "bar');
  req.end();

  await assert.rejects(promise, SyntaxError);
});

test('parseJsonBody rejects on payload too large', async () => {
  const req = new PassThrough();
  const promise = parseJsonBody(req);

  // 1MB + 1 byte
  const largeChunk = Buffer.alloc(1024 * 1024 + 1, 'a');
  req.write(largeChunk);

  await assert.rejects(promise, { message: 'Payload too large' });
});

test('parseJsonBody rejects on stream error', async () => {
  const req = new PassThrough();
  const promise = parseJsonBody(req);

  req.destroy(new Error('Stream error'));

  await assert.rejects(promise, { message: 'Stream error' });
});
