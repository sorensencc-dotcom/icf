import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { directiveOf } from './priority-index.mjs';

export const WRITER_HOLDERS = ['Claude Code', 'Muse', 'Helix'];
export const SEAT_REPOS = ['toolforge', 'sigil', 'rewrite-mcp', 'icf'];

export function writerSeatsPath(inboxDir) {
  return resolve(inboxDir, 'writer-seats.json');
}

export function normalizeRepoKey(target) {
  const raw = String(target || '').trim();
  if (!raw) return '';
  const leaf = raw.includes('/') ? raw.split('/').pop() : raw;
  return leaf.toLowerCase();
}

export function readWriterSeats(inboxDir) {
  const path = writerSeatsPath(inboxDir);
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const seats = Array.isArray(data) ? data : data.seats;
    if (!Array.isArray(seats)) return [];
    return seats
      .filter((seat) => seat && seat.repo)
      .map((seat) => ({ repo: String(seat.repo), holder: seat.holder || null }));
  } catch {
    return [];
  }
}

export function displaySeats(seats) {
  const byRepo = new Map((seats || []).map((seat) => [normalizeRepoKey(seat.repo), seat.holder || null]));
  const repos = [...SEAT_REPOS];
  for (const seat of seats || []) {
    if (!repos.some((repo) => normalizeRepoKey(repo) === normalizeRepoKey(seat.repo))) repos.push(seat.repo);
  }
  return repos.map((repo) => ({ repo, holder: byRepo.get(normalizeRepoKey(repo)) || null }));
}

export function writeWriterSeat(inboxDir, repo, holder) {
  const key = String(repo || '').trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
    throw Object.assign(new Error('Invalid writer seat'), { statusCode: 400 });
  }
  const nextHolder = holder === null || holder === '' || holder === undefined ? null : String(holder);
  if (nextHolder && !WRITER_HOLDERS.includes(nextHolder)) {
    throw Object.assign(new Error('Invalid writer. Use Claude Code, Muse, or Helix.'), { statusCode: 400 });
  }
  const seats = readWriterSeats(inboxDir).filter((seat) => normalizeRepoKey(seat.repo) !== normalizeRepoKey(key));
  if (nextHolder) seats.push({ repo: key, holder: nextHolder });
  const path = writerSeatsPath(inboxDir);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ seats }, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
  return displaySeats(seats);
}

export function writerBlock(seats, target) {
  const key = normalizeRepoKey(target);
  if (!key) return null;
  const seat = (seats || []).find((item) => normalizeRepoKey(item.repo) === key || normalizeRepoKey(item.target) === key);
  if (!seat?.holder || seat.holder === 'Forge worker') return null;
  return seat.holder;
}

export function isResearchOnly(card, nonCodeTargets) {
  if (!card) return false;
  if (directiveOf(card) === 'RESEARCH') return true;
  const target = String(card.target || card.domain || '').trim().toLowerCase();
  return Boolean(nonCodeTargets && nonCodeTargets.has(target));
}

export function decideApproval(card, seats, { nonCodeTargets } = {}) {
  if (!card) return { ok: false, status: 404, error: 'Card not found in the ledger' };
  if (card.approved || card.promotion_locked) {
    return { ok: false, status: 409, error: 'Already approved. The card is locked against a second promotion.' };
  }
  if (isResearchOnly(card, nonCodeTargets)) {
    return { ok: false, status: 409, error: 'Research cards do not enter the build worker. Run a spike.' };
  }
  return { ok: true, status: 200, blockedBy: writerBlock(seats, card.target || card.domain || card.repo) };
}

export function approvalPatch(now = new Date()) {
  return {
    approved: true,
    promotion_locked: true,
    approved_at: now.toISOString()
  };
}
