import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const FIXTURES = dirname(fileURLToPath(import.meta.url));

function installFakeDom() {
  const previous = {
    HTMLElement: globalThis.HTMLElement,
    customElements: globalThis.customElements,
    fetch: globalThis.fetch
  };
  class FakeHTMLElement {
    constructor() {
      this.attributes = new Map();
      this.isConnected = false;
      this.shadowRoot = null;
    }

    attachShadow() {
      this.shadowRoot = { innerHTML: '' };
      return this.shadowRoot;
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    setAttribute(name, value) {
      const oldValue = this.getAttribute(name);
      this.attributes.set(name, String(value));
      this.attributeChangedCallback?.(name, oldValue, String(value));
    }
  }
  const definitions = new Map();
  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.customElements = {
    define(name, constructor) { definitions.set(name, constructor); },
    get(name) { return definitions.get(name); }
  };
  return { FakeHTMLElement, definitions, previous };
}

function restoreFakeDom(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
}

test('imports as a browser-valid custom element and renders fetched data', async () => {
  const { FakeHTMLElement, definitions, previous } = installFakeDom();
  try {
    const dashboard = await import(`../weekly-reporting-dashboard.mjs?browser-test=${Date.now()}`);
    assert.equal(dashboard.WeeklyReportingDashboard.prototype instanceof FakeHTMLElement, true);
    assert.equal(definitions.get('weekly-reporting-dashboard'), dashboard.WeeklyReportingDashboard);
    assert.deepEqual(dashboard.WeeklyReportingDashboard.observedAttributes, ['src']);

    const validReport = JSON.parse(await readFile(join(FIXTURES, 'fixtures', 'valid-report.json'), 'utf8'));
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: 'SUCCESS', data: validReport };
        }
      };
    };

    const element = new dashboard.WeeklyReportingDashboard();
    element.setAttribute('src', '/api/reporting/weekly-retro');
    await element.load();
    assert.deepEqual(requests, [{
      url: '/api/reporting/weekly-retro',
      init: { method: 'GET', headers: { Accept: 'application/json' } }
    }]);
    assert.match(element.shadowRoot.innerHTML, /Weekly Retro Reporting/);
    assert.match(element.shadowRoot.innerHTML, />37<\/dd>/);
    assert.match(element.shadowRoot.innerHTML, /2026-09-13/);
  } finally {
    restoreFakeDom(previous);
  }
});

test('runs connected lifecycle and renders endpoint, transport, and payload errors', async () => {
  const { previous } = installFakeDom();
  try {
    const dashboard = await import(`../weekly-reporting-dashboard.mjs?lifecycle-test=${Date.now()}`);
    const missing = new dashboard.WeeklyReportingDashboard();
    await missing.load();
    assert.match(missing.shadowRoot.innerHTML, /No reporting endpoint configured/);

    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      async json() { return { status: 'SUCCESS' }; }
    });
    const missingData = new dashboard.WeeklyReportingDashboard();
    missingData.setAttribute('src', '/api/reporting/weekly-retro');
    await missingData.load();
    assert.match(missingData.shadowRoot.innerHTML, /Weekly retro response missing data/);
    assert.doesNotMatch(missingData.shadowRoot.innerHTML, /Weekly Retro Reporting/);

    globalThis.fetch = async () => ({
      ok: false,
      status: 503,
      async json() { return { status: 'UNAVAILABLE', error: 'offline' }; }
    });
    const failed = new dashboard.WeeklyReportingDashboard();
    failed.setAttribute('src', '/api/reporting/weekly-retro');
    failed.isConnected = true;
    failed.connectedCallback();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(failed.shadowRoot.innerHTML, /Weekly telemetry unavailable: offline/);
    assert.match(failed.shadowRoot.innerHTML, /role="alert"/);
  } finally {
    restoreFakeDom(previous);
  }
});

test('renders review-canvas drill-down sections and rejects HTML responses clearly', async () => {
  const { previous } = installFakeDom();
  try {
    const dashboard = await import(`../weekly-reporting-dashboard.mjs?canvas-test=${Date.now()}`);
    const element = new dashboard.WeeklyReportingDashboard();
    element.render({ date: '2026-09-13', window: '7d', metrics: { commits: 2 }, categories: [{ id: 'delivery', name: 'Delivery', summary: 'Shipped work' }], evidence: [{ label: 'commit abc123' }], actions: [{ title: 'Review flaky test', status: 'open' }] });
    assert.match(element.shadowRoot.innerHTML, /aria-label="Executive summary"/);
    assert.match(element.shadowRoot.innerHTML, /Category review/);
    assert.match(element.shadowRoot.innerHTML, /commit abc123/);
    assert.match(element.shadowRoot.innerHTML, /Review flaky test/);
    assert.match(element.shadowRoot.innerHTML, /href="#category-delivery"/);

    globalThis.fetch = async () => ({ ok: true, status: 200, async text() { return '<html>'; } });
    const broken = new dashboard.WeeklyReportingDashboard();
    broken.setAttribute('src', '/api/reporting/weekly-retro');
    await broken.load();
    assert.match(broken.shadowRoot.innerHTML, /non-JSON content/);
  } finally {
    restoreFakeDom(previous);
  }
});
