import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import {
  skillCommandText,
  skillEntrypointPath,
  skillRunner
} from '../src/toolforge-skill-command.mjs';
import { buildToolforgeSkillRunner, findToolforgeSkill } from '../src/server.mjs';

test('browser pure formatter exactly matches managed formatter for every pilot', async () => {
  const { formatInvocationCommand } = await import('../dashboard/toolforge-invocation.mjs');
  const managed = await import('file:///C:/dev/dev-sandbox/toolforge-read-only-pilot/skills/toolforge-cli/src/invoke-skill.mjs');
  const context = { nodeExecutable: "C:\\Node's\\node.exe", scriptPath: 'C:\\forge\\invoke-skill.mjs', workspaceRoots: ['C:\\work', "C:\\other's"] };
  const inputs = {
    'roadmap-validator': { roadmapPath: "C:\\work\\road's.md", strict: false, verbose: true },
    'agent-drift-detector': { agentName: 'agent \u00e9', expectedSchema: { "a'$`<html>": '"\\' }, actualSchema: {} },
    'retro-schema-validator': { filePaths: ['C:\\work\\b.json', 'C:\\work\\a.json'] }
  };
  for (const [id, input] of Object.entries(inputs)) {
    assert.equal(formatInvocationCommand(id, input, context), managed.formatInvocationCommand(id, input, context));
  }
});

test('copied browser command executes managed CLI with UTF-8 data and restores encoding', async () => {
  const { formatInvocationCommand } = await import('../dashboard/toolforge-invocation.mjs');
  const context = {
    nodeExecutable: process.execPath,
    scriptPath: 'C:/dev/dev-sandbox/toolforge-read-only-pilot/skills/toolforge-cli/src/invoke-skill.mjs',
    workspaceRoots: ['C:/dev/dev-sandbox/icf-read-only-pilot']
  };
  const agentName = ' agent \u00e9 \' "$ ` <html> ';
  for (const [input, expectedState, expectedOutcome, exitCode] of [
    [{ agentName, expectedSchema: { '\u00e9\'`$<html>': null }, actualSchema: { '\u00e9\'`$<html>': 'value' } }, 'completed', 'pass', 0],
    [{ agentName, expectedSchema: { missing: null }, actualSchema: {} }, 'completed', 'findings', 1],
    [{ agentName, expectedSchema: [], actualSchema: {} }, 'rejected', null, 2]
  ]) {
    const command = formatInvocationCommand('agent-drift-detector', input, context);
    const script = `$initialEncoding = [System.Text.UnicodeEncoding]::new($false,$true)\n$OutputEncoding = $initialEncoding\n${command}\n@{ restored = [object]::ReferenceEquals($initialEncoding,$OutputEncoding); exitCode = $LASTEXITCODE } | ConvertTo-Json -Compress`;
    const run = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 15000 });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stderr);
    const [envelope, check] = run.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(envelope.state, expectedState);
    assert.equal(envelope.outcome, expectedOutcome);
    if (expectedState === 'completed') assert.equal(envelope.result.agentName, agentName.trim());
    assert.deepEqual(check, { restored: true, exitCode });
  }
});

test('both legacy clipboard adapters return explicit success or failure while retaining toasts', async () => {
  for (const file of ['index.html', 'preview-enhanced.html']) {
    const html = await readFile(new URL(`../dashboard/${file}`, import.meta.url), 'utf8');
    const source = html.match(/function copyCommand\(cmd\) \{[\s\S]*?\n  \}/)[0];
    for (const [navigator, expected] of [[{ clipboard: { writeText: async () => {} } }, true], [{}, false], [{ clipboard: { writeText: async () => { throw new Error('denied'); } } }, false]]) {
      const messages = [];
      const actual = await vm.runInNewContext(`${source}; copyCommand('test')`, { navigator, showToast: message => messages.push(message) });
      assert.equal(actual, expected);
      assert.deepEqual(messages, [expected ? 'Copied: test' : 'Could not copy']);
    }
  }
});

test('Wikilink and Standup copy handle success, missing, synchronous, and rejected clipboard APIs', async () => {
  for (const file of ['index.html', 'preview-enhanced.html']) {
    const html = await readFile(new URL(`../dashboard/${file}`, import.meta.url), 'utf8');
    for (const family of ['copyWikilink', 'copyStandup']) {
      const source = html.match(new RegExp(`function ${family}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`))[0];
      for (const [navigator, expected] of [
        [{ clipboard: { writeText: async () => {} } }, true],
        [{}, false],
        [{ clipboard: { writeText() { throw new Error('denied'); } } }, false],
        [{ clipboard: { writeText: async () => { throw new Error('denied'); } } }, false]
      ]) {
        const messages = [];
        const result = await vm.runInNewContext(`${source}; ${family}('[[topics/test]]')`, { navigator, reportStandupText: 'Standup text', showToast: message => messages.push(message) });
        assert.equal(result, expected, `${file} ${family}`);
        assert.deepEqual(messages, [expected ? family === 'copyWikilink' ? 'Copied wikilink: [[topics/test]]' : 'Standup copied' : 'Could not copy']);
      }
      if (family === 'copyStandup') {
        const messages = [];
        const result = vm.runInNewContext(`${source}; copyStandup()`, { navigator: {}, reportStandupText: '', showToast: message => messages.push(message) });
        assert.equal(result, undefined);
        assert.deepEqual(messages, ['No standup for this day']);
      }
    }
    assert.ok(html.includes('data-copy-wikilink="${escapeHtml(`[[topics/${t.name}]]`)}"'));
    assert.ok(html.includes('onclick="copyWikilink(this.dataset.copyWikilink)"'));
    assert.ok(!html.includes("onclick=\"copyWikilink('[[topics/${t.name}]]')\""));
  }
});

test('dashboard scripts parse and dynamic Wikilinks keep hostile topic text as data', async () => {
  for (const file of ['index.html', 'preview-enhanced.html']) {
    const html = await readFile(new URL(`../dashboard/${file}`, import.meta.url), 'utf8');
    for (const [, attributes, source] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!attributes.includes('type="module"')) assert.doesNotThrow(() => new vm.Script(source), file);
    }
    const helper = html.match(/function escapeHtml\(str\) \{[\s\S]*?\n  \}/)[0];
    const renderer = html.match(/topicsContainer\.innerHTML = trm\.topics\.map\(t => `[\s\S]*?`\)\.join\(''\);/)[0];
    const topicsContainer = {};
    vm.runInNewContext(`${helper}; ${renderer}`, { topicsContainer, trm: { topics: [{ name: '\'"<script>$`&', modified: '" onclick="bad' }] } });
    assert.ok(topicsContainer.innerHTML.includes('data-copy-wikilink="[[topics/\'&quot;&lt;script&gt;$`&amp;]]"'));
    assert.ok(!topicsContainer.innerHTML.includes('<script>'));
    assert.ok(!topicsContainer.innerHTML.includes('title="Modified: " onclick="bad'));
  }
});

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
