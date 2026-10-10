import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { inspectToolforgeSkill, readToolforgeInventory } from '../src/toolforge-inventory.mjs';
import { buildToolforgeSkillRunner, createGatewayServer } from '../src/server.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'icf-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skill = { id: 'demo', name: 'Demo', runtime: 'node', entrypoint: 'src/index.mjs' };
  const dir = join(root, 'skills', skill.id);
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), '# Demo\nInput schema here.');
  await writeFile(join(dir, 'src/index.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));');
  const manifest = join(root, 'manifest.json');
  await writeFile(manifest, JSON.stringify({ skills: [skill] }));
  return { root, dir, skill, manifest };
}

test('checked inventory and dispatcher agree; real CLI runner executes fixture', async t => {
  const f = await fixture(t);
  const checked = inspectToolforgeSkill(f.skill, f.root);
  assert.equal(checked.runnable, true);
  assert.equal(checked.availability, 'cli');
  assert.deepEqual(buildToolforgeSkillRunner('Demo', f.manifest, f.root), checked.runner);
  assert.match(execFileSync(checked.runner[0], checked.runner[1], { encoding: 'utf8' }), /\[\]/);
});

test('installed lowercase and uppercase metadata repair stale entrypoint/runtime', async t => {
  const f = await fixture(t);
  for (const name of ['skill.json', 'SKILL.json']) {
    await writeFile(join(f.dir, name), JSON.stringify({ runtime: 'typescript', entrypoint: 'src/index.ts' }));
    await writeFile(join(f.dir, 'src/index.ts'), 'export default function handler(input: object) { return input; }');
    const result = inspectToolforgeSkill({ ...f.skill, entrypoint: 'dist/missing.js' }, f.root);
    assert.equal(result.entrypoint, 'src/index.ts');
    assert.equal(result.runtime, 'typescript');
    assert.equal(result.runnable, false);
    assert.equal(result.command, `code '${join(f.dir, 'SKILL.md')}'`);
    await rm(join(f.dir, name));
  }
});

test('missing TypeScript launcher offers instructions without downloads', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'src/index.ts'), 'console.log(process.argv);');
  const result = inspectToolforgeSkill({ ...f.skill, entrypoint: 'src/index.ts', runtime: 'typescript' }, f.root);
  assert.equal(result.runnable, false);
  assert.equal(result.reason, 'Local TypeScript launcher is missing');
  assert.ok(!result.command.includes('npx'));
  const cli = join(f.dir, 'node_modules/tsx/dist/cli.mjs');
  await mkdir(join(cli, '..'), { recursive: true });
  await writeFile(cli, 'console.log(process.argv);');
  const available = inspectToolforgeSkill({ ...f.skill, entrypoint: 'src/index.ts', runtime: 'typescript' }, f.root);
  assert.equal(available.runnable, true);
  assert.deepEqual(available.runner, ['node', [cli, join(f.dir, 'src/index.ts')]]);
});

test('missing, library-only, malformed, and escaping skills never dispatch', async t => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'src/library.mjs'), 'export default function handler(input) { return input; }');
  assert.equal(inspectToolforgeSkill({ ...f.skill, entrypoint: 'src/library.mjs' }, f.root).runnable, false);
  assert.equal(inspectToolforgeSkill({ ...f.skill, entrypoint: 'missing.js' }, f.root).reason, 'Entrypoint is missing');
  for (const entrypoint of ['../../manifest.json', join(f.root, 'manifest.json')]) {
    const result = inspectToolforgeSkill({ ...f.skill, entrypoint }, f.root);
    assert.equal(result.runnable, false);
    assert.equal(result.command, '');
  }
  assert.equal(inspectToolforgeSkill({ ...f.skill, id: '../demo' }, f.root).command, '');
  await writeFile(join(f.dir, 'skill.json'), '{broken');
  assert.equal(inspectToolforgeSkill(f.skill, f.root).reason, 'Installed skill metadata is invalid');
  assert.equal(buildToolforgeSkillRunner('demo', f.manifest, f.root), null);
});

test('inventory HTTP endpoint exposes canonical checked inventory and fails explicitly', async t => {
  const f = await fixture(t);
  const server = createGatewayServer({ toolforgeRoot: f.root, toolforgeManifestPath: f.manifest, historyAdapter: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/toolforge/skills`;
  let res = await fetch(url);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), readToolforgeInventory(f.manifest, f.root));
  await writeFile(f.manifest, '{broken');
  res = await fetch(url);
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { skills: [], error: 'Toolforge inventory unavailable' });
});

test('only three pilots receive unavailable capability without changing standalone command', async t => {
  const f = await fixture(t);
  const pilots = ['roadmap-validator', 'agent-drift-detector', 'retro-schema-validator'];
  for (const id of pilots) {
    const dir = join(f.root, 'skills', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), '# Pilot instructions');
  }
  await writeFile(f.manifest, JSON.stringify({ skills: [f.skill, ...pilots.map(id => ({ id }))] }));
  const standalone = readToolforgeInventory(f.manifest, f.root);
  const server = createGatewayServer({ toolforgeRoot: f.root, historyAdapter: {},
    toolforgeWorkspaceRoots: [f.root], toolforgeNodeExecutable: process.execPath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/toolforge/skills`);
  assert.equal(res.status, 200, 'configured root supplies its own manifest');
  const inventory = await res.json();
  for (let i = 0; i < inventory.skills.length; i++) {
    const { inputInvocation, ...legacy } = inventory.skills[i];
    assert.deepEqual(legacy, standalone.skills[i]);
    if (!pilots.includes(legacy.id)) { assert.equal(inputInvocation, undefined); continue; }
    assert.equal(inputInvocation.contractVersion, 1);
    assert.deepEqual(inputInvocation.fields, []);
    assert.equal(inputInvocation.available, false);
    assert.equal(inputInvocation.reason, 'RUNTIME_UNAVAILABLE');
    assert.deepEqual(inputInvocation.commandContext, { nodeExecutable: process.execPath,
      scriptPath: join(f.root, 'skills/toolforge-cli/src/invoke-skill.mjs'), workspaceRoots: [f.root] });
    assert.ok(legacy.command.startsWith('code '));
  }
});

test('manifest capabilities never survive; only fixed pilots receive trusted unavailable metadata', async t => {
  const f = await fixture(t);
  const pilots = ['roadmap-validator', 'agent-drift-detector', 'retro-schema-validator'];
  for (const id of pilots) {
    const dir = join(f.root, 'skills', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), '# Pilot instructions');
  }
  const skills = [f.skill, ...pilots.map(id => ({ id }))];
  await writeFile(f.manifest, JSON.stringify({ skills }));
  const legacy = readToolforgeInventory(f.manifest, f.root);
  const forged = { contractVersion: 1, available: true, fields: [{ name: 'forged' }], reason: null,
    commandContext: { nodeExecutable: 'untrusted', scriptPath: 'untrusted', workspaceRoots: ['untrusted'] } };
  await writeFile(f.manifest, JSON.stringify({ skills: skills.map(skill => ({ ...skill, inputInvocation: forged })) }));
  assert.deepEqual(inspectToolforgeSkill({ ...f.skill, inputInvocation: forged }, f.root), legacy.skills[0]);
  assert.deepEqual(readToolforgeInventory(f.manifest, f.root), legacy);
  assert.deepEqual(readToolforgeInventory(f.manifest, f.root, { demo: forged }), legacy, 'host map cannot attach nonpilot capability');
  const server = createGatewayServer({ toolforgeRoot: f.root, historyAdapter: {}, toolforgeWorkspaceRoots: [f.root] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/toolforge/skills`);
  assert.equal(res.status, 200);
  const inventory = await res.json();
  for (let i = 0; i < inventory.skills.length; i++) {
    const { inputInvocation, ...checked } = inventory.skills[i];
    assert.deepEqual(checked, legacy.skills[i]);
    if (!pilots.includes(checked.id)) { assert.equal(inputInvocation, undefined); continue; }
    assert.deepEqual(inputInvocation, { contractVersion: 1, fields: [], available: false, reason: 'RUNTIME_UNAVAILABLE',
      commandContext: { nodeExecutable: process.execPath, scriptPath: join(f.root, 'skills/toolforge-cli/src/invoke-skill.mjs'), workspaceRoots: [f.root] } });
  }
});
