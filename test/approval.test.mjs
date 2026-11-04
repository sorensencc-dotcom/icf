import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideApproval, displaySeats, readWriterSeats, writeWriterSeat, writerBlock } from '../src/approval.mjs';

const NON_CODE = new Set(['cic-kb', 'research']);

test('writer seat blocks rewrite-mcp and ignores an empty seat', () => {
  const seats = [{ repo: 'rewrite-mcp', holder: 'Claude Code' }, { repo: 'sigil', holder: null }];
  assert.equal(writerBlock(seats, 'rewrite-mcp'), 'Claude Code');
  assert.equal(writerBlock(seats, 'sorensencc-dotcom/sigil'), null);
  assert.equal(writerBlock(seats, 'toolforge'), null);
});

test('research cards are refused and an implement card can lock', () => {
  const research = decideApproval({ id: 'a', category: 'RESEARCH', target: 'toolforge' }, [], { nonCodeTargets: NON_CODE });
  assert.equal(research.ok, false);
  assert.equal(research.status, 409);
  const topic = decideApproval({ id: 'b', category: 'IMPLEMENT', target: 'cic-kb' }, [], { nonCodeTargets: NON_CODE });
  assert.equal(topic.ok, false);
  const open = decideApproval({ id: 'c', category: 'IMPLEMENT', target: 'sigil' }, [], { nonCodeTargets: NON_CODE });
  assert.equal(open.ok, true);
  assert.equal(open.blockedBy, null);
  const held = decideApproval({ id: 'c', category: 'EVALUATE', target: 'rewrite-mcp' }, [{ repo: 'rewrite-mcp', holder: 'Muse' }], { nonCodeTargets: NON_CODE });
  assert.equal(held.ok, true);
  assert.equal(held.blockedBy, 'Muse');
  const locked = decideApproval({ id: 'c', category: 'IMPLEMENT', target: 'sigil', promotion_locked: true }, [], { nonCodeTargets: NON_CODE });
  assert.equal(locked.status, 409);
});

test('writer seats persist in the inbox and do not invent a holder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seats-'));
  try {
    assert.deepEqual(readWriterSeats(dir), []);
    const seats = writeWriterSeat(dir, 'rewrite-mcp', 'Helix');
    assert.equal(displaySeats(seats).find((seat) => seat.repo === 'rewrite-mcp').holder, 'Helix');
    const cleared = writeWriterSeat(dir, 'rewrite-mcp', null);
    assert.equal(cleared.find((seat) => seat.repo === 'rewrite-mcp').holder, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
