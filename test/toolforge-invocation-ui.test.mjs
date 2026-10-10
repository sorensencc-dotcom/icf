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
const completed = (skillId, outcome = 'pass', result = { message: '<script>data</script>' }) => ({
  contractVersion: 1, skillId, state: 'completed', outcome, result, error: null, durationMs: 1
});
const response = envelope => ({ ok: envelope.state === 'completed', json: async () => envelope });
const tick = () => new Promise(resolve => setImmediate(resolve));

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
