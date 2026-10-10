import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { createGatewayServer } from '../src/server.mjs';

const toolforgeRoot = resolve(process.env.ICF_TEST_TOOLFORGE_ROOT || '../toolforge-read-only-pilot');
const apiPath = join(toolforgeRoot, 'skills/toolforge-cli/src/invoke-skill.mjs');
const origin = 'http://127.0.0.1:8123';
const input = { agentName: 'HTTP sentinel', expectedSchema: {}, actualSchema: {} };
const payload = { skillId: 'agent-drift-detector', input };
const keys = ['contractVersion', 'skillId', 'state', 'outcome', 'result', 'error', 'durationMs'];

async function gateway(t, options = {}, host = '127.0.0.1') {
  const server = createGatewayServer({ historyAdapter: {}, disableWatcher: true,
    toolforgeRoot, toolforgeWorkspaceRoots: [toolforgeRoot], toolforgeDashboardOrigin: origin, ...options });
  await new Promise(resolve => server.listen(0, host, resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { server, port: server.address().port };
}

function request(port, body = JSON.stringify(payload), options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: options.host || '127.0.0.1', port,
      path: options.path || '/api/toolforge/invoke', method: options.method || 'POST',
      headers: Object.fromEntries(Object.entries({ Origin: origin, 'Content-Type': 'application/json',
        ...(!Array.isArray(body) ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...options.headers }).filter(([, value]) => value !== undefined)) }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(raw), headers: res.headers }); }
        catch { reject(new Error(raw)); }
      });
    });
    req.on('error', reject);
    if (Array.isArray(body)) {
      (async () => {
        for (const chunk of body) { req.write(chunk); await new Promise(resolve => setTimeout(resolve, 10)); }
        req.end();
      })().catch(reject);
    }
    else req.end(body);
  });
}

function envelope(value, { preparse = false } = {}) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
  assert.equal(value.contractVersion, 1);
  assert.ok(Number.isFinite(value.durationMs) && value.durationMs >= 0);
  if (preparse) {
    assert.equal(value.skillId, null);
    assert.equal(value.result, null);
    assert.equal(value.outcome, null);
  }
}

test('HTTP real managed API pass/findings/failure parity; completed body stays active', async t => {
  const { port } = await gateway(t);
  const api = await import(pathToFileURL(apiPath));
  const runner = api.createInvocationRunner({ toolforgeRoot, nodeExecutable: process.execPath, workspaceRoots: [toolforgeRoot] });
  t.after(() => runner.dispose());
  for (const value of [input, { ...input, expectedSchema: { status: 'ok' } }, { ...input, agentName: '' }]) {
    const res = await request(port, JSON.stringify({ ...payload, input: value }));
    const direct = await runner.invokeSkill(payload.skillId, value);
    envelope(res.body);
    assert.equal(res.status, direct.state === 'completed' ? 200 : 400);
    assert.deepEqual({ ...res.body, durationMs: 0 }, { ...direct, durationMs: 0 });
  }
});

test('route rejects method/origin/content type before JSON and preserves legacy shape', async t => {
  const { port } = await gateway(t);
  const cases = [
    [{ method: 'GET' }, 405, 'METHOD_NOT_ALLOWED'],
    [{ method: 'OPTIONS', headers: { Origin: 'http://evil.test' } }, 403, 'FORBIDDEN'],
    [{ headers: { Origin: undefined } }, 403, 'FORBIDDEN'],
    [{ headers: { Origin: 'null' } }, 403, 'FORBIDDEN'],
    [{ headers: { Origin: 'http://localhost:8123', Host: 'localhost:8123' } }, 403, 'FORBIDDEN'],
    [{ headers: { 'Content-Type': 'text/plain' } }, 400, 'UNSUPPORTED_CONTENT_TYPE'],
    [{ headers: { 'Content-Type': 'application/json; charset=latin1' } }, 400, 'UNSUPPORTED_CONTENT_TYPE'],
    [{}, 400, 'INVALID_JSON'],
  ];
  for (const [options, status, code] of cases) {
    const res = await request(port, '{broken', options);
    assert.equal(res.status, status);
    envelope(res.body, { preparse: true });
    assert.equal(res.body.error.code, code);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  }
  const legacy = await request(port, '{broken', { path: '/api/actions/run' });
  assert.equal(legacy.status, 400);
  assert.deepEqual(legacy.body, { ok: false, error: 'Invalid JSON' });
});

test('strict envelopes reject target/input/extra request config', async t => {
  const { port } = await gateway(t);
  for (const value of [null, [], {}, { ...payload, workspaceRoots: [toolforgeRoot] }, { ...payload, input: null }, { ...payload, input: [] }, { ...payload, skillId: 'unknown' }, { ...payload, skillId: 1 }, { skillId: payload.skillId }]) {
    const res = await request(port, JSON.stringify(value));
    assert.equal(res.status, 400);
    envelope(res.body);
    assert.equal(res.body.state, 'rejected');
    assert.equal(res.body.result, null);
  }
});

test('trusted exact Origin independent of hostile Host; missing runtime fails closed', async t => {
  const { port } = await gateway(t);
  assert.equal((await request(port, JSON.stringify(payload), { headers: { Host: 'invalid%host' } })).status, 200);
  const missing = await gateway(t, { toolforgeNodeExecutable: join(toolforgeRoot, 'not-installed-node.exe') });
  const res = await request(missing.port);
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, 'RUNTIME_UNAVAILABLE');
});

test('active inventory consumes managed inspection, preserves standalone fields and trusted defaults', async t => {
  const { port } = await gateway(t);
  const inventory = await (await fetch(`http://127.0.0.1:${port}/api/toolforge/skills`)).json();
  const { readToolforgeInventory } = await import('../src/toolforge-inventory.mjs');
  const standalone = readToolforgeInventory(join(toolforgeRoot, 'manifest.json'), toolforgeRoot);
  const api = await import(pathToFileURL(apiPath));
  const runner = api.createInvocationRunner({ toolforgeRoot, nodeExecutable: process.execPath, workspaceRoots: [toolforgeRoot] });
  t.after(() => runner.dispose());
  for (let i = 0; i < inventory.skills.length; i++) {
    const { inputInvocation, ...legacy } = inventory.skills[i];
    assert.deepEqual(legacy, standalone.skills[i]);
    if (!['roadmap-validator', 'agent-drift-detector', 'retro-schema-validator'].includes(legacy.id)) {
      assert.equal(inputInvocation, undefined); continue;
    }
    assert.deepEqual(inputInvocation, { ...await runner.inspectInvocation(legacy.id),
      commandContext: { nodeExecutable: process.execPath, scriptPath: apiPath, workspaceRoots: [toolforgeRoot] } });
    assert.equal(inputInvocation.available, true);
  }
});

test('raw body 65536 accepted, 65537 rejected independently of normalized input', async t => {
  const { port } = await gateway(t);
  const body = JSON.stringify(payload);
  for (const size of [65536, 65537]) {
    const res = await request(port, body + ' '.repeat(size - Buffer.byteLength(body)));
    assert.equal(res.status, size === 65536 ? 200 : 413);
    if (size === 65537) {
      envelope(res.body, { preparse: true });
      assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
    }
  }
});

test('fatal UTF-8 decoding rejects malformed bytes and accepts split multi-byte characters', async t => {
  const { port } = await gateway(t);
  const unicode = { ...payload, input: { ...input, agentName: 'caf\u00e9 \u6f22' } };
  const bytes = Buffer.from(JSON.stringify(unicode));
  const split = bytes.indexOf(0xc3) + 1;
  const valid = await request(port, [bytes.subarray(0, split), bytes.subarray(split)], { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.result.agentName, unicode.input.agentName);
  const invalid = await request(port, Buffer.concat([Buffer.from('{"skillId":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}') ]));
  assert.equal(invalid.status, 400);
  envelope(invalid.body, { preparse: true });
  assert.equal(invalid.body.error.code, 'INVALID_JSON');
});

test('actual non-loopback socket rejected', async t => {
  const address = Object.values(networkInterfaces()).flat().find(value => value.family === 'IPv4' && !value.internal)?.address;
  assert.ok(address, 'Windows acceptance requires a non-loopback interface');
  const { port } = await gateway(t, {}, '0.0.0.0');
  const res = await request(port, JSON.stringify(payload), { host: address });
  assert.equal(res.status, 403);
  envelope(res.body, { preparse: true });
});

test('missing managed API keeps instructions and returns unavailable envelope', async t => {
  const root = await mkdtemp(join(tmpdir(), 'icf-no-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { port } = await gateway(t, { toolforgeRoot: root });
  const res = await request(port);
  assert.equal(res.status, 503);
  assert.equal(res.body.state, 'unavailable');
  envelope(res.body);
});

async function copiedInstallation(t) {
  const root = await mkdtemp(join(tmpdir(), 'icf-reviewed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reviewedPath = 'skills/toolforge-cli/src/invocation-reviewed.json';
  const reviewed = JSON.parse(await readFile(join(toolforgeRoot, reviewedPath)));
  for (const file of [...Object.keys(reviewed.files), reviewedPath]) {
    await mkdir(join(root, file, '..'), { recursive: true });
    await copyFile(join(toolforgeRoot, file), join(root, file));
  }
  return root;
}

test('changed runner cannot execute before availability rejection; resolution and anchor drift fail closed', async t => {
  for (const file of ['skills/toolforge-cli/src/invoke-skill.mjs', 'skills/toolforge-cli/src/invocation-contracts.mjs', 'skills/toolforge-cli/src/package.json', 'package.json', 'skills/toolforge-cli/src/invocation-reviewed.json']) {
    const root = await copiedInstallation(t);
    const marker = `icfImportProbe${Math.random().toString(16).slice(2)}`;
    if (file.endsWith('.mjs')) await writeFile(join(root, file), `globalThis.${marker} = true;\n` + await readFile(join(root, file), 'utf8'));
    else await writeFile(join(root, file), '{}');
    const { port } = await gateway(t, { toolforgeRoot: root, toolforgeWorkspaceRoots: [root] });
    const res = await request(port);
    assert.equal(res.status, 503, file);
    assert.equal(res.body.error.code, 'SOURCE_DRIFT', file);
    assert.equal(globalThis[marker], undefined, 'unreviewed module executed');
  }
});

test('managed status envelopes propagate exactly; exceptions fail safely; server disposes runner', async t => {
  const api = await import(pathToFileURL(apiPath));
  let disposed = false;
  const fakeRunner = {
    inspectInvocation: async () => ({ contractVersion: 1, fields: [], available: true, reason: null }),
    invokeSkill: async (id, value) => {
      if (value.agentName === 'throw') throw new Error('private diagnostic');
      return api.invocationFailure(id, { code: value.agentName });
    },
    dispose: async () => { disposed = true; },
  };
  const { server, port } = await gateway(t, { toolforgeInvocationTestApi: { createInvocationRunner: () => fakeRunner } });
  for (const [code, status] of [['BUSY', 429], ['RUNTIME_UNAVAILABLE', 503], ['SOURCE_DRIFT', 503], ['WORKER_FAILED', 500], ['TIMED_OUT', 504], ['throw', 500]]) {
    const res = await request(port, JSON.stringify({ ...payload, input: { ...input, agentName: code } }));
    assert.equal(res.status, status);
    envelope(res.body);
    assert.deepEqual(res.body, api.invocationFailure(payload.skillId, { code: code === 'throw' ? 'WORKER_FAILED' : code }));
    assert.ok(!JSON.stringify(res.body).includes('private diagnostic'));
  }
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(disposed, true);
});

test('real runner disconnect kills workers, saturation/timeout recover, server close disposes', async t => {
  const originalSpawn = childProcess.spawn;
  const children = new Set();
  let slow = true;
  let started = () => {};
  childProcess.spawn = (executable, args, options) => {
    const child = originalSpawn(executable, slow ? ['--input-type=module', '-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'] : args, options);
    children.add(child);
    child.once('close', () => children.delete(child));
    started();
    return child;
  };
  syncBuiltinESMExports();
  t.after(() => { childProcess.spawn = originalSpawn; syncBuiltinESMExports(); for (const child of children) child.kill(); });
  const { server, port } = await gateway(t);
  let reached;
  const spawned = new Promise(resolve => { reached = resolve; });
  let count = 0;
  started = () => { if (++count === 2) reached(); };
  const open = () => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/toolforge/invoke', method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' } });
    req.on('error', () => {});
    req.end(JSON.stringify(payload));
    return req;
  };
  const first = open(), second = open();
  await spawned;
  assert.equal(children.size, 2);
  assert.equal((await request(port)).status, 429);
  const closed = Promise.all([...children].map(child => new Promise(resolve => child.once('close', resolve))));
  first.destroy(); second.destroy();
  await closed;
  assert.equal(children.size, 0);
  // Parent close listeners finish releasing slots before next request.
  await new Promise(resolve => setImmediate(resolve));
  const timeout = await request(port);
  assert.equal(timeout.status, 504);
  assert.equal(timeout.body.error.code, 'TIMED_OUT');
  assert.equal(children.size, 0);
  slow = false;
  assert.equal((await request(port)).body.state, 'completed');
  slow = true;
  let active;
  const next = new Promise(resolve => { active = resolve; });
  started = active;
  const pending = open();
  await next;
  const stopped = Promise.all([...children].map(child => new Promise(resolve => child.once('close', resolve))));
  server.close(); server.closeAllConnections();
  await stopped;
  pending.destroy();
  assert.equal(children.size, 0);
});

test('unexpected body stream error returns stable envelope; partial disconnect remains usable', async t => {
  const { server, port } = await gateway(t);
  server.prependOnceListener('request', req => req.once('data', () => req.emit('error', new Error('private stream error'))));
  const failed = await request(port, ['{', 'broken']);
  assert.equal(failed.status, 500);
  envelope(failed.body, { preparse: true });
  assert.equal(failed.body.error.code, 'WORKER_FAILED');
  const partial = http.request({ hostname: '127.0.0.1', port, path: '/api/toolforge/invoke', method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' } });
  partial.on('error', () => {});
  partial.write('{');
  partial.destroy();
  assert.equal((await request(port)).status, 200);
});

test('all real pilots HTTP parity, unchanged selected files, no SSE/history/log disclosure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'icf-http-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const good = join(root, 'good.md'), bad = join(root, 'bad.md'), retro = join(root, 'retro.json');
  await writeFile(good, '# Roadmap\n<!-- SYNC:TOOLFORGE -->\nx\n<!-- END:SYNC -->');
  await writeFile(bad, '# Missing');
  await writeFile(retro, JSON.stringify({ date: '2026-10-09', type: 'weekly', metrics: { unit_scale: 80, active_days: 5, commits_authored: 1, issues_closed: 0 }, sections: { wins: [], blockers: [], next: [] }, notes: '' }));
  const snapshot = async () => Promise.all((await readdir(root)).sort().map(async name => [name, createHash('sha256').update(await readFile(join(root, name))).digest('hex')]));
  const before = await snapshot();
  let historyCalls = 0;
  const historyAdapter = new Proxy({}, { get: () => { historyCalls++; throw new Error('unexpected persistence'); } });
  const { port } = await gateway(t, { toolforgeWorkspaceRoots: [root], historyAdapter });
  const api = await import(pathToFileURL(apiPath));
  const runner = api.createInvocationRunner({ toolforgeRoot, nodeExecutable: process.execPath, workspaceRoots: [root] });
  t.after(() => runner.dispose());
  let events = '';
  let sse;
  const subscription = http.get({ hostname: '127.0.0.1', port, path: '/api/events' }, res => { sse = res; res.on('data', data => { events += data; }); });
  await new Promise(resolve => subscription.once('response', resolve));
  t.after(() => { sse.destroy(); subscription.destroy(); });
  const logs = [];
  const originalLog = console.log, originalError = console.error;
  console.log = (...args) => logs.push(args);
  console.error = (...args) => logs.push(args);
  t.after(() => { console.log = originalLog; console.error = originalError; });
  const semantic = value => {
    const normalized = structuredClone(value); normalized.durationMs = 0;
    if (normalized.result) delete normalized.result.timestamp;
    if (normalized.result?.data) delete normalized.result.data.validated;
    return normalized;
  };
  for (const [skillId, value, outcome] of [
    ['roadmap-validator', { roadmapPath: good, verbose: true }, 'pass'],
    ['roadmap-validator', { roadmapPath: bad, strict: true }, 'findings'],
    ['retro-schema-validator', { filePaths: [retro] }, 'pass'],
    ['retro-schema-validator', { filePaths: [bad] }, null],
    ['agent-drift-detector', input, 'pass'],
  ]) {
    const res = await request(port, JSON.stringify({ skillId, input: value }));
    assert.equal(res.status, outcome ? 200 : 400);
    assert.equal(res.body.outcome, outcome);
    assert.deepEqual(semantic(res.body), semantic(await runner.invokeSkill(skillId, value)));
    const cli = await new Promise((resolve, reject) => {
      const child = childProcess.spawn(process.execPath, [apiPath, '--skill', skillId, '--workspace-root', root], { windowsHide: true });
      const chunks = [];
      child.on('error', reject);
      child.stdout.on('data', chunk => chunks.push(chunk));
      child.stderr.resume();
      child.stdin.on('error', reject);
      child.once('close', code => {
        try { resolve({ code, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
      child.stdin.end(JSON.stringify(value));
    });
    assert.equal(cli.code, outcome === 'pass' ? 0 : outcome === 'findings' ? 1 : 2);
    assert.deepEqual(semantic(res.body), semantic(cli.body));
  }
  console.log = originalLog; console.error = originalError;
  assert.equal(historyCalls, 0);
  assert.deepEqual(logs, []);
  assert.doesNotMatch(events, /HTTP sentinel|roadmapPath|filePaths|missingFields|Validation successful|invocation|action/);
  assert.deepEqual(await snapshot(), before);
  for (const path of ['/skills/toolforge-cli/src/invoke-skill.mjs', '/src/invoke-skill.mjs']) {
    assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 404);
  }
});
