import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  API_ROUTE,
  serializeApiSuccess,
  serializeApiUnavailable,
  validateWeeklyRetroReport
} from './weekly-retro-contract.mjs';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPORT_PATH = resolve(MODULE_DIR, '../test/fixtures/valid-report.json');

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
  snapshotIdentity = null
} = {}) {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
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
