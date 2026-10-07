import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, watch } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import os from 'node:os';
import { LocalFileAdapterTransport } from './adapters/LocalFileAdapterTransport.mjs';
import { createReportingServer } from '../reporting/src/server.mjs';
import { createSnapshotStore } from '../reporting/src/snapshot-store.mjs';
import { createHistoryAdapter } from '../reporting/src/history-adapter.mjs';
import { validateWeeklyRetroReport } from '../reporting/src/weekly-retro-contract.mjs';
import { weekRange, SUPPORTED_TREND_WINDOWS } from '../reporting/src/trend-summary.mjs';
import { createMobileSnapshotService } from './mobile-snapshot.mjs';
import { CATEGORY_REGISTRY } from '../reporting/src/weekly-retro-contract.mjs';

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

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});
export const ROOT = resolve(__dirname, '..');
export const DASHBOARD_DIR = resolve(ROOT, 'dashboard');
export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
export const HOST = process.env.ICF_HOST || '0.0.0.0';
export const RETRO_PATH = process.env.HELIX_WEEKLY_RETRO_PATH || resolve(ROOT, '../.icf-retros/weekly/latest-weekly-retro.json');
export const REPORTING_HISTORY_SOURCE_SYSTEM = 'icf';
export const REPORTING_HISTORY_SOURCE_ID = 'weekly-retro';

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

export function createGatewayServer(options = {}) {
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
    // Check raw requested URL for directory traversal patterns
    if (req.url && (req.url.includes('/..') || req.url.includes('\\..') || req.url.includes('%2e%2e') || req.url.includes('%2E%2E'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden: Invalid file path');
      return;
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = reqUrl.pathname;

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
            resolve(ROOT, '../.trm/inbox/outbox')
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

    // Resolve candidate strictly within dashboard directory
    const targetPath = normalize(resolve(DASHBOARD_DIR, relativePath));

    const isInsideDashboard = targetPath === DASHBOARD_DIR || targetPath.startsWith(DASHBOARD_DIR + sep);

    if (!isInsideDashboard) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden: Invalid file path');
      return;
    }

    if (existsSync(targetPath) && statSync(targetPath).isFile()) {
      try {
        const ext = extname(targetPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const fileContent = readFileSync(targetPath);
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(fileContent);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`500 Internal Server Error: ${err.message}`);
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`404 Not Found: ${pathname}`);
  });

  server.on('close', () => {
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
