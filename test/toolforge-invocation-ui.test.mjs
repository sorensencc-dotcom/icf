import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGatewayServer } from '../src/server.mjs';
import { mountToolforgeInvocation } from '../dashboard/toolforge-invocation.mjs';

test('both dashboards wire one shared dialog and available-pilot Configure controls', async () => {
  for (const file of ['index.html', 'preview-enhanced.html']) {
    const html = await readFile(new URL(`../dashboard/${file}`, import.meta.url), 'utf8');
    assert.match(html, /import \{ mountToolforgeInvocation \} from '\/dashboard\/toolforge-invocation.mjs'/);
    assert.match(html, /s\.inputInvocation\?\.available/);
    assert.match(html, /data-toolforge-configure/);
    assert.match(html, /mountToolforgeInvocation\(\{ inventory: \(\) => allSkills/);
    assert.match(html, /\.toast\s*\{\s*pointer-events:\s*none;/);
  }
});

// Minimal DOM contract double; native layout/focus trapping belongs to controller browser QA.
class Node {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc;
    this.children = []; this.listeners = {}; this.attributes = {};
    this.value = ''; this.textContent = ''; this.disabled = false;
    this.tabIndex = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(this.tagName) ? 0 : -1;
  }
  append(node) { node.parent = this; this.children.push(node); }
  replaceChildren() { this.children = []; }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(key, handler) { (this.listeners[key] ||= []).push(handler); }
  async fire(key, detail = {}) {
    const event = { preventDefault() {}, ...detail };
    for (const handler of this.listeners[key] || []) await handler(event);
  }
  focus() { this.ownerDocument.activeElement = this; }
  querySelectorAll() {
    const descendants = [];
    const walk = node => { node.children.forEach(child => { descendants.push(child); walk(child); }); };
    walk(this);
    return descendants.filter(node => ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(node.tagName) || node.attributes.tabindex !== undefined);
  }
  getClientRects() {
    for (let node = this; node; node = node.parent) if (node.hidden) return [];
    return [{}];
  }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
}
function harness(copyCommand, clipboard) {
  const doc = { createElement(tag) { return new Node(tag, this); }, defaultView: { navigator: clipboard ? { clipboard } : {} } };
  const root = new Node('main', doc);
  const context = { nodeExecutable: 'C:\\node.exe', scriptPath: 'C:\\forge\\invoke-skill.mjs', workspaceRoots: ['C:\\work'] };
  const inventory = ['roadmap-validator', 'agent-drift-detector', 'retro-schema-validator'].map(id => ({ id, name: id, inputInvocation: { contractVersion: 1, available: true, commandContext: context } }));
  inventory.push({ id: 'other', inputInvocation: { available: true } });
  const results = [];
  const mounted = mountToolforgeInvocation({ inventory, rootElement: root, copyCommand, onResult: result => results.push(result) });
  const nodes = () => { const list = []; const walk = node => { list.push(node); node.children.forEach(walk); }; walk(root); return list; };
  const tag = name => nodes().find(node => node.tagName === name.toUpperCase());
  const button = text => nodes().find(node => node.tagName === 'BUTTON' && node.textContent === text);
  const field = name => nodes().find(node => node.name === name);
  const status = () => nodes().find(node => node.attributes.role === 'status').textContent;
  const change = async (name, value) => { field(name).value = value; await field(name).parent.parent.fire('input'); };
  return { doc, inventory, root, mounted, nodes, tag, button, field, status, change, results, context };
}
const nativeResult = (skillId, outcome = 'pass') => {
  if (skillId === 'roadmap-validator') return outcome === 'pass' ? {
    status: 'success', message: 'Valid', data: { isValid: true, findings: [], syncMarkersPresent: true, contentLength: 10, validated: '2026-10-10T00:00:00Z' }
  } : { status: 'error', message: 'Missing markers', code: 'MISSING_MARKERS' };
  if (skillId === 'retro-schema-validator') return {
    status: 'success', verdict: outcome === 'pass' ? 'GREEN' : 'YELLOW', filesValidated: 1,
    violations: outcome === 'pass' ? [] : [{ file: 'C:\\work\\a.json', field: 'status', level: 'warning', message: 'Warning' }], timestamp: '2026-10-10T00:00:00Z'
  };
  return { agentName: 'agent', driftDetected: outcome === 'findings', missingFields: outcome === 'findings' ? ['missing'] : [], extraFields: [], recommendations: ['<script>data</script>'] };
};
const completed = (skillId, outcome = 'pass', result = nativeResult(skillId, outcome)) => ({
  contractVersion: 1, skillId, state: 'completed', outcome, result, error: null, durationMs: 1
});
const response = envelope => ({ ok: envelope.state === 'completed', json: async () => envelope });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function configurePilot(h, skillId) {
  h.mounted.open(skillId);
  if (skillId === 'agent-drift-detector') await h.change('agentName', 'agent');
  else if (skillId === 'roadmap-validator') await h.change('roadmapPath', 'C:\\work\\a.md');
  else {
    const input = h.nodes().find(node => node.tagName === 'INPUT');
    input.value = 'C:\\work\\a.json'; await input.parent.parent.parent.fire('input');
  }
}

test('malformed completed native results never certify success or unlock copy', async t => {
  let envelope;
  const copies = [];
  const h = harness(async value => { copies.push(value); return true; });
  t.mock.method(globalThis, 'fetch', async () => response(envelope));
  for (const skillId of h.inventory.slice(0, 3).map(skill => skill.id)) {
    await configurePilot(h, skillId);
    const valid = nativeResult(skillId);
    const missing = { ...valid }; delete missing[Object.keys(valid)[0]];
    const absent = completed(skillId); delete absent.result;
    for (const invalid of [null, [], 42, 'text', {}, missing, { ...valid, unexpected: true }].map(result => completed(skillId, 'pass', result)).concat(absent)) {
      envelope = invalid;
      await h.tag('form').fire('submit');
      assert.match(h.status(), /^Failed:/, skillId);
      assert.equal(h.button('Copy Command').disabled, true, skillId);
      assert.equal(h.tag('pre').textContent, '');
      await h.button('Copy Command').fire('click');
    }
  }
  assert.equal(copies.length, 0); assert.equal(h.results.length, 0);
  h.mounted.dispose();
});

test('native shape and outcome inconsistencies fail closed for every pilot', async t => {
  let envelope;
  const h = harness();
  t.mock.method(globalThis, 'fetch', async () => response(envelope));
  const roadmap = nativeResult('roadmap-validator');
  const retro = nativeResult('retro-schema-validator');
  const agent = nativeResult('agent-drift-detector');
  const malformed = {
    'roadmap-validator': [
      { status: 'success', message: 'No data' }, { status: 'error', message: 'No code' },
      { status: 'error', message: 'Runtime', code: 'SKILL_ERROR' },
      { ...roadmap, message: 1 }, { ...roadmap, code: null }, { ...roadmap, data: null },
      { ...roadmap, data: { ...roadmap.data, isValid: false } },
      { ...roadmap, data: { ...roadmap.data, contentLength: -1 } },
      { ...roadmap, data: { ...roadmap.data, validated: 'invalid' } },
      { ...roadmap, data: { ...roadmap.data, findings: [{ level: 'info', code: 'INFO', message: 'Data', line: 0 }] } }
    ],
    'agent-drift-detector': [
      { ...agent, agentName: ' ' }, { ...agent, driftDetected: 'false' },
      { ...agent, missingFields: [1] }, { ...agent, extraFields: null }, { ...agent, recommendations: 'text' },
      { ...agent, missingFields: ['missing'] }
    ],
    'retro-schema-validator': [
      { ...retro, filesValidated: 0 }, { ...retro, filesValidated: 33 }, { ...retro, filesValidated: 1.5 },
      { ...retro, timestamp: 'invalid' }, { ...retro, status: 'error' }, { ...retro, verdict: 'YELLOW' },
      { ...retro, violations: [{ file: 'a', field: 'b', level: 'info', message: 'c' }] },
      { ...retro, violations: [{ file: 1, field: 'b', level: 'warning', message: 'c' }] }
    ]
  };
  for (const [skillId, results] of Object.entries(malformed)) {
    await configurePilot(h, skillId);
    for (const result of results) {
      envelope = completed(skillId, 'pass', result); await h.tag('form').fire('submit');
      assert.match(h.status(), /^Failed:/); assert.equal(h.button('Copy Command').disabled, true);
    }
    for (const outcome of ['pass', 'findings']) {
      envelope = completed(skillId, outcome, nativeResult(skillId, outcome === 'pass' ? 'findings' : 'pass'));
      await h.tag('form').fire('submit');
      assert.match(h.status(), /^Failed:/); assert.equal(h.button('Copy Command').disabled, true);
    }
  }
  assert.equal(h.results.length, 0); h.mounted.dispose();
});

test('valid native pass/findings remain accepted, including optional Roadmap data', async t => {
  let envelope;
  const h = harness();
  t.mock.method(globalThis, 'fetch', async () => response(envelope));
  for (const skillId of h.inventory.slice(0, 3).map(skill => skill.id)) {
    await configurePilot(h, skillId);
    for (const outcome of ['pass', 'findings']) {
      envelope = completed(skillId, outcome); await h.tag('form').fire('submit');
      assert.equal(h.status(), `Completed / ${outcome === 'pass' ? 'Pass' : 'Findings'}`);
      assert.equal(h.button('Copy Command').disabled, false);
      assert.equal(h.tag('pre').textContent, JSON.stringify(envelope.result, null, 2));
    }
  }
  await configurePilot(h, 'roadmap-validator');
  for (const [result, outcome] of [
    [{ status: 'error', code: 'VALIDATION_FAILED', message: 'Roadmap validation failed (strict mode): 1 issues found' }, 'findings'],
    [{ ...nativeResult('roadmap-validator'), data: { ...nativeResult('roadmap-validator').data, findings: [{ level: 'warning', code: 'WARN', message: 'Warning', line: 1 }] } }, 'findings'],
    [{ status: 'error', message: 'Invalid', data: { ...nativeResult('roadmap-validator').data, isValid: false, findings: [{ level: 'error', code: 'ERROR', message: 'Error' }] } }, 'findings']
  ]) {
    envelope = completed('roadmap-validator', outcome, result); await h.tag('form').fire('submit');
    assert.equal(h.status(), 'Completed / Findings');
    assert.equal(h.button('Copy Command').disabled, false);
    assert.equal(h.tag('pre').textContent, JSON.stringify(result, null, 2));
  }
  await configurePilot(h, 'retro-schema-validator');
  envelope = completed('retro-schema-validator', 'findings', { ...nativeResult('retro-schema-validator', 'findings'), status: 'error', verdict: 'RED', violations: [{ file: 'a', field: 'b', level: 'error', message: 'c' }] });
  await h.tag('form').fire('submit'); assert.equal(h.button('Copy Command').disabled, false);
  h.mounted.dispose();
});

test('strict envelope fields reject absent/invalid duration and extra fields', async t => {
  let envelope;
  const h = harness();
  t.mock.method(globalThis, 'fetch', async () => response(envelope));
  await configurePilot(h, 'agent-drift-detector');
  const absent = completed('agent-drift-detector'); delete absent.durationMs;
  for (const invalid of [absent, ...[-1, null, '1'].map(durationMs => ({ ...completed('agent-drift-detector'), durationMs })), { ...completed('agent-drift-detector'), extra: true }]) {
    envelope = invalid; await h.tag('form').fire('submit');
    assert.match(h.status(), /^Failed:/); assert.equal(h.button('Copy Command').disabled, true);
  }
  h.mounted.dispose();
});

test('Retro revalidation clears aria-invalid on every dynamic path row', async () => {
  const h = harness(); await configurePilot(h, 'retro-schema-validator');
  await h.button('Add file').fire('click');
  const rows = h.nodes().filter(node => node.tagName === 'INPUT');
  rows[0].value = 'relative.json'; rows[1].value = 'C:\\work\\b.json';
  await rows[0].parent.parent.parent.fire('input');
  assert.equal(rows[0].attributes['aria-invalid'], 'true');
  rows[1].setAttribute('aria-invalid', 'true');
  rows[0].value = 'C:\\work\\a.json'; await rows[0].parent.parent.parent.fire('input');
  assert.equal(h.button('Run').disabled, false);
  for (const row of rows) assert.equal(row.attributes['aria-invalid'], undefined);
  h.mounted.dispose();
});

test('dialog Tab boundaries wrap both directions and skip hidden/disabled controls', async () => {
  const h = harness(); await configurePilot(h, 'agent-drift-detector');
  const dialog = h.tag('dialog');
  async function tab(from, shiftKey, expected, trapped = true) {
    from.focus();
    let prevented = false;
    await dialog.fire('keydown', { key: 'Tab', shiftKey, preventDefault() { prevented = true; } });
    assert.equal(prevented, trapped);
    assert.equal(h.doc.activeElement, expected);
  }
  await tab(h.button('Close'), false, h.button('Inputs'));
  await tab(h.button('Inputs'), true, h.button('Close'));
  await tab(h.field('agentName'), false, h.field('agentName'), false);
  await h.button('Result').fire('click');
  await tab(h.button('Close'), false, h.button('Result'));
  await tab(h.button('Result'), true, h.button('Close'));
  h.button('Close').disabled = true;
  await tab(h.button('Result'), false, h.button('Result'));
  await tab(h.button('Result'), true, h.button('Result'));
  h.button('Close').disabled = false;
  await configurePilot(h, 'retro-schema-validator');
  await h.button('Add file').fire('click');
  const paths = h.nodes().filter(node => node.tagName === 'INPUT');
  paths[1].value = 'C:\\work\\b.json'; await paths[1].parent.parent.parent.fire('input');
  h.button('Close').disabled = true;
  await tab(h.button('Run'), false, h.button('Inputs'));
  await tab(h.button('Inputs'), true, h.button('Run'));
  await tab(paths[1], false, paths[1], false);
  await dialog.fire('keydown', { key: 'Enter', preventDefault() { assert.fail('Non-Tab intercepted'); } });
  h.mounted.dispose();
});

test('dialog forms preserve defaults, validate JSON, bound explicit ordered list, and restore focus', async () => {
  const h = harness();
  const trigger = new Node('button', h.doc); trigger.focus();
  assert.equal(h.mounted.open('other', trigger), false);
  h.inventory[0].inputInvocation.available = false;
  assert.equal(h.mounted.open('roadmap-validator', trigger), false);
  h.inventory[0].inputInvocation.available = true;
  h.mounted.open('roadmap-validator', trigger);
  assert.equal(h.doc.activeElement, h.field('roadmapPath'));
  assert.equal(h.field('strict').checked, false);
  assert.equal(h.field('verbose').checked, false);
  assert.equal(h.button('Run').disabled, true);
  await h.change('roadmapPath', 'C:\\work\\a.md');
  assert.equal(h.button('Run').disabled, false);
  h.tag('dialog').close();
  assert.equal(h.doc.activeElement, trigger);
  assert.equal(h.field('roadmapPath'), undefined);
  h.mounted.open('agent-drift-detector', trigger);
  await h.change('agentName', ' a ');
  await h.change('expectedSchema', '[');
  assert.match(h.status(), /expectedSchema: Enter valid JSON/);
  assert.equal(h.button('Run').disabled, true);
  await h.change('expectedSchema', '[]');
  assert.match(h.status(), /expectedSchema: Expected a JSON object/);
  await h.change('expectedSchema', '{}');
  assert.equal(h.button('Run').disabled, false);
  h.tag('dialog').close();
  h.mounted.open('retro-schema-validator', trigger);
  for (let i = 1; i < 32; i++) await h.button('Add file').fire('click');
  assert.equal(h.button('Add file').disabled, true);
  assert.equal(h.nodes().filter(node => node.tagName === 'INPUT').length, 32);
  await h.button('Remove file').fire('click');
  assert.equal(h.button('Add file').disabled, false);
  const tabs = h.nodes().find(node => node.attributes.role === 'tablist');
  await tabs.fire('keydown', { key: 'ArrowRight' });
  assert.equal(h.doc.activeElement, h.button('Result'));
  await tabs.fire('keydown', { key: 'ArrowLeft' });
  assert.equal(h.doc.activeElement, h.button('Inputs'));
  await h.tag('dialog').fire('cancel');
  assert.equal(h.tag('dialog').open, false);
  h.mounted.dispose(); assert.equal(h.root.children.length, 0);
});

test('copy requires unchanged server completion and exact normalized command; edits clear result', async t => {
  const copies = [], calls = [];
  const h = harness(async text => { copies.push(text); return true; });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options]); return response(completed('agent-drift-detector', 'findings'));
  });
  h.mounted.open('agent-drift-detector');
  await h.change('agentName', ' a ');
  assert.equal(h.button('Copy Command').disabled, true);
  await h.tag('form').fire('submit');
  assert.equal(calls[0][0], '/api/toolforge/invoke');
  assert.deepEqual(JSON.parse(calls[0][1].body), { skillId: 'agent-drift-detector', input: { agentName: 'a', expectedSchema: {}, actualSchema: {} } });
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json');
  assert.equal(h.status(), 'Completed / Findings');
  assert.match(h.tag('pre').textContent, /<script>data<\/script>/);
  await h.button('Copy Command').fire('click');
  const { formatInvocationCommand } = await import('../dashboard/toolforge-invocation.mjs');
  assert.equal(copies[0], formatInvocationCommand('agent-drift-detector', JSON.parse(calls[0][1].body).input, h.context));
  assert.equal(h.status(), 'Copied command');
  await h.change('agentName', 'b');
  assert.equal(h.button('Copy Command').disabled, true);
  assert.equal(h.tag('pre').textContent, '');
  await h.button('Copy Command').fire('click'); assert.equal(copies.length, 1);
  h.mounted.dispose();
});

test('duplicate run, cancel, close, and stale completion cannot overwrite current dialog', async t => {
  const pending = [];
  const h = harness();
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => pending.push({ options, resolve })));
  h.mounted.open('roadmap-validator'); await h.change('roadmapPath', 'C:\\work\\a.md');
  const first = h.tag('form').fire('submit'); await tick();
  await h.tag('form').fire('submit'); assert.equal(pending.length, 1);
  await h.button('Cancel').fire('click');
  assert.equal(pending[0].options.signal.aborted, true);
  assert.equal(h.status(), 'Cancelled');
  assert.equal(h.button('Copy Command').disabled, true);
  h.tag('dialog').close(); h.mounted.open('agent-drift-detector'); await h.change('agentName', 'new');
  const second = h.tag('form').fire('submit'); await tick();
  pending[0].resolve(response(completed('roadmap-validator'))); await first;
  assert.equal(h.status(), 'Running');
  pending[1].resolve(response(completed('agent-drift-detector'))); await second;
  assert.equal(h.status(), 'Completed / Pass'); assert.equal(h.results.length, 1);
  await h.button('Inputs').fire('click');
  const third = h.tag('form').fire('submit'); await tick();
  h.tag('dialog').close(); assert.equal(pending[2].options.signal.aborted, true);
  pending[2].resolve(response(completed('agent-drift-detector'))); await third;
  assert.equal(h.status(), ''); assert.equal(h.button('Copy Command').disabled, true);
  h.mounted.dispose();
});

test('failure states preserve fields and never unlock copy; malformed response fails closed', async t => {
  let envelope;
  const h = harness();
  t.mock.method(globalThis, 'fetch', async () => response(envelope));
  h.mounted.open('agent-drift-detector'); await h.change('agentName', 'agent');
  for (const state of ['rejected', 'unavailable', 'failed', 'timed_out', 'cancelled']) {
    envelope = { ...completed('agent-drift-detector'), state, outcome: null, result: null, error: { code: 'INPUT_INVALID', message: '<b>Invalid</b>', fieldErrors: { agentName: 'invalid' } } };
    await h.tag('form').fire('submit');
    assert.equal(h.field('agentName').value, 'agent');
    assert.equal(h.tag('form').hidden, false);
    assert.equal(h.button('Copy Command').disabled, true);
    assert.equal(h.tag('pre').textContent, '');
    assert.match(h.status(), /<b>Invalid<\/b>/);
  }
  envelope = { ...completed('agent-drift-detector'), contractVersion: 2 };
  await h.tag('form').fire('submit');
  assert.match(h.status(), /Failed: Invalid invocation response/);
  assert.equal(h.button('Copy Command').disabled, true);
  h.mounted.dispose();
});

test('null-ID pre-parse 413 and 403 remain honest rejections and preserve input', async t => {
  let envelope, httpStatus;
  const h = harness();
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: httpStatus, json: async () => envelope }));
  h.mounted.open('agent-drift-detector'); await h.change('agentName', 'agent');
  for (const [status, code] of [[413, 'PAYLOAD_TOO_LARGE'], [403, 'FORBIDDEN']]) {
    httpStatus = status;
    envelope = { contractVersion: 1, skillId: null, state: 'rejected', outcome: null, result: null, error: { code, message: 'Request rejected.' }, durationMs: 0 };
    await h.tag('form').fire('submit');
    assert.equal(h.status(), `Rejected\n${code}: Request rejected.`);
    assert.equal(h.field('agentName').value, 'agent');
    assert.equal(h.button('Copy Command').disabled, true);
  }
  for (const invalid of [completed(null), { ...envelope, result: {} }, { ...envelope, outcome: 'pass' }, { ...envelope, error: null }, { ...envelope, skillId: 'roadmap-validator' }]) {
    envelope = invalid;
    await h.tag('form').fire('submit');
    assert.match(h.status(), /Failed: Invalid invocation response/);
    assert.equal(h.button('Copy Command').disabled, true);
  }
  h.mounted.dispose();
});

test('clipboard missing, rejected, false, or swallowed rejection never reports success', async t => {
  t.mock.method(globalThis, 'fetch', async () => response(completed('agent-drift-detector')));
  for (const callback of [undefined, async () => { throw new Error('denied'); }, async () => false, async () => undefined]) {
    const h = harness(callback);
    h.mounted.open('agent-drift-detector'); await h.change('agentName', 'agent'); await h.tag('form').fire('submit');
    await h.button('Copy Command').fire('click');
    assert.equal(h.status(), 'Could not copy command');
    assert.equal(h.button('Copy Command').disabled, false);
    h.mounted.dispose();
  }
});

test('late clipboard success cannot overwrite edited or closed state', async t => {
  let resolveCopy;
  const h = harness(() => new Promise(resolve => { resolveCopy = resolve; }));
  t.mock.method(globalThis, 'fetch', async () => response(completed('agent-drift-detector')));
  h.mounted.open('agent-drift-detector'); await h.change('agentName', 'agent'); await h.tag('form').fire('submit');
  const copying = h.button('Copy Command').fire('click'); await tick();
  await h.change('agentName', 'changed'); resolveCopy(true); await copying;
  assert.equal(h.status(), ''); assert.equal(h.button('Copy Command').disabled, true);
  h.mounted.dispose();
});

test('edits abort active invocation; delayed native close event cannot erase reopened dialog', async t => {
  let finish, signal;
  const h = harness();
  t.mock.method(globalThis, 'fetch', (url, options) => {
    signal = options.signal; return new Promise(resolve => { finish = resolve; });
  });
  h.mounted.open('agent-drift-detector'); await h.change('agentName', 'agent');
  const running = h.tag('form').fire('submit'); await tick();
  await h.change('agentName', 'changed'); assert.equal(signal.aborted, true);
  finish(response(completed('agent-drift-detector'))); await running;
  assert.equal(h.button('Copy Command').disabled, true); assert.equal(h.status(), '');
  h.tag('dialog').close(); h.mounted.open('roadmap-validator');
  await h.tag('dialog').fire('close');
  assert.ok(h.field('roadmapPath')); assert.equal(h.tag('dialog').open, true);
  h.mounted.dispose();
});

test('module retains no HTML interpolation, browser storage, or supervisor import', async () => {
  const source = await readFile(new URL('../dashboard/toolforge-invocation.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|import\s/);
});

test('shared module serves JavaScript without exposing managed supervisor', async () => {
  const server = createGatewayServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/dashboard/toolforge-invocation.mjs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${base}/skills/toolforge-cli/src/invoke-skill.mjs`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('client validates exact adapter fields and normalization', async () => {
  const { validateInvocationInput } = await import('../dashboard/toolforge-invocation.mjs');
  assert.deepEqual(validateInvocationInput('roadmap-validator', { roadmapPath: 'C:\\work\\a.md' }), {
    roadmapPath: 'C:\\work\\a.md', strict: false, verbose: false
  });
  assert.deepEqual(validateInvocationInput('agent-drift-detector', { agentName: ' agent ', expectedSchema: {}, actualSchema: {} }), {
    agentName: 'agent', expectedSchema: {}, actualSchema: {}
  });
  for (const input of [null, [], {}, { roadmapPath: 'a.md' }, { roadmapPath: 'C:\\a.md', strict: 'false' }, { roadmapPath: 'C:\\a.md', extra: true }]) {
    assert.throws(() => validateInvocationInput('roadmap-validator', input));
  }
  for (const schema of [null, [], 1, 'x', true]) {
    assert.throws(() => validateInvocationInput('agent-drift-detector', { agentName: 'a', expectedSchema: schema, actualSchema: {} }));
  }
  for (const filePaths of [[], Array(33).fill('C:\\a.json'), ['C:\\a.json', 'C:\\a.json'], ['relative.json']]) {
    assert.throws(() => validateInvocationInput('retro-schema-validator', { filePaths }));
  }
  const paths = ['C:\\b.json', 'C:\\a.json'];
  assert.deepEqual(validateInvocationInput('retro-schema-validator', { filePaths: paths }), { filePaths: paths });
});
