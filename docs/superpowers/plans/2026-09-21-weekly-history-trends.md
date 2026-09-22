# Weekly History and Trend Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose the stored weekly retro history and 4/8/12-week trend summaries through the live ICF gateway and Weekly Reporting dashboard.

**Architecture:** Reuse the existing SQLite snapshot store, `createHistoryAdapter`, and `trend-summary.mjs`. Gateway startup will ingest the canonical weekly JSON artifacts into the store, configure the history adapter, and serve the existing history route. The dashboard will fetch bounded history/trend data and render a compact comparison panel beside the current report.

**Tech Stack:** Node.js 22+, native `node:sqlite`, Node HTTP server, Web Components, Node test runner.

**Spec:** `reporting/docs/weekly-retro-reporting-contract.md`

## Global Constraints

- Keep the gateway on port 8080; do not introduce a new default port.
- Preserve current `/api/reporting/weekly-retro` response shape and latest-report behavior.
- Use existing snapshot identity fields: `sourceSystem`, `sourceId`, `weekKey`, and `categoryId`.
- Do not fabricate missing report facts; invalid snapshots remain unavailable and are not persisted.
- Preserve existing dirty files outside this feature.
- Treat fewer than two comparable weekly snapshots as `insufficient_history`.

## Review Focus

- No snapshot store or database file: gateway remains healthy and returns an explicit unavailable history state; test in Task 1.
- Duplicate reruns of the same week: ingestion is idempotent and does not create duplicate economic/reporting events; test in Task 1.
- Malformed or contract-invalid snapshot: latest endpoint behavior remains unchanged and history does not ingest it; test in Task 1.
- One-week history: trend response is `insufficient_history`, not a fabricated delta; test in Task 2.
- Missing or unavailable trend data in browser: current report remains visible and comparison panel shows bounded unavailable copy; test in Task 3.

### Task 1: Gateway snapshot ingestion and history wiring

**Files:**
- Modify: `src/server.mjs`
- Modify: `reporting/src/snapshot-store.mjs` only if the existing public ingestion method cannot accept the canonical weekly artifact; reuse the existing store, database path, and ingestion API
- Test: `test/gateway.test.mjs`
- Test: `reporting/test/history-adapter.test.mjs` only for the live adapter contract gap

**Interfaces:**
- Consumes: `RETRO_PATH`, `C:\dev\.icf-retros\weekly\retro-*.json`, `createSnapshotStore`, `createHistoryAdapter`, `createReportingServer`.
- Produces: gateway option wiring that passes `snapshotStore` and `historyAdapter` to `createReportingServer`; `GET /api/reporting/weekly-retro/history?categoryId=<id>&window=<4|8|12>` returns the existing bounded API envelope. Normalize each artifact date to its ISO `weekKey`, preserve `sourceSystem` plus artifact filename as `sourceId`, expand metrics into existing category rows, and upsert by `(sourceSystem, sourceId, weekKey)`.

- [ ] **Step 1: Write the failing gateway test**

  Add a test that starts `createGatewayServer` with a temporary report directory/store containing two weekly artifacts, requests the history route for `categoryId=delivery&window=4`, and asserts HTTP 200 with `status: "SUCCESS"`, both observed weeks, and `status: "insufficient_history"` for the 4-week window.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `node --test test/gateway.test.mjs`
  Expected: the history request is unavailable because the live gateway does not configure `historyAdapter`.

- [ ] **Step 3: Implement minimal startup wiring**

  In `createGatewayServer`, resolve the existing configured database path from the reporting config, construct the existing snapshot store, normalize and ingest valid weekly artifacts idempotently, create `createHistoryAdapter({ store, sourceSystem: 'icf', sourceId: 'weekly-retro' })`, and pass both into `createReportingServer`. Name the resolved config key/path in the implementation. Keep the current direct latest-file route unchanged; startup ingestion must not delete older weeks.

- [ ] **Step 4: Run focused tests**

  Run: `node --test test/gateway.test.mjs reporting/test/history-adapter.test.mjs`
  Expected: PASS, including duplicate ingestion and one-week insufficient-history behavior.

- [ ] **Step 5: Commit**

  Run: `git add src/server.mjs reporting/src/snapshot-store.mjs test/gateway.test.mjs reporting/test/history-adapter.test.mjs && git commit -m "feat: wire weekly history into gateway"`

### Task 2: Trend projection response

**Files:**
- Modify: `reporting/src/server.mjs` only if the existing history envelope lacks explicit comparison fields needed by the UI
- Test: `reporting/test/history-adapter.test.mjs`

**Interfaces:**
- Consumes: Task 1 history endpoint and existing `computeTrend` output.
- Produces: stable response fields `state`, `status`, `categoryId`, `window`, `fromWeek`, `toWeek`, and `summary` for ready, recalculating, and insufficient-history states.

- [ ] **Step 1: Add contract assertions**

  Assert that two snapshots return both current/previous values and a comparison, while one snapshot produces `status: "insufficient_history"` with no fabricated delta. A 4/8/12-week window remains insufficient until it has enough comparable weeks.

- [ ] **Step 2: Run the focused trend tests**

  Run: `node --test reporting/test/history-adapter.test.mjs reporting/test/trend-summary.test.mjs`
  Expected: FAIL only for any missing live-envelope fields.

- [ ] **Step 3: Implement the smallest envelope adjustment**

  Preserve `computeTrend` output and add only fields required for stable browser rendering; do not add a second trend algorithm.

- [ ] **Step 4: Run focused tests and commit**

  Run: `node --test reporting/test/history-adapter.test.mjs reporting/test/trend-summary.test.mjs`
  Expected: PASS.

  Commit: `git add reporting/src/server.mjs reporting/test/history-adapter.test.mjs && git commit -m "feat: expose weekly trend contract"`

### Task 3: Weekly Reporting comparison panel

**Files:**
- Modify: `reporting/weekly-reporting-dashboard.mjs`
- Modify: `dashboard/index.html` only if the existing custom element needs a comparison container or refresh hook
- Test: `reporting/test/dashboard-entrypoint.test.mjs`

**Interfaces:**
- Consumes: `/api/reporting/weekly-retro` and `/api/reporting/weekly-retro/history`.
- Produces: latest report remains visible; comparison panel renders current week, prior week, selected window, deltas, and explicit insufficient/unavailable copy. Define and test response fields `status`, `windowWeeks`, `weeks`, `comparison`, `trends`, and `missingWeeks`, plus the exact comparison-panel DOM target.

- [ ] **Step 1: Write failing component tests**

  Add tests for ready comparison, insufficient history, and history request failure while asserting the latest report markup remains present.

- [ ] **Step 2: Run focused component tests**

  Run: `node --test reporting/test/dashboard-entrypoint.test.mjs`
  Expected: FAIL because the component currently renders only the latest report.

- [ ] **Step 3: Implement the comparison panel**

  Fetch the history endpoint after the current report succeeds, render bounded text from the validated response, and leave the current report intact when history is unavailable.

- [ ] **Step 4: Run component tests**

  Run: `node --test reporting/test/dashboard-entrypoint.test.mjs`
  Expected: PASS.

- [ ] **Step 5: Commit**

  Run: `git add reporting/weekly-reporting-dashboard.mjs dashboard/index.html reporting/test/dashboard-entrypoint.test.mjs && git commit -m "feat: render weekly report comparisons"`

### Task 4: Live verification and regression gate

**Files:**
- Modify: none unless verification exposes a contract defect
- Test: existing gateway and reporting suites

- [ ] **Step 1: Run full tests**

  Run: `npm test`
  Expected: all reporting and gateway tests pass.

- [ ] **Step 2: Start the established gateway**

  Run: `pwsh -NoProfile -File C:\dev\icf\scripts\ensure-dashboard-server.ps1 -RepoRoot C:\dev\icf -Port 8080 -BindHost 127.0.0.1`
  Expected: healthy `http://127.0.0.1:8080/dashboard`.

- [ ] **Step 3: Verify live API responses**

  Request `/api/reporting/weekly-retro` and `/api/reporting/weekly-retro/history?categoryId=delivery&window=4`; assert JSON, that the date and week key match the newest canonical artifact discovered at runtime, and that comparison state is correct.

- [ ] **Step 4: Verify BrowserOS neo**

  Open `http://127.0.0.1:8080/dashboard`, select Weekly Reporting, refresh, and confirm the current report plus comparison panel render without console errors.

- [ ] **Step 5: Report evidence**

  Record focused tests, full suite, live API, and browser verification separately. Do not claim production or remote readiness.

## Self-review

- Spec coverage: snapshot identity, bounded history, trend windows, insufficient-history behavior, reader compatibility, and dashboard integration are covered by Tasks 1–3.
- Placeholder scan: no TODO/TBD steps; each task includes concrete files, interfaces, commands, and expected outcomes.
- Scope: no new dependency, port, or parallel trend implementation.
- Remaining deliberate boundary: this plan does not add a separate historical chart library; the first slice uses the existing trend summary and compact comparison panel.
