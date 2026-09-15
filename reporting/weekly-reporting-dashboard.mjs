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

async function responsePayload(response) {
  if (typeof response.text !== 'function') return response.json();
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error('Reporting endpoint returned non-JSON content.'); }
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
      this.renderLoading();
      const request = dashboardRequest(src);
      const response = await fetch(request.url, request.init);
      const payload = await responsePayload(response);
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
      `<div class="metric"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
    ).join('');
    const date = escapeHtml(data.date || 'date unavailable');
    const window = escapeHtml(data.window || '7d');
    const categories = Array.isArray(data.categories) ? data.categories : [];
    const actions = Array.isArray(data.actions) ? data.actions : [];
    const evidence = Array.isArray(data.evidence) ? data.evidence : [];
    const categoryMarkup = categories.length ? categories.map(category =>
      `<article class="category" id="category-${escapeHtml(category.id || category.name || 'item')}"><h3>${escapeHtml(category.name || 'Category')}</h3><p>${escapeHtml(category.summary || 'No category summary available.')}</p></article>`
    ).join('') : '<p class="muted">No category activity recorded for this period.</p>';
    const evidenceMarkup = evidence.length ? evidence.map(item => `<li>${escapeHtml(item.label || item.commit || item.detail || 'Evidence recorded')}</li>`).join('') : '<li class="muted">No evidence attached.</li>';
    const actionMarkup = actions.length ? actions.map(item => `<li><strong>${escapeHtml(item.title || item.action || 'Action')}</strong><span>${escapeHtml(item.status || 'open')}</span></li>`).join('') : '<li class="muted">No follow-up actions recorded.</li>';
    this.shadowRoot.innerHTML = `<style>
      :host{display:block;color:var(--white,#faf6f0);font-family:var(--font-ui,Barlow,Arial,sans-serif)}
      .wrap{background:var(--forge,#1a1410);border:1px solid rgba(196,80,26,.4);padding:clamp(1rem,3vw,2rem);border-radius:8px}.hero{border-bottom:1px solid rgba(184,146,42,.35);padding-bottom:1rem}h2,h3{margin:0;color:var(--brass,#b8922a);font-family:var(--font-display,'Playfair Display',Georgia,serif)}h2{font-size:clamp(1.4rem,3vw,2rem)}h3{font-size:1.15rem}.meta,.muted{color:var(--ash,#9a9088);font-size:.85rem}.status{margin-top:.75rem;color:#d7e7c1}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.65rem;margin:1rem 0}.metric{background:var(--iron,#2c2420);border:1px solid rgba(154,144,136,.18);border-radius:6px;padding:.8rem}.metric dt{color:var(--ash,#9a9088);font-size:.68rem;text-transform:uppercase;letter-spacing:.12em}.metric dd{font-size:1.4rem;font-weight:700;margin:.25rem 0 0}.columns{display:grid;grid-template-columns:1.4fr 1fr;gap:1rem}.panel{border-top:2px solid var(--rust,#c4501a);padding-top:.8rem}nav{display:flex;flex-wrap:wrap;gap:.5rem;margin:1rem 0}nav a{color:var(--white,#faf6f0);border:1px solid rgba(184,146,42,.5);padding:.7rem;min-height:44px;display:inline-flex;align-items:center;text-decoration:none}nav a:focus-visible{outline:3px solid #d7e7c1;outline-offset:2px}ul{padding-left:1.2rem}li{margin:.55rem 0}li span{color:var(--ash,#9a9088);margin-left:.5rem}@media(max-width:650px){.columns{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
    </style><section class="wrap" aria-labelledby="weekly-retro-title"><header class="hero"><h2 id="weekly-retro-title">Weekly Retro Reporting</h2><div class="meta">${window} · ${date}</div><div class="status" aria-label="Report status">● Report available</div></header><dl class="metrics" aria-label="Executive summary">${cardsMarkup}</dl><nav aria-label="Retro categories">${categories.length ? categories.map(c => `<a href="#category-${escapeHtml(c.id || c.name || 'item')}">${escapeHtml(c.name || 'Category')}</a>`).join('') : '<span class="muted">Category navigation unavailable.</span>'}</nav><div class="columns"><section class="panel" aria-labelledby="categories-title"><h3 id="categories-title">Category review</h3>${categoryMarkup}</section><aside><section class="panel" aria-labelledby="evidence-title"><h3 id="evidence-title">Evidence</h3><ul>${evidenceMarkup}</ul></section><section class="panel" aria-labelledby="actions-title"><h3 id="actions-title">Action ledger</h3><ul>${actionMarkup}</ul></section></aside></div></section>`;
  }

  renderLoading() {
    this.shadowRoot.innerHTML = '<div role="status" aria-live="polite">Loading weekly retro reporting…</div>';
  }

  renderError(message) {
    this.shadowRoot.innerHTML = `<style>:host{display:block}.error{border:1px solid #9b2c2c;background:#321717;color:#f0a0a0;padding:1rem;border-radius:6px;font:14px Barlow,Arial,sans-serif}</style><div class="error" role="alert">⚠ ${escapeHtml(message)}</div>`;
  }
}

if (typeof globalThis.customElements !== 'undefined' && typeof globalThis.HTMLElement !== 'undefined' &&
    !globalThis.customElements.get(DASHBOARD_ELEMENT_NAME)) {
  globalThis.customElements.define(DASHBOARD_ELEMENT_NAME, WeeklyReportingDashboard);
}
