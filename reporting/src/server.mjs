import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CATEGORY_REGISTRY,
  CATEGORY_REGISTRY_VERSION,
  LAUNCH_CATEGORY_IDS,
  API_ROUTE,
  serializeApiSuccess,
  serializeApiUnavailable,
  validateWeeklyRetroReport
} from './weekly-retro-contract.mjs';
import { validateRoutingFacts } from './routing-telemetry.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPORT_PATH = resolve(MODULE_DIR, '../test/fixtures/valid-report.json');
export const HISTORY_API_ROUTE = '/api/reporting/weekly-retro/history';
export const CATEGORIES_API_ROUTE = '/api/reporting/weekly-retro/categories';
export const EVIDENCE_API_ROUTE = '/api/reporting/weekly-retro/evidence';
export const ACTIONS_API_ROUTE = '/api/reporting/weekly-retro/actions';
export const ROUTING_API_ROUTE = '/api/reporting/weekly-retro/routing';

export async function readWeeklyRetro(reportPath = DEFAULT_REPORT_PATH) {
  const raw = await readFile(reportPath, 'utf8');
  const report = JSON.parse(raw);
  const validation = validateWeeklyRetroReport(report);
  if (!validation.ok) {
    throw new Error(`schema validation failed: ${validation.errors.join('; ')}`);
  }
  return report;
}

export function publishWeeklyRetroSnapshot({ store, identity, report, schemaVersion = '1.0' }) {
  if (!store || typeof store.upsertSnapshot !== 'function') {
    throw new TypeError('A local snapshot store is required for publication');
  }
  const validation = validateWeeklyRetroReport(report);
  if (!validation.ok) {
    throw new TypeError(`Cannot publish invalid weekly retro report: ${validation.errors.join('; ')}`);
  }
  return store.upsertSnapshot(identity, { schemaVersion, report });
}

export function createReportingServer({
  reportPath = DEFAULT_REPORT_PATH,
  readReport = readWeeklyRetro,
  snapshotStore = null,
  snapshotIdentity = null,
  historyAdapter = null,
  actionStore = null,
  routingFacts = null
} = {}) {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const json = (status, payload) => { response.setHeader('Content-Type', 'application/json; charset=UTF-8'); response.writeHead(status); response.end(JSON.stringify(payload)); };
    if (request.method === 'GET' && requestUrl.pathname === CATEGORIES_API_ROUTE) {
      return json(200, { status: 'SUCCESS', schemaVersion: CATEGORY_REGISTRY_VERSION, freshness: 'static', quality: 'validated', partial: false, data: CATEGORY_REGISTRY });
    }
    if (request.method === 'GET' && requestUrl.pathname === ROUTING_API_ROUTE) {
      if (!routingFacts) return json(503, { status: 'UNAVAILABLE', schemaVersion: '1.0', freshness: 'unavailable', quality: 'unavailable', partial: true, error: 'Routing facts unavailable' });
      try { return json(200, { status: 'SUCCESS', schemaVersion: '1.0', freshness: 'current', quality: 'evaluator_facts', partial: false, data: validateRoutingFacts(routingFacts) }); }
      catch (error) { return json(503, { status: 'UNAVAILABLE', schemaVersion: '1.0', freshness: 'invalid', quality: 'unavailable', partial: true, error: error.message }); }
    }
    if (request.method === 'GET' && (requestUrl.pathname === ACTIONS_API_ROUTE || requestUrl.pathname === EVIDENCE_API_ROUTE)) {
      try {
        const fromWeek = requestUrl.searchParams.get('fromWeek');
        const toWeek = requestUrl.searchParams.get('toWeek');
        if (!fromWeek || !toWeek) throw new TypeError('fromWeek and toWeek are required');
        if (!actionStore || typeof actionStore.listActions !== 'function') throw new Error('Action ledger unavailable');
        const data = actionStore.listActions({ fromWeek, toWeek, categoryId: requestUrl.searchParams.get('categoryId') ?? undefined, limit: 100 });
        const projected = requestUrl.pathname === EVIDENCE_API_ROUTE
          ? data.flatMap(action => action.provenanceLinks.map(link => ({ sourceId: action.sourceId, weekKey: action.weekKey, categoryId: action.categoryId, ...link })))
          : data.map(({ wording, title, displayLabel, label, owner, status, theme, themes, provenanceLinks, ...safe }) => ({ ...safe, wording, title, displayLabel, label, owner, status, theme, themes, provenanceLinks }));
        return json(200, { status: 'SUCCESS', schemaVersion: '1.0', freshness: 'current', quality: 'validated', partial: false, data: projected });
      } catch (error) { return json(503, { status: 'UNAVAILABLE', schemaVersion: '1.0', freshness: 'unavailable', quality: 'unavailable', partial: true, error: error instanceof Error ? error.message : String(error) }); }
    }
    if (requestUrl.pathname === HISTORY_API_ROUTE && request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json; charset=UTF-8');
      try {
        if (!historyAdapter || typeof historyAdapter.getTrend !== 'function') {
          throw new Error('Local history adapter is not configured');
        }
        const categoryId = requestUrl.searchParams.get('categoryId') ?? requestUrl.searchParams.get('category');
        const window = Number(requestUrl.searchParams.get('window'));
        const trend = historyAdapter.getTrend({ categoryId, window });
        const recalculating = trend.state === 'TrendRecalculating';
        response.writeHead(recalculating ? 202 : 200);
        response.end(JSON.stringify({
          status: recalculating ? 'TREND_RECALCULATING' : 'SUCCESS',
          data: trend
        }));
      } catch (error) {
        response.writeHead(503);
        response.end(JSON.stringify({
          status: 'UNAVAILABLE',
          error: `Weekly retro history unavailable: ${error instanceof Error ? error.message : String(error)}`
        }));
      }
      return;
    }
    if (requestUrl.pathname !== API_ROUTE || request.method !== 'GET') {
      response.writeHead(404, { 'Content-Type': 'application/json; charset=UTF-8' });
      response.end(JSON.stringify({ status: 'NOT_FOUND', error: 'Reporting route not found' }));
      return;
    }

    response.setHeader('Content-Type', 'application/json; charset=UTF-8');
    try {
      const report = await readReport(reportPath);
      const payload = serializeApiSuccess(report);
      if (snapshotStore) {
        const identity = typeof snapshotIdentity === 'function' ? snapshotIdentity(report) : snapshotIdentity;
        publishWeeklyRetroSnapshot({ store: snapshotStore, identity, report });
      }
      response.writeHead(200);
      response.end(JSON.stringify(payload));
    } catch (error) {
      response.writeHead(503);
      response.end(JSON.stringify(serializeApiUnavailable(reportPath, error)));
    }
  });
}

export function startReportingServer({ port = Number(process.env.PORT || 0), reportPath = process.env.ICF_WEEKLY_RETRO_PATH || DEFAULT_REPORT_PATH } = {}) {
  const server = createReportingServer({ reportPath });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolveServer(server);
    });
  });
}
