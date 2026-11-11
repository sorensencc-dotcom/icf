import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalCardSlug, buildTrmBacklogCards, promoteRefusalReason } from '../src/server.mjs';
import { canonicalCardSlug as watcherCanonicalCardSlug, archiveOlderPendingVersions } from '../../scripts/trm-ingress-watcher.mjs';

test('canonicalCardSlug normalizes slot-indexed and target-indexed IDs to identical slugs', () => {
  const pairs = [
    ['act-01-provable-inference-zksnark-verifier', 'act-trm-provable-inference-zksnark-verifier'],
    ['act-02-two-pass-finder-verifier-pr-review', 'act-toolforge-two-pass-finder-verifier-pr-review'],
    ['act-02-shop-pay-agent-token-vault', 'act-sigil-shop-pay-agent-token-vault'],
    ['act-03-enterprise-ai-transformation-metrics', 'act-rewritemcp-enterprise-ai-transformation-metrics'],
    ['act-04-quantum-complexity-aaronson-ambainis-conjecture', 'act-kbsync-quantum-complexity-aaronson-ambainis-conjecture']
  ];

  for (const [slotId, targetId] of pairs) {
    const slug1 = canonicalCardSlug(slotId);
    const slug2 = canonicalCardSlug(targetId);
    assert.ok(slug1, `Slug for ${slotId} should not be empty`);
    assert.equal(slug1, slug2, `Expected identical slugs for ${slotId} and ${targetId}`);

    // Ingress watcher canonicalCardSlug parity
    const watcherSlug1 = watcherCanonicalCardSlug(slotId);
    const watcherSlug2 = watcherCanonicalCardSlug(targetId);
    assert.equal(watcherSlug1, slug1);
    assert.equal(watcherSlug2, slug2);
  }
});

test('buildTrmBacklogCards deduplicates twin cards and merges status, PR branch, and alias_ids', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'icf-trm-dedup-test-'));
  const ledgerPath = join(tempDir, 'ledger.jsonl');

  const card1 = {
    id: 'act-01-provable-inference-zksnark-verifier',
    status: 'STAGED',
    priority: 'P2',
    category: 'IMPLEMENT',
    intent: 'provable_inference_zksnark_verifier',
    summary: 'Mobile action item: Provable Inference Zksnark Verifier',
    created_at: '2026-11-08T10:00:00.000Z'
  };

  const card2 = {
    id: 'act-trm-provable-inference-zksnark-verifier',
    status: 'IN_PROGRESS',
    priority: 'P1',
    category: 'IMPLEMENT',
    intent: 'Provable Inference Zksnark Verifier',
    summary: 'Provable inference verification via zkSNARK circuits',
    created_at: '2026-11-08T10:05:00.000Z',
    issue_url: 'https://github.com/sorensencc-dotcom/sigil/issues/220',
    pr_branch: 'trm/act-01-provable-inference-zksnark-verifier'
  };

  writeFileSync(ledgerPath, [JSON.stringify(card1), JSON.stringify(card2)].join('\n'), 'utf8');

  try {
    const cards = await buildTrmBacklogCards(tempDir);
    const matches = cards.filter(c => c.id.includes('provable-inference-zksnark-verifier') || (c.alias_ids && c.alias_ids.some(a => a.includes('provable-inference-zksnark-verifier'))));
    assert.equal(matches.length, 1, 'Twin cards should merge into exactly 1 backlog card');
    const merged = matches[0];
    assert.equal(merged.status, 'IN_PROGRESS', 'Should retain highest status (IN_PROGRESS over STAGED)');
    assert.equal(merged.issue_url, 'https://github.com/sorensencc-dotcom/sigil/issues/220');
    assert.equal(merged.pr_branch, 'trm/act-01-provable-inference-zksnark-verifier');
    assert.equal(merged.summary, 'Provable inference verification via zkSNARK circuits');
    assert.ok(Array.isArray(merged.alias_ids));
    assert.ok(merged.alias_ids.includes('act-01-provable-inference-zksnark-verifier'));
    assert.ok(merged.alias_ids.includes('act-trm-provable-inference-zksnark-verifier'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('promoteRefusalReason rejects cards when an active twin alias already exists', () => {
  const existingRows = [
    {
      id: 'act-trm-provable-inference-zksnark-verifier',
      status: 'IN_PROGRESS',
      issue_url: 'https://github.com/sorensencc-dotcom/sigil/issues/220'
    }
  ];

  const candidateCard = {
    id: 'act-01-provable-inference-zksnark-verifier',
    status: 'STAGED'
  };

  const refusal = promoteRefusalReason({
    cardId: candidateCard.id,
    cardData: candidateCard,
    ledgerRows: existingRows
  });
  assert.ok(refusal, 'Should refuse promotion when active twin alias exists');
  assert.match(refusal, /already promoted via alias act-trm-provable-inference-zksnark-verifier/);
});

test('promoteRefusalReason permits promotion with user-provided body even if ingestion body fetch failed', () => {
  const quarantinedCard = {
    id: 'act-kbsync-ingress-gdoc-export-fallback',
    status: 'QUARANTINED_INSUFFICIENT_DATA',
    context: { body_fetch_failed: true }
  };

  const defaultRefusal = promoteRefusalReason({
    cardId: quarantinedCard.id,
    cardData: quarantinedCard,
    hasUserProvidedBody: false
  });
  assert.ok(defaultRefusal, 'Should refuse promotion when automated/headless with body_fetch_failed');
  assert.equal(defaultRefusal, 'source document body was not fetched');

  const overrideRefusal = promoteRefusalReason({
    cardId: quarantinedCard.id,
    cardData: quarantinedCard,
    hasUserProvidedBody: true
  });
  assert.equal(overrideRefusal, null, 'Should permit promotion when operator provides issue body');
});

test('archiveOlderPendingVersions archives older pending cards matching the canonical slug', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'ingress-watcher-dedup-test-'));
  const pendingDir = join(tempDir, 'pending');
  const archiveDir = join(tempDir, 'archive');
  mkdirSync(pendingDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  const oldFile = 'act-01-provable-inference-zksnark-verifier.json';
  writeFileSync(join(pendingDir, oldFile), JSON.stringify({ id: 'act-01-provable-inference-zksnark-verifier' }), 'utf8');

  try {
    archiveOlderPendingVersions('act-trm-provable-inference-zksnark-verifier', 'act-trm-provable-inference-zksnark-verifier.json', pendingDir, archiveDir);
    assert.equal(existsSync(join(pendingDir, oldFile)), false, 'Old pending card should be removed from pending');
    assert.equal(existsSync(join(archiveDir, oldFile)), true, 'Old pending card should be archived');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
