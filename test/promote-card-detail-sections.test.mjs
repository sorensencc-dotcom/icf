import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../dashboard/index.html'), 'utf8');

function loadBuilder() {
  const start = html.indexOf('function buildCardDetailSections');
  assert.ok(start >= 0, 'buildCardDetailSections missing from dashboard');
  const end = html.indexOf('function commitTypeForCard', start);
  return vm.runInNewContext(`(${html.slice(start, end).trim()})`);
}

test('promote body includes context, execution plan, and deliverables', () => {
  const out = loadBuilder()({
    context: { raw_input: 'roadmap hook' },
    execution_plan: [{ step: 1, action: 'triage', command: 'triage it' }],
    deliverables: 'Hook blocks stray roadmaps'
  });
  assert.match(out, /### Context/);
  assert.match(out, /"raw_input": "roadmap hook"/);
  assert.match(out, /### Execution plan\n1\. triage - `triage it`/);
  assert.match(out, /### Deliverables & acceptance criteria\nHook blocks stray roadmaps/);
});

test('promote body warns when the source document body was not fetched', () => {
  const out = loadBuilder()({ context: { note: 'body text fetch failed: 401 Unauthorized' } });
  assert.match(out, /source document body was not fetched/);
});

test('promote body adds nothing for a card without structured sections', () => {
  assert.equal(loadBuilder()({}), '');
});
