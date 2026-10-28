import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { getPullRequests } from '../src/server.mjs';

// getPullRequests shells out to `gh pr list` once per configured repo.
const REPO_COUNT = 2;

test('getPullRequests fetches and caches PRs from GitHub', async (t) => {
  const originalExecFileSync = cp.execFileSync;
  const originalDateNow = Date.now;

  try {
    let mockTime = originalDateNow() + 1000000;
    Date.now = () => mockTime;

    let execCalls = 0;
    cp.execFileSync = (file, args, options) => {
      execCalls++;
      assert.equal(file, 'gh');
      assert.deepEqual(args.slice(0, 2), ['pr', 'list']);
      assert.equal(options.encoding, 'utf8');
      const repo = args[args.indexOf('--repo') + 1];
      return JSON.stringify([
        { number: 1, title: 'Test PR 1', state: 'OPEN', repo },
        { number: 2, title: 'Test PR 2', state: 'MERGED', repo }
      ]);
    };

    // 1. First call should execute CLI per repo and populate cache
    const prs1 = getPullRequests();
    assert.equal(execCalls, REPO_COUNT, `execCalls was ${execCalls}`);
    assert.equal(prs1.length, 2 * REPO_COUNT);
    assert.equal(prs1[0].number, 1);

    // 2. Second call within TTL should use cache
    mockTime += 10000; // 10 seconds later
    const prs2 = getPullRequests();
    assert.equal(execCalls, REPO_COUNT); // Not called again
    assert.deepEqual(prs1, prs2);

    // 3. Third call after TTL should execute CLI again
    mockTime += 60000; // 60 more seconds later (past 60s TTL)
    const prs3 = getPullRequests();
    assert.equal(execCalls, 2 * REPO_COUNT); // Called again
    assert.deepEqual(prs1, prs3);

    // 4. Test error handling
    mockTime += 1000000; // Force cache expiration
    cp.execFileSync = () => {
      throw new Error('Command failed');
    };

    const prs4 = getPullRequests();
    // In error case it falls back to the old cache value, which is prs3
    assert.deepEqual(prs4, prs3);

  } finally {
    cp.execFileSync = originalExecFileSync;
    Date.now = originalDateNow;
  }
});
