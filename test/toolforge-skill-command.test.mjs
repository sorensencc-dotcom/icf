import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import {
  skillCommandText,
  skillEntrypointPath,
  skillRunner
} from '../src/toolforge-skill-command.mjs';
import { buildToolforgeSkillRunner, findToolforgeSkill } from '../src/server.mjs';

test('skill command text covers Toolforge runtime families', () => {
  const root = 'C:\\dev';
  assert.equal(
    skillCommandText({ id: 'active-work-overview', runtime: 'node', entrypoint: 'skills/active-work-overview/src/overview.mjs' }, root),
    "node 'C:\\dev\\skills\\active-work-overview\\src\\overview.mjs'"
  );
  assert.equal(
    skillCommandText({ id: 'roadmap-validator', name: 'Roadmap Validator', runtime: 'typescript', entrypoint: 'src/index.ts' }, root),
    "code 'C:\\dev\\skills\\roadmap-validator\\SKILL.md'"
  );
  assert.equal(
    skillCommandText({ id: 'kb-sync-nightly', runtime: 'bash', entrypoint: 'src/run.sh' }, root),
    "bash 'C:\\dev\\skills\\kb-sync-nightly\\src\\run.sh'"
  );
  assert.equal(
    skillCommandText({ id: 'skill-security-auditor', runtime: 'python', entrypoint: 'src/skill_security_auditor.py' }, root),
    "python 'C:\\dev\\skills\\skill-security-auditor\\src\\skill_security_auditor.py'"
  );
  assert.equal(
    skillCommandText({ id: 'third-party-repo-auditor', runtime: 'powershell', entrypoint: 'src/audit.ps1' }, root),
    "pwsh -NoProfile -File 'C:\\dev\\skills\\third-party-repo-auditor\\src\\audit.ps1'"
  );
  assert.equal(
    skillCommandText({ id: 'research-questions', runtime: 'prompt', entrypoint: 'SKILL.md' }, root),
    "code 'C:\\dev\\skills\\research-questions\\SKILL.md'"
  );
});

test('skill runner uses manifest id and executable entrypoint, not display name wrapper', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'icf-toolforge-manifest-'));
  const manifestPath = join(dir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    skills: [
      { id: 'roadmap-validator', name: 'Roadmap Validator', runtime: 'typescript', entrypoint: 'src/index.ts' },
      { id: 'research-questions', name: 'Research Questions', runtime: 'prompt', entrypoint: 'SKILL.md' }
    ]
  }));

  assert.equal(findToolforgeSkill('Roadmap Validator', manifestPath).id, 'roadmap-validator');
  assert.equal(buildToolforgeSkillRunner('roadmap-validator', manifestPath, 'C:\\dev'), null);
  assert.equal(buildToolforgeSkillRunner('research-questions', manifestPath, 'C:\\dev'), null);
});

test('skill paths normalize manifest entrypoints without duplicating skills directory', () => {
  assert.equal(
    skillEntrypointPath({ id: 'parallel-search', entrypoint: 'skills/parallel-search/dist/index.js' }, 'C:\\dev'),
    'C:\\dev\\skills\\parallel-search\\dist\\index.js'
  );
  assert.deepEqual(
    skillRunner({ id: 'parallel-search', entrypoint: 'skills/parallel-search/dist/index.js' }, 'C:\\dev'),
    ['node', ['C:\\dev\\skills\\parallel-search\\dist\\index.js']]
  );
});

test('dashboard Toolforge copy controls use generated commands and clipboard promise states', async () => {
  const html = await readFile(new URL('../dashboard/index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('C:\\\\dev\\\\toolforge.ps1 run'));
  assert.ok(!html.includes('toolforge run ${s.name}'));
  assert.ok(html.includes('data-copy-command="${escapeHtml(command)}"'));
  assert.ok(html.includes("executeAction('run-skill', this.dataset.target, this)"));
  assert.ok(html.includes("fetch('/api/toolforge/skills'"));
  assert.ok(!html.includes('DEFAULT_SKILLS'));
  assert.ok(!html.includes('npx ts-node'));
  assert.ok(html.includes("${s.runnable ? '' : 'disabled'}"));

  const match = html.match(/function copyCommand\(cmd\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'copyCommand function must be present');

  const calls = [];
  const context = {
    navigator: { clipboard: { writeText: async value => calls.push(value) } },
    showToast: message => calls.push(message)
  };
  vm.runInNewContext(`${match[0]}; copyCommand('  node test.mjs  ')`, context);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['node test.mjs', 'Copied: node test.mjs']);

  const failures = [];
  const failureContext = {
    navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
    showToast: message => failures.push(message)
  };
  vm.runInNewContext(`${match[0]}; copyCommand('bad')`, failureContext);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(failures, ['Could not copy']);
});

test('every dashboard copy handler keeps command text outside JavaScript literals', async () => {
  for (const file of ['index.html', 'preview-enhanced.html']) {
    const html = await readFile(new URL(`../dashboard/${file}`, import.meta.url), 'utf8');
    const handlers = [...html.matchAll(/onclick="(copyCommand[^"\n]*)"/g)];
    assert.ok(handlers.length > 40, file);
    for (const [, handler] of handlers) {
      assert.equal(handler, 'copyCommand(this.dataset.copyCommand)', file);
      assert.doesNotThrow(() => new Function(handler));
    }
    assert.ok(html.includes("data-copy-command=\"Start-ScheduledTask -TaskName 'TRM-Notebooklm-Mine' -TaskPath '\\TRM\\'\""));
    assert.ok(html.includes("npm --prefix 'C:\\\\dev\\\\icf' run bot:report"));
    assert.ok(!html.includes("npmCmd: 'npm run"));
    assert.ok(html.includes('kb-sync\\schemas\\kb_sync_trm_architecture.md'));
  }
});

test('both dashboards handle missing and synchronously failing clipboard APIs', async () => {
  for (const file of ['index.html', 'preview-enhanced.html']) {
    const html = await readFile(new URL(`../dashboard/${file}`, import.meta.url), 'utf8');
    const source = html.match(/function copyCommand\(cmd\) \{[\s\S]*?\n  \}/)[0];
    for (const navigator of [{}, { clipboard: { writeText() { throw new Error('denied'); } } }]) {
      const messages = [];
      const context = { navigator, showToast: value => messages.push(value) };
      await vm.runInNewContext(`${source}; copyCommand('test')`, context);
      assert.deepEqual(messages, ['Could not copy']);
    }
  }
});

test('governance deep link selects skills tab and category on both dashboards', async () => {
  for (const file of ['index.html', 'preview-enhanced.html']) {
    const html = await readFile(new URL(`../dashboard/${file}`, import.meta.url), 'utf8');
    const source = html.match(/function handleHashRoute\(\) \{[\s\S]*?\n  \}/)[0];
    const calls = [];
    vm.runInNewContext(`${source}; handleHashRoute()`, {
      window: { location: { hash: '#category-governance' } },
      switchTab: value => calls.push(value),
      setSkillCategory: value => calls.push(value)
    });
    assert.deepEqual(calls, ['tab-skills', 'governance']);
  }
});
