import {
  API_SUCCESS_STATUS,
  DASHBOARD_ELEMENT_NAME,
  DASHBOARD_SRC_ATTRIBUTE
} from './src/weekly-retro-contract.mjs';

export { DASHBOARD_ELEMENT_NAME, DASHBOARD_SRC_ATTRIBUTE };

export function dashboardRequest(src) {
  if (typeof src !== 'string' || src.length === 0) {
    throw new TypeError('No reporting endpoint configured.');
  }
  return {
    url: src,
    init: { method: 'GET', headers: { Accept: 'application/json' } }
  };
}

export function dashboardPayloadError(response, payload) {
  if (!response.ok || payload?.status !== API_SUCCESS_STATUS) {
    return payload?.error || `HTTP ${response.status}`;
  }
  return null;
}

export function dashboardErrorMessage(error) {
  const detail = error instanceof Error ? error.message : String(error);
  return `Weekly telemetry unavailable: ${detail}`;
}

export class WeeklyReportingDashboard {
  static observedAttributes = [DASHBOARD_SRC_ATTRIBUTE];
}

if (typeof globalThis.customElements !== 'undefined' && typeof globalThis.HTMLElement !== 'undefined' &&
    !globalThis.customElements.get(DASHBOARD_ELEMENT_NAME)) {
  globalThis.customElements.define(DASHBOARD_ELEMENT_NAME, WeeklyReportingDashboard);
}
