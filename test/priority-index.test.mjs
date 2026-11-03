import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agingFactor, directiveOf, scorePriorityIndex } from '../src/priority-index.mjs';

const NOW = Date.parse('2026-11-03T12:00:00Z');

test('dashboard shows an index column and can score cards without a gateway restart', () => {
  const html = readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="sortIconIndex"/);
  assert.match(html, /function clientPriorityIndex/);
  assert.match(html, /Open queue sorts by priority index/);
  assert.match(html, /tr class="backlog-card"/);
  assert.match(html, /--heat:/);
  assert.equal(html.includes('Sort by priority index">Priority'), false);
});

test('priority index keeps manual priority as a nudge and does not invent a harvest ROI', () => {
  const aged = scorePriorityIndex({
    id: 'act-aged',
    category: 'IMPLEMENT',
    priority: 'P2',
    created_at: '2026-10-01T00:00:00Z',
    roi_score: 80,
    velocity_delta: 10
  }, NOW);
  const fresh = scorePriorityIndex({
    id: 'act-fresh',
    category: 'RESEARCH',
    priority: 'P1',
    created_at: '2026-11-03T00:00:00Z'
  }, NOW);

  assert.equal(aged.directive, 'IMPLEMENT');
  assert.equal(fresh.directive, 'RESEARCH');
  assert.equal(aged.roi_known, true);
  assert.equal(fresh.roi_known, false);
  assert.equal(fresh.roi, 0);
  assert.equal(aged.nudge, 0);
  assert.equal(fresh.nudge, 6);
  assert.equal(aged.aging, 1.55);
  assert.ok(aged.index > fresh.index);
});

test('aging gate steps at 2, 4, 6, and 7 days', () => {
  assert.equal(agingFactor(1.9), 1);
  assert.equal(agingFactor(2), 1.05);
  assert.equal(agingFactor(4), 1.15);
  assert.equal(agingFactor(6), 1.35);
  assert.equal(agingFactor(7), 1.55);
});

test('directive reads category before a research receipt', () => {
  assert.equal(directiveOf({ category: 'EVALUATE', research_ref: 'wiki/rfc.md' }), 'EVALUATE');
  assert.equal(directiveOf({ research_ref: 'wiki/rfc.md' }), 'RESEARCH');
  assert.equal(directiveOf({ action_type: 'IMPLEMENT', research_ref: 'wiki/rfc.md' }), 'IMPLEMENT');
  assert.equal(directiveOf({ direction: 'FEASIBILITY_SPIKE' }), 'EVALUATE');
});

test('a 13-digit action id is an epoch, not a calendar date', () => {
  const score = scorePriorityIndex({ id: 'act-1793573707624', priority: 'P2' }, NOW);
  assert.ok(score.age_days > 0);
  assert.equal(score.directive, 'IMPLEMENT');
});
