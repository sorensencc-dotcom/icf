import { createServer } from 'node:http';
import { readToolforgeInventory, createToolforgeInvocationConsumer, TOOLFORGE_PILOTS, toolforgeHttpFailure } from './toolforge-inventory.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync, watch } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import zlib from 'node:zlib';
import { LocalFileAdapterTransport } from './adapters/LocalFileAdapterTransport.mjs';
import { createReportingServer } from '../reporting/src/server.mjs';
import { createSnapshotStore } from '../reporting/src/snapshot-store.mjs';
import { createHistoryAdapter } from '../reporting/src/history-adapter.mjs';
import { validateWeeklyRetroReport } from '../reporting/src/weekly-retro-contract.mjs';
import { weekRange, SUPPORTED_TREND_WINDOWS } from '../reporting/src/trend-summary.mjs';
import { createMobileSnapshotService } from './mobile-snapshot.mjs';
import { CATEGORY_REGISTRY } from '../reporting/src/weekly-retro-contract.mjs';
import { skillId } from './toolforge-skill-command.mjs';

let prCache = { timestamp: 0, prs: [] };
const PR_CACHE_TTL_MS = 60_000;

export function getPullRequests() {
  const now = Date.now();
  if (now - prCache.timestamp < PR_CACHE_TTL_MS && prCache.prs.length > 0) {
    return prCache.prs;
  }
  try {
    const raw = execSync('gh pr list --repo sorensencc-dotcom/toolforge --limit 20 --state all --json number,title,state,url,createdAt,mergedAt,headRefName', {
      cwd: resolve(ROOT, '..'),
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const parsed = JSON.parse(raw);
    prCache = { timestamp: now, prs: parsed };
    return parsed;
  } catch {
    return prCache.prs || [];
  }
}

export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});
export const ROOT = resolve(__dirname, '..');
export const DASHBOARD_DIR = resolve(ROOT, 'dashboard');
// TRM_INBOX_DIR lets tests mutate a temp ledger instead of the live trm-drive inbox.
export const trmInboxDir = () => (process.env.TRM_INBOX_DIR ? resolve(process.env.TRM_INBOX_DIR) : resolve(ROOT, '../trm-drive/inbox'));
export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
export const HOST = process.env.ICF_HOST || '0.0.0.0';
export const RETRO_PATH = process.env.HELIX_WEEKLY_RETRO_PATH || resolve(ROOT, '../.icf-retros/weekly/latest-weekly-retro.json');
export const REPORTING_HISTORY_SOURCE_SYSTEM = 'icf';
export const REPORTING_HISTORY_SOURCE_ID = 'weekly-retro';
export const TOOLFORGE_ROOT = resolve(ROOT, '..');
export const TOOLFORGE_MANIFEST = resolve(TOOLFORGE_ROOT, 'manifest.json');

const TELEMETRY_DIR = resolve(ROOT, '../modules/telemetry');
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const COMMIT_CACHE_TTL_MS = 5 * 60_000;
const DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/;

// Meridian reports carry AI-written text about the operator's day; serve them to this machine only.
export function isLoopback(address) {
  return LOOPBACK_ADDRESSES.has(address);
}

function importTelemetry(file) {
  return import(`file://${resolve(TELEMETRY_DIR, file).replace(/\\/g, '/')}`);
}

export function findToolforgeSkill(target, manifestPath = TOOLFORGE_MANIFEST) {
  const value = String(target || '').trim();
  if (!value) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return (manifest.skills || []).find(skill => skillId(skill) === value || skill.name === value) || null;
  } catch {
    return null;
  }
}

export function buildToolforgeSkillRunner(target, manifestPath = TOOLFORGE_MANIFEST, toolforgeRoot = TOOLFORGE_ROOT) {
  try {
    const skill = readToolforgeInventory(manifestPath, toolforgeRoot).skills.find(skill => skill.id === target || skill.name === target);
    return skill?.runnable ? skill.runner : null;
  } catch {
    return null;
  }
}

function formatLocalDay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftLocalDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number);
  return formatLocalDay(new Date(y, m - 1, d + delta));
}

function isoWeekKey(date) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) return null;
  const thursday = new Date(value);
  thursday.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  return `${thursday.getUTCFullYear()}-W${String(Math.ceil((((thursday - yearStart) / 86400000) + 1) / 7)).padStart(2, '0')}`;
}

function createReportingHistory(options = {}) {
  const reportDirectory = options.reportDirectory || resolve(options.reportPath || RETRO_PATH, '..');
  const databasePath = options.reportingDatabasePath || process.env.ICF_REPORTING_DATABASE_PATH || resolve(reportDirectory, 'snapshots.sqlite');
  const store = options.snapshotStore || createSnapshotStore({ databasePath });
  const sourceSystem = options.reportingSourceSystem || REPORTING_HISTORY_SOURCE_SYSTEM;
  const sourceId = options.reportingSourceId || REPORTING_HISTORY_SOURCE_ID;
  const historyAdapter = options.historyAdapter || createHistoryAdapter({ store, sourceSystem, sourceId });
  const candidates = (existsSync(reportDirectory) ? readdirSync(reportDirectory, { withFileTypes: true }) : [])
    .filter(entry => entry.isFile() && /^retro-.*\.json$/i.test(entry.name))
    .map(entry => resolve(reportDirectory, entry.name))
    .sort();
  const weeks = new Set();
  for (const artifactPath of candidates) {
    try {
      const report = JSON.parse(readFileSync(artifactPath, 'utf8'));
      const validation = validateWeeklyRetroReport(report);
      const weekKey = validation.ok ? isoWeekKey(report.date) : null;
      if (!weekKey) continue;
      weeks.add(weekKey);
      for (const category of CATEGORY_REGISTRY.categories) {
        store.upsertSnapshot({ sourceSystem, sourceId, weekKey, categoryId: category.id }, { schemaVersion: '1.0', report });
      }
    } catch {
      // Invalid history stays unavailable; current latest endpoint owns its error semantics.
    }
  }
  for (const toWeek of weeks) {
    for (const category of CATEGORY_REGISTRY.categories) {
      for (const window of SUPPORTED_TREND_WINDOWS) {
        const weeksInWindow = weekRange(toWeek, window);
        historyAdapter.rebuildSummaries({ fromWeek: weeksInWindow[0], toWeek, categoryId: category.id });
      }
    }
  }
  return { store, historyAdapter };
}

const retroTransport = new LocalFileAdapterTransport({
  filePath: RETRO_PATH,
  parse: (raw) => JSON.parse(raw)
});

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=UTF-8',
  '.md': 'text/markdown; charset=UTF-8'
};

function readToolforgeBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('error', error);
      req.removeListener('aborted', aborted);
    };
    const fail = code => { cleanup(); reject(Object.assign(new Error('body'), { code })); };
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > 65536) { fail('PAYLOAD_TOO_LARGE'); req.resume(); return; }
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const error = () => fail('HTTP_STREAM_FAILED');
    const aborted = () => fail('CANCELLED');
    req.on('data', data);
    req.on('end', end);
    req.on('error', error);
    req.on('aborted', aborted);
  });
}

export function commitTypeForCard(card = {}) {
  const category = String(card.category || '').toUpperCase();
  if (card.action_type === 'deterministic_fix') return 'fix';
  if (category === 'RESEARCH' || category === 'EVALUATE') return 'chore';
  return 'feat';
}

export function buildCardDetailSections(card = {}) {
  const fence = '`'.repeat(3);
  let out = '';
  if (card.context && Object.keys(card.context).length) {
    out += '\n### Context\n' + fence + 'json\n' + JSON.stringify(card.context, null, 2) + '\n' + fence + '\n';
    if (card.context.note && /fetch failed/i.test(card.context.note)) {
      out += '\n> Warning: the source document body was not fetched, so this card holds only filename-derived metadata. Open the original card before acting.\n';
    }
  }
  if (Array.isArray(card.execution_plan) && card.execution_plan.length) {
    out += '\n### Execution plan\n' + card.execution_plan.map(st => (st.step || 1) + '. ' + (st.action || '') + (st.command ? ' - `' + st.command + '`' : '')).join('\n') + '\n';
  }
  if (card.deliverables) {
    out += '\n### Deliverables & acceptance criteria\n' + (typeof card.deliverables === 'string' ? card.deliverables : JSON.stringify(card.deliverables, null, 2)) + '\n';
  }
  if (card.direction) {
    out += '\n### Direction\n' + (typeof card.direction === 'string' ? card.direction : JSON.stringify(card.direction, null, 2)) + '\n';
  }
  return out;
}

export function loadArchivedCard(cardId, lockRow = null, inboxDir = null) {
  const candidatePaths = [];
  if (lockRow?.archived_path) candidatePaths.push(lockRow.archived_path);

  const baseInbox = inboxDir || trmInboxDir();
  const harnessPending = resolve(ROOT, '../.harness/tasks/pending');
  const harnessArchive = resolve(ROOT, '../.harness/tasks/archive');
  const inboxCompleted = resolve(baseInbox, 'completed');
  const gdriveArchive = resolve('G:/My Drive/TRM-Research/04_archive/mobile-inbox');

  candidatePaths.push(
    resolve(harnessPending, `${cardId}.json`),
    resolve(harnessArchive, `${cardId}.json`),
    resolve(harnessPending, `${cardId}.md`),
    resolve(harnessArchive, `${cardId}.md`),
    resolve(inboxCompleted, `${cardId}.json`),
    resolve(inboxCompleted, `${cardId}.md`)
  );

  for (const dir of [harnessPending, harnessArchive, inboxCompleted, gdriveArchive]) {
    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir);
        for (const f of files) {
          if (f.includes(cardId)) {
            candidatePaths.push(resolve(dir, f));
          }
        }
      } catch {}
    }
  }

  for (const p of candidatePaths) {
    if (p && existsSync(p)) {
      try {
        const stat = statSync(p);
        if (!stat.isFile()) continue;
        const content = readFileSync(p, 'utf8');
        if (p.endsWith('.json') || content.trim().startsWith('{')) {
          return JSON.parse(content);
        } else if (p.endsWith('.md') || content.includes('---')) {
          const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (match) {
            const frontmatter = {};
            for (const line of match[1].split(/\r?\n/)) {
              const idx = line.indexOf(':');
              if (idx > 0) frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
            frontmatter.body = content.slice(match[0].length).trim();
            return frontmatter;
          }
        }
      } catch {}
    }
  }
  return null;
}

export function createGatewayServer(options = {}) {
  const toolforgeRoot = resolve(options.toolforgeRoot || TOOLFORGE_ROOT);
  const toolforgeManifestPath = options.toolforgeManifestPath || join(toolforgeRoot, 'manifest.json');
  const toolforgeInvocation = createToolforgeInvocationConsumer({ toolforgeRoot, manifestPath: toolforgeManifestPath,
    nodeExecutable: options.toolforgeNodeExecutable ?? process.execPath,
    workspaceRoots: options.toolforgeWorkspaceRoots ?? [ROOT] }, options.toolforgeInvocationTestApi);
  const toolforgeDashboardOrigin = options.toolforgeDashboardOrigin ?? `http://127.0.0.1:${PORT}`;
  const reportingHistory = options.historyAdapter
    ? { store: options.snapshotStore || null, historyAdapter: options.historyAdapter }
    : createReportingHistory(options);
  const reportingServer = createReportingServer({ ...options, ...reportingHistory });
  const mobileSnapshot = options.mobileSnapshot || (process.env.ICF_SNAPSHOT_SIGNING_KEY && process.env.ICF_MOBILE_AUTH_TOKEN ? createMobileSnapshotService({ reportPath: options.reportPath || RETRO_PATH }) : null);

  const sseClients = new Set();
  function broadcastSseEvent(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.res.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  const commitCache = new Map();
  let gitAuthor = options.gitAuthor || null;
  async function countCommits(since, until) {
    const key = `${since}|${until}`;
    const cached = commitCache.get(key);
    if (cached && Date.now() - cached.at < COMMIT_CACHE_TTL_MS) return cached.value;

    const { discoverRepos, collectCommitsByDay } = await importTelemetry('git-activity.mjs');
    const repos = options.commitRepos || discoverRepos(resolve(ROOT, '..'));
    if (!gitAuthor) {
      const { execFileSync } = await import('node:child_process');
      gitAuthor = execFileSync('git', ['-C', resolve(ROOT, '..'), 'config', 'user.name'], { encoding: 'utf8' }).trim();
    }
    const value = await collectCommitsByDay(repos, { since, until, author: gitAuthor });
    commitCache.set(key, { at: Date.now(), value });
    return value;
  }

  const statusFeedDir = resolve(ROOT, '../_status-feed');
  let feedWatcher = null;
  let debounceTimeout = null;

  if (existsSync(statusFeedDir) && !options.disableWatcher) {
    try {
      feedWatcher = watch(statusFeedDir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.json')) return;
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
          try {
            const fullPath = join(statusFeedDir, filename);
            if (existsSync(fullPath)) {
              let parsedData = null;
              try { parsedData = JSON.parse(readFileSync(fullPath, 'utf8')); } catch {}
              broadcastSseEvent('telemetry', {
                feed: filename,
                timestamp: new Date().toISOString(),
                data: parsedData
              });
            }
          } catch {}
        }, 150);
        if (debounceTimeout && debounceTimeout.unref) debounceTimeout.unref();
      });
      if (feedWatcher && feedWatcher.unref) feedWatcher.unref();
    } catch {}
  }

  const heartbeatInterval = setInterval(() => {
    if (sseClients.size > 0) {
      broadcastSseEvent('heartbeat', {
        timestamp: new Date().toISOString(),
        host: os.hostname(),
        uptime: process.uptime(),
        subscribers: sseClients.size,
        status: 'HEALTHY'
      });
    }
  }, options.heartbeatIntervalMs || 15000);
  if (heartbeatInterval.unref) heartbeatInterval.unref();

  const server = createServer(async (req, res) => {
    let pilotRequest = false;
    try { pilotRequest = new URL(req.url, 'http://127.0.0.1').pathname === '/api/toolforge/invoke'; } catch {}
    // Check raw requested URL for directory traversal patterns
    if (req.url && (req.url.includes('/..') || req.url.includes('\\..') || req.url.includes('%2e%2e') || req.url.includes('%2E%2E'))) {
      if (pilotRequest) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(toolforgeHttpFailure(null, 'FORBIDDEN')));
      } else {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden: Invalid file path');
      }
      return;
    }

    const reqUrl = new URL(req.url, pilotRequest ? 'http://127.0.0.1' : `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = reqUrl.pathname;

    if (pathname === '/api/toolforge/invoke') {
      const controller = new AbortController();
      const disconnected = () => { if (!res.writableEnded) controller.abort(); };
      const incomplete = () => { if (!req.complete) controller.abort(); };
      res.on('close', disconnected);
      req.on('close', incomplete);
      const send = value => {
        if (res.destroyed || controller.signal.aborted) return;
        const code = value.error?.code;
        const status = value.state === 'completed' ? 200 : code === 'FORBIDDEN' ? 403 : code === 'METHOD_NOT_ALLOWED' ? 405 :
          code === 'PAYLOAD_TOO_LARGE' ? 413 : code === 'BUSY' ? 429 : value.state === 'unavailable' ? 503 :
          value.state === 'timed_out' ? 504 : value.state === 'rejected' ? 400 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store',
          ...(status === 405 ? { Allow: 'POST' } : {}) });
        res.end(JSON.stringify(value));
      };
      try {
        if (!isLoopback(req.socket.remoteAddress) || req.headers.origin !== toolforgeDashboardOrigin) {
          send(toolforgeHttpFailure(null, 'FORBIDDEN')); return;
        }
        if (req.method !== 'POST') { send(toolforgeHttpFailure(null, 'METHOD_NOT_ALLOWED')); return; }
        if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(req.headers['content-type'] || '') ||
            (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
          send(toolforgeHttpFailure(null, 'UNSUPPORTED_CONTENT_TYPE')); return;
        }
        let body;
        try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readToolforgeBody(req))); }
        catch (cause) {
          send(toolforgeHttpFailure(null, cause.code === 'PAYLOAD_TOO_LARGE' ? cause.code : cause.code === 'HTTP_STREAM_FAILED' ? 'WORKER_FAILED' : 'INVALID_JSON', cause.code === 'HTTP_STREAM_FAILED' ? 'failed' : 'rejected'));
          return;
        }
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 2 ||
            !Object.hasOwn(body, 'skillId') || !Object.hasOwn(body, 'input')) {
          send(toolforgeHttpFailure(null, 'INVALID_INPUT')); return;
        }
        if (!TOOLFORGE_PILOTS.includes(body.skillId)) { send(toolforgeHttpFailure(null, 'INVALID_TARGET')); return; }
        if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) {
          send(toolforgeHttpFailure(body.skillId, 'INVALID_INPUT')); return;
        }
        send(await toolforgeInvocation.invokeSkill(body.skillId, body.input, { signal: controller.signal }));
      } catch {
        send(toolforgeHttpFailure(null, 'WORKER_FAILED', 'failed'));
      } finally {
        res.removeListener('close', disconnected);
        req.removeListener('close', incomplete);
        req.resume();
      }
      return;
    }

    if (pathname === '/api/toolforge/skills') {
      res.setHeader('Content-Type', 'application/json; charset=UTF-8');
      res.setHeader('Cache-Control', 'no-store');
      try {
        const metadata = Object.fromEntries(await Promise.all(TOOLFORGE_PILOTS.map(async id => [id, await toolforgeInvocation.inspectInvocation(id)])));
        const inventory = readToolforgeInventory(toolforgeManifestPath, toolforgeRoot, metadata);
        res.writeHead(200);
        res.end(JSON.stringify(inventory));
      } catch {
        res.writeHead(503);
        res.end(JSON.stringify({ skills: [], error: 'Toolforge inventory unavailable' }));
      }
      return;
    }

    // Real-Time SSE Event Stream endpoint
    if (pathname === '/api/events' || pathname === '/api/stream' || pathname === '/api/reporting/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ status: 'CONNECTED', timestamp: new Date().toISOString(), host: os.hostname(), uptime: process.uptime() })}\n\n`);

      const client = { id: Date.now(), res, req };
      sseClients.add(client);

      req.on('close', () => {
        sseClients.delete(client);
      });
      return;
    }

    if (pathname === '/api/mobile/snapshot' || pathname === '/api/mobile/health') {
      if (!mobileSnapshot) { res.writeHead(503, { 'Content-Type': 'application/json; charset=UTF-8' }); res.end(JSON.stringify({ status: 'UNAVAILABLE', error: 'Mobile snapshot service is not configured' })); return; }
      if (req.method !== 'GET' || req.headers.authorization !== `Bearer ${mobileSnapshot.authToken}`) { res.writeHead(401, { 'Content-Type': 'application/json; charset=UTF-8' }); res.end(JSON.stringify({ status: 'UNAUTHORIZED' })); return; }
      const snapshot = await mobileSnapshot.getSnapshot();
      if (!snapshot || !mobileSnapshot.verify(snapshot)) { res.writeHead(503, { 'Content-Type': 'application/json; charset=UTF-8' }); res.end(JSON.stringify({ status: 'UNAVAILABLE', freshness: 'unavailable', error: 'No valid snapshot available' })); return; }
      const payload = pathname === '/api/mobile/health' ? { status: 'SUCCESS', freshness: snapshot.freshness, age_ms: snapshot.age_ms, created_at: snapshot.manifest.created_at, last_failure: snapshot.last_failure } : { status: 'SUCCESS', freshness: snapshot.freshness, partial: false, manifest: snapshot.manifest, signature: snapshot.signature, data: snapshot.data };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); return;
    }

    // Action Execution & Cache Clearing Endpoints (Loopback Only)
    if (pathname === '/api/actions/clear-cache') {
      if (!isLoopback(req.socket.remoteAddress)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: loopback only' }));
        return;
      }
      prCache = { timestamp: 0, prs: [] };
      broadcastSseEvent('cache_cleared', { timestamp: new Date().toISOString() });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
      res.end(JSON.stringify({ ok: true, cleared: ['prCache', 'telemetry'] }));
      return;
    }

    if (pathname === '/api/actions/run') {
      if (!isLoopback(req.socket.remoteAddress)) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ ok: false, error: 'Forbidden: loopback only' }));
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
        return;
      }

      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 65536) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=UTF-8' });
          res.end(JSON.stringify({ ok: false, error: 'Payload too large' }));
          return;
        }
      }

      let payload = {};
      try {
        payload = JSON.parse(body || '{}');
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        return;
      }

      const { action, target } = payload;
      const ACTION_WHITELIST = {
        'run-bot': {
          'kb-sentinel': ['node', [resolve(ROOT, '../scripts/kb-sentinel-bot.mjs')]],
          'notebook-ingester': ['node', [resolve(ROOT, '../scripts/notebook-ingester-bot.mjs')]],
          'trm-bot': ['node', [resolve(ROOT, '../scripts/trm-bot-runner.mjs')]],
          'watchlist-miner': ['node', [resolve(ROOT, '../scripts/watchlist-miner-bot.mjs')]],
          'daemon-healer': ['node', [resolve(ROOT, '../scripts/daemon-healer-bot.mjs')]],
          'ironledger-sentinel': ['node', [resolve(ROOT, '../scripts/ironledger-sentinel-bot.mjs')]],
          'ci-watchdog': ['node', [resolve(ROOT, '../scripts/ci-watchdog-bot.mjs')]],
          'ironbots-reporter': ['node', [resolve(ROOT, '../scripts/ironbots-daily-reporter.mjs')]],
          'storage-pruner': ['node', [resolve(ROOT, '../scripts/storage-pruner-bot.mjs')]],
          'trm-drive-sync': ['powershell.exe', ['-NoProfile', '-File', resolve(ROOT, '../scripts/schedule-task-wrapper-TRM-Drive-Sync.ps1')]]
        },
        'run-task': (taskName) => {
          const safeTasks = new Set([
            'CI-Watchdog', 'Daemon-Healer', 'Ironbots-Reporter', 'IronLedger-Sentinel',
            'KB-Sentinel', 'Notebook-Ingester', 'Storage-Pruner', 'TRM-Bot',
            'TRM-Drive-Sync', 'Watchlist-Miner', 'CIC-Daily-Status', 'CIC-Mirror-ClaudeMemory',
            'TRM-Notebooklm-Mine', 'KB-Sync-TRM-Triage'
          ]);
          if (!safeTasks.has(taskName)) return null;
          return ['powershell.exe', ['-NoProfile', '-Command', `Start-ScheduledTask -TaskName '${taskName}'`]];
        },
        'run-skill': (skillName) => {
          return buildToolforgeSkillRunner(skillName, toolforgeManifestPath, toolforgeRoot);
        },
        'validate-wiki': () => ['node', [resolve(ROOT, '../modules/wiki/validate-staging-docs.mjs')]],
        'autoheal-wiki': (subtype) => {
          if (subtype === 'frontmatter') {
            return ['node', [resolve(ROOT, '../scripts/fix-wiki-frontmatter.mjs'), 'wiki', '--allow-dirty']];
          }
          if (subtype === 'hygiene') {
            return ['node', [resolve(ROOT, '../modules/wiki/validate-staging-docs.mjs'), '--fix', 'wiki']];
          }
          return ['node', [resolve(ROOT, '../modules/wiki/autoheal-sweeper.mjs'), '--fix', '--allow-dirty', '--target-dir', 'wiki']];
        }
      };

      let runner = null;
      if (action === 'run-bot') {
        runner = ACTION_WHITELIST['run-bot'] && ACTION_WHITELIST['run-bot'][target];
      } else if (action === 'run-task') {
        runner = ACTION_WHITELIST['run-task'](target);
      } else if (action === 'run-skill') {
        runner = ACTION_WHITELIST['run-skill'](target);
      } else if (action === 'validate-wiki') {
        runner = ACTION_WHITELIST['validate-wiki']();
      } else if (action === 'autoheal-wiki') {
        runner = ACTION_WHITELIST['autoheal-wiki'](target);
      }

      if (!runner) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ ok: false, error: `Invalid action or target: ${action}/${target}` }));
        return;
      }

      const [cmd, cmdArgs] = runner;
      try {
        const proc = spawn(cmd, cmdArgs, {
          cwd: action === 'run-skill' ? toolforgeRoot : resolve(ROOT, '..'),
          detached: true,
          stdio: 'ignore'
        });
        proc.on('error', (procErr) => {
          console.error(`[ICF-ACTION-ENGINE] Async execution error for ${action}/${target}:`, procErr.message);
          broadcastSseEvent('action_error', { action, target, error: procErr.message, timestamp: new Date().toISOString() });
        });
        proc.unref();

        broadcastSseEvent('action_dispatched', { action, target, pid: proc.pid, timestamp: new Date().toISOString() });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ ok: true, action, target, pid: proc.pid, status: 'DISPATCHED' }));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
        return;
      }
    }

    // 1. API Projections & Reporting Routes
    if (pathname.startsWith('/api/reporting/')) {
      if (pathname === '/api/reporting/ironbots' || pathname === '/api/reporting/ironbots/daily') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const reporterScript = resolve(ROOT, '../scripts/ironbots-daily-reporter.mjs');
          if (existsSync(reporterScript)) {
            const { aggregateFleetActivity } = await import(`file://${reporterScript.replace(/\\/g, '/')}`);
            const data = await aggregateFleetActivity({ isDryRun: true });
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'SUCCESS', data }));
            return;
          }
          const reportPath = resolve(ROOT, '../_status-feed/ironbots_daily_report.json');
          if (existsSync(reportPath)) {
            const data = JSON.parse(readFileSync(reportPath, 'utf8'));
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'SUCCESS', data }));
            return;
          }
          res.writeHead(404);
          res.end(JSON.stringify({ status: 'NOT_FOUND', message: 'Ironbots telemetry unavailable' }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/meridian' || pathname.startsWith('/api/reporting/meridian/')) {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Cache-Control', 'no-store');
        if (!isLoopback(req.socket.remoteAddress)) {
          res.writeHead(403);
          res.end(JSON.stringify({ status: 'FORBIDDEN', error: 'Meridian reports are local-only' }));
          return;
        }
        try {
          const meridian = await importTelemetry('meridian-telemetry.mjs');
          const dbPath = options.meridianDbPath || meridian.DEFAULT_MERIDIAN_DB;
          let data;
          if (pathname === '/api/reporting/meridian') {
            data = meridian.collectMeridianTelemetry(dbPath);
          } else if (pathname === '/api/reporting/meridian/day' || pathname === '/api/reporting/meridian/week') {
            const isDay = pathname.endsWith('/day');
            const day = reqUrl.searchParams.get(isDay ? 'date' : 'end') || formatLocalDay(new Date());
            if (!DAY_PARAM.test(day)) {
              res.writeHead(400);
              res.end(JSON.stringify({ status: 'BAD_REQUEST', error: 'Expected YYYY-MM-DD' }));
              return;
            }
            const commits = await countCommits(isDay ? day : shiftLocalDay(day, -6), day);
            data = isDay
              ? { meridian: meridian.collectMeridianDay(dbPath, day), commits: commits.days[day] || { count: 0, repos: {} } }
              : { meridian: meridian.collectMeridianWeek(dbPath, day), commits };
          } else {
            res.writeHead(404);
            res.end(JSON.stringify({ status: 'NOT_FOUND' }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'SUCCESS', data }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/trm/ingress' || pathname === '/api/reporting/trm-ingress') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const feedPath = resolve(ROOT, '../_status-feed/trm_ingress_status.json');
          if (existsSync(feedPath)) {
            const data = JSON.parse(readFileSync(feedPath, 'utf8'));
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'SUCCESS', data }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'SUCCESS',
            data: {
              status: 'HEALTHY',
              triageQueue: 0,
              completed: 0,
              quarantined: 0,
              harnessPending: 0,
              totalTracked: 0,
              recentCards: []
            }
          }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/trm/history' || pathname === '/api/reporting/trm-history') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const date = reqUrl.searchParams.get('date');
          const dirs = [
            resolve(ROOT, '../_status-feed/trm_history'),
            resolve(DASHBOARD_DIR, 'trm_history')
          ];
          if (!date) {
            const dateSet = new Set();
            for (const d of dirs) {
              if (existsSync(d)) {
                for (const f of readdirSync(d)) {
                  const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json(\.gz)?$/);
                  if (m) dateSet.add(m[1]);
                }
              }
            }
            const dates = Array.from(dateSet).sort().reverse();
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'SUCCESS', dates }));
            return;
          }
          if (!DAY_PARAM.test(date)) {
            res.writeHead(400);
            res.end(JSON.stringify({ status: 'BAD_REQUEST', error: 'Expected YYYY-MM-DD' }));
            return;
          }
          for (const d of dirs) {
            const jsonPath = join(d, `${date}.json`);
            if (existsSync(jsonPath)) {
              const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
              res.writeHead(200);
              res.end(JSON.stringify(data));
              return;
            }
            const gzPath = join(d, `${date}.json.gz`);
            if (existsSync(gzPath)) {
              const buf = readFileSync(gzPath);
              const unzipped = zlib.gunzipSync(buf).toString('utf8');
              const data = JSON.parse(unzipped);
              res.writeHead(200);
              res.end(JSON.stringify(data));
              return;
            }
          }
          res.writeHead(404);
          res.end(JSON.stringify({ status: 'NOT_FOUND', error: `Snapshot not found: ${date}` }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/storage-pruner' || pathname === '/api/reporting/storage') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const prunerFeed = resolve(ROOT, '../_status-feed/storage_pruner_status.json');
          if (existsSync(prunerFeed)) {
            const data = JSON.parse(readFileSync(prunerFeed, 'utf8'));
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'SUCCESS', data }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'SUCCESS',
            data: {
              status: 'HEALTHY',
              totalFreedFormatted: '0 B',
              totalFreedBytes: 0,
              databasesScanned: 0,
              databaseResults: [],
              telemetryCompactedCount: 0,
              telemetryResults: [],
              harnessTasksPrunedCount: 0,
              harnessResults: []
            }
          }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/cost-routing' || pathname === '/api/reporting/cost-routing-gateway') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const feedPath = resolve(ROOT, '../_status-feed/cost_routing_status.json');
          const dashboardFeed = resolve(DASHBOARD_DIR, 'cost_routing_status.json');
          let data = null;
          if (existsSync(feedPath)) {
            data = JSON.parse(readFileSync(feedPath, 'utf8'));
          } else if (existsSync(dashboardFeed)) {
            data = JSON.parse(readFileSync(dashboardFeed, 'utf8'));
          }
          if (data) {
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'SUCCESS', ...data }));
            return;
          }
          res.writeHead(200);
          res.end(JSON.stringify({
            status: 'STANDBY',
            metrics: { totalRequests: 0, totalSavedVsFrontierUsd: 0, totalSpentUsd: 0, qualityEscalations: 0, averageLatencyMs: 0 }
          }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/mobile-outbox' || pathname === '/api/reporting/outbox') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const outboxDirs = [
            resolve(ROOT, '../trm-drive/inbox/outbox'),
            resolve(ROOT, '../.trm/inbox/outbox'),
            'G:/My Drive/TRM-Research/mobile-outbox'
          ];
          const rawReceipts = [];
          for (const dir of outboxDirs) {
            if (existsSync(dir)) {
              try {
                const files = readdirSync(dir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                  try {
                    const content = JSON.parse(readFileSync(join(dir, file), 'utf8'));
                    rawReceipts.push({
                      file,
                      ...content
                    });
                  } catch {}
                }
              } catch {}
            }
          }

          // Deduplicate by normalized action_id or intent
          const receiptMap = new Map();
          for (const r of rawReceipts) {
            const raw = r.action_id || r.intent || r.receipt_id || r.file || '';
            const key = raw.replace(/-completed$/, '').replace(/^rcpt-\d+-done-/, '').replace(/^rcpt-\d+-/, '').replace(/^receipt-\d+-/, '').replace(/_/g, '-').toLowerCase().trim();
            if (!key) continue;
            const existing = receiptMap.get(key);
            if (!existing) {
              receiptMap.set(key, r);
            } else {
              const isCompleted = r.status === 'COMPLETED' || existing.status === 'COMPLETED';
              receiptMap.set(key, {
                ...existing,
                ...r,
                issue_url: existing.issue_url || r.issue_url,
                pr_url: existing.pr_url || r.pr_url,
                research_ref: existing.research_ref || r.research_ref,
                status: isCompleted ? 'COMPLETED' : (r.status || existing.status),
                summary: (r.status === 'COMPLETED' && r.summary) ? r.summary : (existing.summary || r.summary)
              });
            }
          }

          const receipts = Array.from(receiptMap.values());
          const prs = getPullRequests();
          for (const r of receipts) {
            if (!r.pr_url) {
              const matchedPr = prs.find(p => {
                if (r.issue_url) {
                  const issueNum = r.issue_url.split('/').pop();
                  if (issueNum && (p.title.includes(`#${issueNum}`) || p.title.includes(`fixes #${issueNum}`) || p.title.includes(`closes #${issueNum}`))) {
                    return true;
                  }
                }
                if (r.action_id) {
                  const slug = r.action_id.replace(/^act-\d*-?/, '').replace(/[-_]/g, ' ').toLowerCase();
                  if (slug.length > 5 && p.title.toLowerCase().includes(slug)) return true;
                }
                if (r.intent) {
                  const intentSlug = r.intent.replace(/_/g, ' ').toLowerCase();
                  if (intentSlug.length > 5 && p.title.toLowerCase().includes(intentSlug)) return true;
                }
                return false;
              });
              if (matchedPr) {
                r.pr_url = matchedPr.url;
                r.pr_number = matchedPr.number;
                r.pr_title = matchedPr.title;
                r.pr_state = matchedPr.state;
              }
            }
          }
          receipts.sort((a, b) => {
            const aPending = a.status !== 'COMPLETED';
            const bPending = b.status !== 'COMPLETED';
            if (aPending && !bPending) return -1;
            if (!aPending && bPending) return 1;
            const timeA = new Date(a.timestamp || a.completed_at || a.dispatched_at || 0).getTime();
            const timeB = new Date(b.timestamp || b.completed_at || b.dispatched_at || 0).getTime();
            return timeB - timeA;
          });
          const sliced = receipts.slice(0, 40);
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'SUCCESS', total: receipts.length, count: sliced.length, receipts: sliced }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/pull-requests' || pathname === '/api/reporting/prs') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const prs = getPullRequests();
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'SUCCESS', count: prs.length, prs }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/trm-backlog') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const ledgerPath = resolve(ROOT, '../trm-drive/inbox/ledger.jsonl');
          const pendingDir = resolve(ROOT, '../.harness/tasks/pending');
          const archiveDir = resolve(ROOT, '../.harness/tasks/archive');
          const outboxDir = resolve(ROOT, '../trm-drive/inbox/outbox');
          const completedOutboxDir = resolve(ROOT, '../trm-drive/inbox/completed/outbox');

          // Collect latest receipt metadata for live card reconciliation
          const receipts = new Map();
          for (const dir of [completedOutboxDir, outboxDir]) {
            if (existsSync(dir)) {
              for (const f of readdirSync(dir)) {
                if (f.endsWith('.json')) {
                  try {
                    const data = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
                    const id = data.action_id || data.id;
                    if (id && !receipts.has(id)) receipts.set(id, data);
                  } catch {}
                }
              }
            }
          }

          const cardsMap = new Map();

          // 1. Ingest historical and active items from ledger.jsonl
          if (existsSync(ledgerPath)) {
            const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean);
            for (const l of lines) {
              try {
                const item = JSON.parse(l);
                if (item.id) cardsMap.set(item.id, item);
              } catch {}
            }
          }

          // 2. Discover live cards from .harness/tasks/pending and archive
          for (const [dir, defaultStatus] of [[pendingDir, 'STAGED'], [archiveDir, 'ARCHIVED']]) {
            if (existsSync(dir)) {
              for (const f of readdirSync(dir)) {
                try {
                  const fullPath = resolve(dir, f);
                  const content = readFileSync(fullPath, 'utf8');
                  let data = {};
                  try { data = JSON.parse(content); } catch {}
                  const id = data.id || f.replace(/\.(md|gdoc|json)$/, '');
                  const rcpt = receipts.get(id);

                  if (!cardsMap.has(id)) {
                    cardsMap.set(id, {
                      id,
                      target: data.target || data.domain || rcpt?.target_notebook || 'toolforge',
                      intent: data.intent || data.title || rcpt?.intent || id,
                      summary: data.summary || rcpt?.summary || data.intent || '',
                      status: rcpt?.status || data.status || defaultStatus,
                      priority: data.priority || 'P2',
                      issue_url: rcpt?.issue_url || data.issue_url || null,
                      research_ref: rcpt?.research_ref || data.research_ref || null,
                      action_type: data.action_type,
                      category: data.category,
                      context: data.context,
                      execution_plan: data.execution_plan,
                      deliverables: data.deliverables
                    });
                  } else {
                    const existing = cardsMap.get(id);
                    // Ledger rows are flat; fill in the structured card sections from the archived card.
                    for (const key of ['context', 'execution_plan', 'deliverables', 'direction', 'archived_path']) {
                      if (existing[key] === undefined && data[key] !== undefined) existing[key] = data[key];
                    }
                    if (rcpt?.status && existing.status !== 'COMPLETED' && existing.status !== 'DONE') {
                      existing.status = rcpt.status;
                    }
                    if (rcpt?.issue_url && !existing.issue_url) {
                      existing.issue_url = rcpt.issue_url;
                    }
                  }
                } catch {}
              }
            }
          }

          const cards = Array.from(cardsMap.values());
          const prs = getPullRequests();
          for (const card of cards) {
            if (!card.pr_url) {
              const matchedPr = prs.find(p => {
                if (card.issue_url) {
                  const issueNum = card.issue_url.split('/').pop();
                  if (issueNum && (p.title.includes(`#${issueNum}`) || p.title.toLowerCase().includes(`closes #${issueNum}`) || p.title.toLowerCase().includes(`fixes #${issueNum}`))) {
                    return true;
                  }
                }
                if (card.id) {
                  const slug = card.id.replace(/^act-\d*-?/, '').replace(/[-_]/g, ' ').toLowerCase();
                  if (slug.length > 5 && p.title.toLowerCase().includes(slug)) return true;
                }
                if (card.intent) {
                  const intentSlug = card.intent.replace(/_/g, ' ').toLowerCase();
                  if (intentSlug.length > 5 && p.title.toLowerCase().includes(intentSlug)) return true;
                }
                return false;
              });
              if (matchedPr) {
                card.pr_url = matchedPr.url;
                card.pr_number = matchedPr.number;
                card.pr_title = matchedPr.title;
                card.pr_state = matchedPr.state;
              }
            }
          }

          cards.reverse();
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'SUCCESS', count: cards.length, cards }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/trm-backlog/triage-card') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const body = await parseJsonBody(req);
          const ledgerPath = resolve(trmInboxDir(), 'ledger.jsonl');
          let updatedCard = null;
          if (existsSync(ledgerPath)) {
            const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean);
            const updatedLines = [];
            for (const l of lines) {
              try {
                const item = JSON.parse(l);
                if (item.id === body.cardId) {
                  if (body.priority) item.priority = body.priority;
                  if (body.status) item.status = body.status;
                  updatedCard = item;
                }
                updatedLines.push(JSON.stringify(item));
              } catch {
                updatedLines.push(l);
              }
            }
            writeFileSync(ledgerPath, updatedLines.join('\n') + '\n', 'utf8');
            try {
              const { refreshLedgerMarkdown } = await import(resolve(ROOT, '../scripts/trm-ingress-watcher.mjs'));
              refreshLedgerMarkdown();
            } catch {}
          }
          if (!updatedCard) {
            updatedCard = { id: body.cardId, priority: body.priority, status: body.status };
          }
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'SUCCESS', card: updatedCard }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/trm-backlog/promote') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        try {
          const body = await parseJsonBody(req);
          const cardId = body.cardId;
          const repo = body.repo || 'sorensencc-dotcom/toolforge';

          // Re-promotion lock: refuse completed or already-promoted cards, and reconcile rows whose receipt says completed.
          const promoteInboxDir = trmInboxDir();
          const lockLedgerPath = resolve(promoteInboxDir, 'ledger.jsonl');
          const lockRow = existsSync(lockLedgerPath)
            ? readFileSync(lockLedgerPath, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).find(r => r && r.id === cardId)
            : null;

          const archivedCard = loadArchivedCard(cardId, lockRow, promoteInboxDir);
          const cardData = {
            ...(lockRow || {}),
            ...(archivedCard || {})
          };

          const commitType = commitTypeForCard(cardData);
          const target = cardData.target || cardData.domain || 'core';
          const intent = cardData.intent || cardData.title || cardId;
          const title = body.title || `${commitType}(${target}): ${intent}`;

          let bodyText = body.body;
          if (!bodyText || bodyText === `Promoted from action card ${cardId}`) {
            bodyText = `### Overview\n${cardData.summary || cardData.intent || ''}\n\n### Card Context\n- Card ID: \`${cardId}\`\n- Target: \`${target}\`\n- Priority: \`${cardData.priority || 'P2'}\`\n\n### PR & Issue Traceability\n- When opening a Pull Request for this issue, include \`Closes #<issue_number>\` in the PR description.\n- Use conventional commit title: \`${commitType}(${target}): ${intent} (closes #<issue_number>)\`\n\n### Requirements\n- [ ] Review implementation requirements\n- [ ] Implement and verify via TDD\n` + buildCardDetailSections(cardData);
          }
          const labelList = Array.isArray(body.labels) ? body.labels.filter(Boolean) : (body.labels ? String(body.labels).split(',').map(s => s.trim()).filter(Boolean) : ['enhancement']);

          if (lockRow) {
            const receiptName = `receipt-${lockRow.id}-completed.json`;
            const hasReceipt = ['completed/outbox', 'outbox']
              .some(d => existsSync(resolve(promoteInboxDir, d, receiptName)));
            const rowCompleted = lockRow.status === 'COMPLETED' || Boolean(lockRow.completed_at);
            let reason = null;
            if (rowCompleted) reason = 'card already completed';
            else if (lockRow.issue_url) reason = `card already promoted: ${lockRow.issue_url}`;
            else if (hasReceipt) reason = 'completion receipt exists';
            if (reason) {
              if (hasReceipt && lockRow.status !== 'COMPLETED') {
                const reconciled = readFileSync(lockLedgerPath, 'utf8').split('\n').filter(Boolean).map(l => {
                  try {
                    const item = JSON.parse(l);
                    if (item.id === lockRow.id) item.status = 'COMPLETED';
                    return JSON.stringify(item);
                  } catch { return l; }
                });
                writeFileSync(lockLedgerPath, reconciled.join('\n') + '\n', 'utf8');
              }
              res.writeHead(409);
              res.end(JSON.stringify({ status: 'CONFLICT', error: `Promote refused: ${reason}`, card_id: lockRow.id }));
              return;
            }
          }

          const isDryRun = Boolean(body.dryRun || options.dryRun || process.env.NODE_ENV === 'test' || process.env.VITEST || process.env.TAP);
          let issueUrl = null;

          if (isDryRun) {
            issueUrl = `https://github.com/${repo}/issues/mock-${Date.now()}`;
          } else {
            const tmpFile = resolve(os.tmpdir(), `trm-promote-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
            writeFileSync(tmpFile, bodyText, 'utf8');
            try {
              // First attempt: with requested labels
              if (labelList.length > 0) {
                try {
                  const args = ['issue', 'create', '--repo', repo, '--title', title, '--body-file', tmpFile];
                  for (const lbl of labelList) {
                    args.push('--label', lbl);
                  }
                  const out = execFileSync('gh', args, { encoding: 'utf8', timeout: 15000 });
                  issueUrl = out.trim().split(/\r?\n/).pop();
                } catch (err) {
                  // If failed (e.g. label does not exist on target repo), retry without labels
                  console.warn(`[promote] gh issue create with labels failed on ${repo}: ${err.message}. Retrying without labels.`);
                }
              }

              // Second attempt: without labels if first attempt failed or had no labels
              if (!issueUrl) {
                try {
                  const args = ['issue', 'create', '--repo', repo, '--title', title, '--body-file', tmpFile];
                  const out = execFileSync('gh', args, { encoding: 'utf8', timeout: 15000 });
                  issueUrl = out.trim().split(/\r?\n/).pop();
                } catch (err) {
                  console.error(`[promote] gh issue create failed on ${repo}: ${err.message}`);
                  issueUrl = `https://github.com/${repo}/issues/mock-${Date.now()}`;
                }
              }
            } finally {
              try { unlinkSync(tmpFile); } catch {}
            }
          }

          const ledgerPath = lockLedgerPath;
          let updatedCard = null;
          if (existsSync(ledgerPath)) {
            const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n').filter(Boolean);
            const updatedLines = [];
            for (const l of lines) {
              try {
                const item = JSON.parse(l);
                if (item.id === body.cardId) {
                  item.issue_url = issueUrl;
                  item.status = 'IN_PROGRESS';
                  updatedCard = item;
                }
                updatedLines.push(JSON.stringify(item));
              } catch {
                updatedLines.push(l);
              }
            }
            writeFileSync(ledgerPath, updatedLines.join('\n') + '\n', 'utf8');
            try {
              const { refreshLedgerMarkdown } = await import(resolve(ROOT, '../scripts/trm-ingress-watcher.mjs'));
              refreshLedgerMarkdown();
            } catch {}
          }

          if (!updatedCard) {
            updatedCard = { id: body.cardId, status: 'IN_PROGRESS', issue_url: issueUrl };
          }

          res.writeHead(200);
          res.end(JSON.stringify({ status: 'SUCCESS', issue_url: issueUrl, card: updatedCard }));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ status: 'ERROR', error: err.message }));
        }
        return;
      }

      if (pathname === '/api/reporting/weekly-retro') {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
        try {
          const data = await retroTransport.fetch();
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'SUCCESS', data }));
        } catch (err) {
          // Fall back to reporting submodule handler if file not on disk
          return reportingServer.emit('request', req, res);
        }
        return;
      }

      if (pathname.startsWith('/api/reporting/weekly-retro/')) {
        const projection = pathname.slice('/api/reporting/weekly-retro/'.length);
        if (['categories', 'evidence', 'actions'].includes(projection)) {
          res.setHeader('Content-Type', 'application/json; charset=UTF-8');
          try {
            const data = await retroTransport.fetch();
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'SUCCESS', data: Array.isArray(data[projection]) ? data[projection] : [] }));
            return;
          } catch (err) {
            if (projection === 'categories') {
              res.writeHead(200);
              res.end(JSON.stringify({ status: 'SUCCESS', data: CATEGORY_REGISTRY.categories }));
              return;
            }
            return reportingServer.emit('request', req, res);
          }
        }
      }

      // Delegate all other /api/reporting routes to reporting engine
      return reportingServer.emit('request', req, res);
    }

    // 2. Static Dashboard & Web Assets
    const reportingModulePaths = {
      '/modules/wiki/weekly-reporting-dashboard.mjs': 'reporting/weekly-reporting-dashboard.mjs',
      '/modules/wiki/src/weekly-retro-contract.mjs': 'reporting/src/weekly-retro-contract.mjs',
      '/modules/wiki/src/category-contract.mjs': 'reporting/src/category-contract.mjs',
      '/modules/wiki/src/action-continuity.mjs': 'reporting/src/action-continuity.mjs'
    };
    if (reportingModulePaths[pathname]) {
      const modulePath = resolve(ROOT, reportingModulePaths[pathname]);
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(readFileSync(modulePath));
      return;
    }
    let relativePath = pathname === '/' || pathname === '/dashboard' || pathname === '/dashboard/' || pathname === '/dashboard.html' || pathname === '/modules/wiki/dashboard.html'
      ? 'index.html'
      : (pathname.startsWith('/dashboard/') ? pathname.slice('/dashboard/'.length) : pathname.replace(/^\/+/, ''));

    // Resolve candidates across dashboard directory, modules/wiki, and _status-feed
    const candidatePaths = [
      normalize(resolve(DASHBOARD_DIR, relativePath))
    ];

    if (pathname.startsWith('/modules/wiki/')) {
      const stripped = pathname.slice('/modules/wiki/'.length);
      candidatePaths.push(normalize(resolve(DASHBOARD_DIR, stripped)));
      candidatePaths.push(normalize(resolve(ROOT, '..', 'modules', 'wiki', stripped)));
    } else if (pathname.startsWith('/_status-feed/')) {
      const stripped = pathname.slice('/_status-feed/'.length);
      candidatePaths.push(normalize(resolve(ROOT, '..', '_status-feed', stripped)));
      candidatePaths.push(normalize(resolve(DASHBOARD_DIR, stripped)));
    } else if (pathname.startsWith('/trm_history/')) {
      const filename = pathname.split('/').pop();
      candidatePaths.push(normalize(resolve(DASHBOARD_DIR, 'trm_history', filename)));
      candidatePaths.push(normalize(resolve(ROOT, '..', '_status-feed', 'trm_history', filename)));
    } else if (pathname.startsWith('/wiki/')) {
      const stripped = pathname.slice('/wiki/'.length);
      candidatePaths.push(normalize(resolve(ROOT, 'wiki', stripped)));
      candidatePaths.push(normalize(resolve(ROOT, '..', 'wiki', stripped)));
      candidatePaths.push(normalize(resolve(ROOT, '..', 'kb-sync', 'obsidian', 'vault', 'wiki', stripped)));
      candidatePaths.push(normalize(resolve(ROOT, '..', 'kb-sync', 'wiki', stripped)));
      candidatePaths.push(normalize(resolve(ROOT, '..', 'kb-sync-wiki', stripped)));
    }

    for (const targetPath of candidatePaths) {
      if (existsSync(targetPath) && statSync(targetPath).isFile()) {
        try {
          const ext = extname(targetPath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          const fileContent = readFileSync(targetPath);
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(fileContent);
          return;
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`500 Internal Server Error: ${err.message}`);
          return;
        }
      }

      // If .json was requested but only .json.gz exists, gunzip transparently
      if (targetPath.endsWith('.json')) {
        const gzPath = targetPath + '.gz';
        if (existsSync(gzPath) && statSync(gzPath).isFile()) {
          try {
            const buf = readFileSync(gzPath);
            const unzipped = zlib.gunzipSync(buf);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
            res.end(unzipped);
            return;
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`500 Internal Server Error: ${err.message}`);
            return;
          }
        }
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`404 Not Found: ${pathname}`);
  });

  server.on('close', () => {
    void toolforgeInvocation.dispose().catch(() => {});
    clearInterval(heartbeatInterval);
    if (feedWatcher) {
      try { feedWatcher.close(); } catch {}
    }
    for (const client of sseClients) {
      try { client.res.end(); } catch {}
    }
    sseClients.clear();
  });

  return server;
}

// Direct execution entrypoint
const isDirectEntry = process.argv[1] && (
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase() ||
  process.argv[1].replace(/\\/g, '/').endsWith('src/server.mjs')
);

if (isDirectEntry) {
  const server = createGatewayServer();
  server.listen(PORT, HOST, () => {
    console.log(`[ICF Gateway Server] Running at http://${HOST}:${PORT}`);
    console.log(`[ICF Gateway Server] Dashboard: http://${HOST}:${PORT}/dashboard`);
    console.log(`[ICF Gateway Server] API Endpoint: http://${HOST}:${PORT}/api/reporting/weekly-retro`);
    console.log(`[ICF Gateway Server] Ironbots Reporting: http://${HOST}:${PORT}/api/reporting/ironbots`);
  });
}
