import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { getPullRequests } from '../src/server.mjs';

test('getPullRequests fetches and caches PRs from GitHub', async (t) => {
  const originalExecSync = cp.execSync;
  const originalDateNow = Date.now;

  try {
    let mockTime = originalDateNow() + 1000000;
    Date.now = () => mockTime;

    let execCalls = 0;
    cp.execSync = (command, options) => {
      execCalls++;
      assert.ok(command.includes('gh pr list'));
      assert.equal(options.encoding, 'utf8');
      return JSON.stringify([
        { number: 1, title: 'Test PR 1', state: 'OPEN' },
        { number: 2, title: 'Test PR 2', state: 'MERGED' }
      ]);
    };

    // 1. First call should execute CLI and populate cache
    const prs1 = getPullRequests();
    assert.equal(execCalls, 1, `execCalls was ${execCalls}`);
    assert.equal(prs1.length, 2);
    assert.equal(prs1[0].number, 1);

    // 2. Second call within TTL should use cache
    mockTime += 10000; // 10 seconds later
    const prs2 = getPullRequests();
    assert.equal(execCalls, 1); // Not called again
    assert.deepEqual(prs1, prs2);

    // 3. Third call after TTL should execute CLI again
    mockTime += 60000; // 60 more seconds later (past 60s TTL)
    const prs3 = getPullRequests();
    assert.equal(execCalls, 2); // Called again
    assert.deepEqual(prs1, prs3);

    // 4. Test error handling
    mockTime += 1000000; // Force cache expiration
    cp.execSync = () => {
      throw new Error('Command failed');
    };

    const prs4 = getPullRequests();
    // In error case it falls back to the old cache value, which is prs3
    assert.deepEqual(prs4, prs3);

  } finally {
    cp.execSync = originalExecSync;
    Date.now = originalDateNow;
  }
});
