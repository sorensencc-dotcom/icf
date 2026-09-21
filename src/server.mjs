import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalFileAdapterTransport } from './adapters/LocalFileAdapterTransport.mjs';
import { createReportingServer } from '../reporting/src/server.mjs';
import { createMobileSnapshotService } from './mobile-snapshot.mjs';
import { CATEGORY_REGISTRY } from '../reporting/src/weekly-retro-contract.mjs';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
export const ROOT = resolve(__dirname, '..');
export const DASHBOARD_DIR = resolve(ROOT, 'dashboard');
export const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
export const HOST = process.env.ICF_HOST || '0.0.0.0';
export const RETRO_PATH = process.env.HELIX_WEEKLY_RETRO_PATH || resolve(ROOT, '../.icf-retros/weekly/latest-weekly-retro.json');

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
  const reportingServer = createReportingServer(options);
  const mobileSnapshot = options.mobileSnapshot || (process.env.ICF_SNAPSHOT_SIGNING_KEY && process.env.ICF_MOBILE_AUTH_TOKEN ? createMobileSnapshotService({ reportPath: options.reportPath || RETRO_PATH }) : null);

  return createServer(async (req, res) => {
    // Check raw requested URL for directory traversal patterns
    if (req.url && (req.url.includes('/..') || req.url.includes('\\..') || req.url.includes('%2e%2e') || req.url.includes('%2E%2E'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden: Invalid file path');
      return;
    }

    const reqUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = reqUrl.pathname;

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
          const reportPath = resolve(ROOT, '../_status-feed/ironbots_daily_report.json');
          if (existsSync(reportPath)) {
            const data = JSON.parse(readFileSync(reportPath, 'utf8'));
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'SUCCESS', data }));
            return;
          }
          const { aggregateFleetActivity } = await import('../../scripts/ironbots-daily-reporter.mjs');
          const data = await aggregateFleetActivity({ isDryRun: true });
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'SUCCESS', data }));
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
    let relativePath = pathname === '/' || pathname === '/dashboard' || pathname === '/dashboard/'
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
