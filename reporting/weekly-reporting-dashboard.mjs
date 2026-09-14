import {
  API_SUCCESS_STATUS,
  DASHBOARD_ELEMENT_NAME,
  DASHBOARD_SRC_ATTRIBUTE,
  validateWeeklyRetroReport
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
  if (!payload || !('data' in payload)) return 'Weekly retro response missing data.';
  const validation = validateWeeklyRetroReport(payload.data);
  if (!validation.ok) {
    return `Weekly retro response contains invalid data: ${validation.errors.join('; ')}`;
  }
  return null;
}

export function dashboardErrorMessage(error) {
  const detail = error instanceof Error ? error.message : String(error);
  return `Weekly telemetry unavailable: ${detail}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const HTMLElementBase = globalThis.HTMLElement || class {};

export class WeeklyReportingDashboard extends HTMLElementBase {
  static observedAttributes = [DASHBOARD_SRC_ATTRIBUTE];

  constructor() {
    super();
    this.attachShadow?.({ mode: 'open' });
  }

  connectedCallback() {
    void this.load();
  }

  attributeChangedCallback() {
    if (this.isConnected) void this.load();
  }

  async load() {
    const src = this.getAttribute?.(DASHBOARD_SRC_ATTRIBUTE);
    if (!src) {
      this.renderError('No reporting endpoint configured.');
      return;
    }

    try {
      const request = dashboardRequest(src);
      const response = await fetch(request.url, request.init);
      const payload = await response.json();
      const error = dashboardPayloadError(response, payload);
      if (error) throw new Error(error);
      this.render(payload.data);
    } catch (error) {
      this.renderError(dashboardErrorMessage(error));
    }
  }

  render(data = {}) {
    const metrics = data.metrics || {};
    const cards = [
      ['Commits', metrics.commits ?? 0],
      ['Contributors', metrics.contributors ?? 0],
      ['Net LOC', metrics.net_loc ?? 0],
      ['Test Ratio', `${((Number(metrics.test_ratio) || 0) * 100).toFixed(0)}%`]
    ];
    const cardsMarkup = cards.map(([label, value]) =>
      `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`
    ).join('');
    const date = escapeHtml(data.date || 'date unavailable');
    const window = escapeHtml(data.window || '7d');
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;color:var(--white,#faf6f0);font-family:var(--font-ui,Barlow,Arial,sans-serif)}
      .wrap{background:var(--forge,#1a1410);border:1px solid rgba(196,80,26,.4);padding:1.25rem;border-radius:8px}
      h3{margin:0;color:var(--brass,#b8922a);font-family:var(--font-display,'Playfair Display',Georgia,serif);font-size:1.35rem}
      .meta{color:var(--ash,#9a9088);font-size:.75rem;margin:.35rem 0 1rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.75rem}.card{background:var(--iron,#2c2420);border:1px solid rgba(154,144,136,.18);border-radius:6px;padding:.85rem}.label{color:var(--ash,#9a9088);font-size:.68rem;text-transform:uppercase;letter-spacing:.12em}.value{font-size:1.45rem;font-weight:700;margin-top:.25rem}
    </style><section class="wrap" aria-labelledby="weekly-retro-title"><h3 id="weekly-retro-title">Weekly Retro Reporting</h3><div class="meta">${window} · ${date}</div><div class="cards">${cardsMarkup}</div></section>`;
  }

  renderError(message) {
    this.shadowRoot.innerHTML = `<style>:host{display:block}.error{border:1px solid #9b2c2c;background:#321717;color:#f0a0a0;padding:1rem;border-radius:6px;font:14px Barlow,Arial,sans-serif}</style><div class="error" role="alert">⚠ ${escapeHtml(message)}</div>`;
  }
}

if (typeof globalThis.customElements !== 'undefined' && typeof globalThis.HTMLElement !== 'undefined' &&
    !globalThis.customElements.get(DASHBOARD_ELEMENT_NAME)) {
  globalThis.customElements.define(DASHBOARD_ELEMENT_NAME, WeeklyReportingDashboard);
}
