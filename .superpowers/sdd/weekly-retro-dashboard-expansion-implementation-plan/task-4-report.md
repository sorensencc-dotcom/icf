# Task 4 report — Add compatibility normalization and trend summaries

## Status

DONE_WITH_CONCERNS

## Scope

Implementation repository: `C:\dev\icf`

Branch: `codex/weekly-retro-reporting`

No agents were spawned. The implementation remains local-only and uses the existing SQLite store. No cloud, remote, or production path was added.

## Changed paths

Implementation commit:

- `reporting/src/snapshot-envelope.mjs`
- `reporting/src/trend-summary.mjs`
- `reporting/src/history-adapter.mjs`
- `reporting/src/snapshot-store.mjs`
- `reporting/src/server.mjs`
- `reporting/schema/001_snapshot_store.sql`
- `reporting/schema/003_snapshot_trend_summaries.sql`
- `reporting/test/snapshot-envelope.test.mjs`
- `reporting/test/trend-summary.test.mjs`
- `reporting/test/history-adapter.test.mjs`
- `reporting/test/snapshot-store.test.mjs`

Documentation path:

- `.superpowers/sdd/weekly-retro-dashboard-expansion-implementation-plan/task-4-report.md`

## Decisions

1. Added `normalizeSnapshot(envelope)` as a pure reader-side adapter. It accepts current store records, current `{schemaVersion, report}` envelopes, legacy snake_case identity fields, nested `snapshot`/`payload`/`data` layouts, and direct historical reports. It returns a canonical current shape with immutable identity, category-normalized metrics, explicit state, source schema version, original envelope, redaction projection, and a `normalizationChanged` signal. It never rewrites historical raw envelopes.
2. Reused the Task 2 registry and `normalizeCategoryMetrics` contract. Missing registered fields remain partial metric values; nullable source values remain null and are not converted to zero. Explicit `empty`, `partial`, `unavailable`, and `zero-activity` states remain distinct. Redacted rows normalize to `unavailable` without exposing raw content.
3. Added `computeTrend(snapshots, window)` for exactly 4, 8, or 12 weeks. The result contains deterministic week slots, `missingWeeks`, `partialWeeks`, `unavailableWeeks`, complete-week count, normalized metric series, latest value, sum, average, min, max, observed count, and directional trend. Missing and partial values remain null. Fewer than two complete weeks returns `insufficient_history`; gaps or partial/unavailable weeks return `partial`; complete windows return `complete`.
4. Added `snapshot_trend_summaries` as indexed materialized local storage. Rows are keyed by source system, source ID, category, window, and exact week bounds. `saveTrendSummary` clears stale state only after an explicit rebuild. Existing Task 3 databases receive migration 003; schema version is now 3.
5. Added `createHistoryAdapter({store, sourceSystem, sourceId})` with the required `getTrend({categoryId, window})` and `rebuildSummaries({fromWeek, toWeek, categoryId})` interfaces. Reads normalize before use. Missing or stale rows return `{state: 'TrendRecalculating'}` with reason and bounds rather than serving stale data.
6. Upserts and redactions invalidate overlapping materialized rows in the same SQLite transaction. Reader normalization invalidates summaries for the normalized snapshot through the history adapter. Rebuild writes a fresh derived row and preserves all raw snapshot versions.
7. Added `GET /api/reporting/weekly-retro/history?categoryId=...&window=...` behind an explicitly supplied local history adapter. Ready results return HTTP 200; recalculation returns HTTP 202; absent adapter or invalid requests return bounded HTTP 503 JSON. Existing current-report route behavior remains unchanged.

## Tests added

`reporting/test/snapshot-envelope.test.mjs` covers:

- legacy nested envelope normalization;
- snake_case compatibility fields;
- identity and source-version preservation;
- explicit empty, partial, and zero-activity states.

`reporting/test/trend-summary.test.mjs` covers:

- four-week missing-week and partial-week handling;
- 4/8/12-week bounds;
- zero-activity preservation;
- insufficient history.

`reporting/test/history-adapter.test.mjs` covers:

- explicit `TrendRecalculating` state before materialization;
- rebuild and ready retrieval;
- upsert invalidation;
- redaction invalidation;
- reader-normalization invalidation;
- local history HTTP route.

Existing snapshot tests now also assert the materialized summary table and schema version 3.

## Exact verification commands and outputs

Failing-first command:

```text
npm --prefix reporting test -- --test-name-pattern='normalizes|computes|recalculating|materialized'
```

Initial red output:

```text
ERR_MODULE_NOT_FOUND: Cannot find module 'C:\dev\icf\reporting\src\history-adapter.mjs'
ERR_MODULE_NOT_FOUND: Cannot find module 'C:\dev\icf\reporting\src\snapshot-envelope.mjs'
ERR_MODULE_NOT_FOUND: Cannot find module 'C:\dev\icf\reporting\src\trend-summary.mjs'
ℹ tests 50
ℹ pass 47
ℹ fail 3
```

Focused command after implementation:

```text
npm --prefix reporting test -- --test-name-pattern='normalizes|computes|recalculating|materialized|snapshot schema|schema metadata'
```

Output:

```text
ℹ tests 53
ℹ pass 53
ℹ fail 0
```

Full reporting package:

```text
npm --prefix reporting test
```

Output:

```text
ℹ tests 54
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Week-boundary check:

```text
node --input-type=module -e "import { weekRange } from './reporting/src/trend-summary.mjs'; console.log(weekRange('2026-W01', 4).join(',')); console.log(weekRange('2025-W01', 4).join(','));"
```

Output:

```text
2025-W50,2025-W51,2025-W52,2026-W01
2024-W50,2024-W51,2024-W52,2025-W01
```

Syntax and whitespace:

```text
Get-ChildItem reporting -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
git diff --cached --check
```

Output: no output; all commands exited `0`. The syntax command also printed `syntax: ok` in the final combined verification run.

Commit check:

```text
git commit -m "feat: add compatible weekly retro trends"
git log -1 --format='%H%n%s'
git status --short --branch
```

Output:

```text
[codex/weekly-retro-reporting 6ad8418] feat: add compatible weekly retro trends
6ad84188a86fbfbfbfd47c8edc4e9a4019fbaad0
feat: add compatible weekly retro trends
## codex/weekly-retro-reporting
```

Observed runtime during tests: Node `v24.18.0`, built-in SQLite `3.53.1`.

## Commit

`6ad84188a86fbfbfbfd47c8edc4e9a4019fbaad0` — `feat: add compatible weekly retro trends`

The report was written after the implementation hash was known and is committed separately from the feature commit. No unrelated worktree changes were present.

## Concerns

- The checkout remains a standalone reporting repository. No parent report generator, scheduled writer, live service, browser-engine run, remote integration, or production approval exists here or is claimed.
- The materialized store uses Node `node:sqlite`; execution still requires Node `>=22.5.0` with `DatabaseSync`, as established by Task 3.
- `createHistoryAdapter` requires an explicit source system and source ID. The future API integration must provide those from an approved local identity boundary; it must not infer remote credentials or cloud routing.
- `rebuildSummaries` accepts exact 4-, 8-, or 12-week ranges. A later contract can add other ranges only with a versioned interface and migration decision.
- The existing snapshot list cap remains 100 rows. The history adapter narrows reads to one explicit source, source ID, category, and rolling window, so trend reads stay within the bounded path.
- The report is separate from the feature commit so the feature hash remains stable and the report records the exact implementation commit.

## Fix round 1 — review findings

Status: COMPLETE_WITH_CONCERNS

Addressed all five review findings:

1. Added `getLatestSnapshotWeek` with source/category bounds, descending week order, and `LIMIT 1`. `listSnapshots` also accepts an optional descending order and limit for compatible adapter stores; its default remains the Task 3 ascending 100-row cap.
2. Moved materialized-summary invalidation outside the raw-envelope branch. Every new redaction now invalidates overlapping summaries, including an identity with no raw envelope; repeated redactions remain idempotent.
3. `getTrend` now retains top-level `insufficient_history` state/status from a materialized summary while preserving `ready` for materialized complete/partial summaries and `TrendRecalculating` for stale/missing summaries.
4. Empty trend windows now return explicit `partial`/`incomplete` state, visible missing week slots when `toWeek` is supplied, `complete: false`, and null metric values.
5. Expanded 8/12-week tests to assert metric values and aggregates, states, status, missing/partial weeks, zero activity, and insufficient-history behavior. Added regression tests for the latest-week cap, unknown-identity redaction, and history status projection.

Implementation commit:

`e8b85d21c37234902c37c4c90bee5fe967669f36` — `fix: harden weekly retro trend history`

## Exact fix-round verification commands and outputs

Regression and full package test command:

```text
npm --prefix reporting test
```

Output summary:

```text
ℹ tests 58
ℹ suites 0
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Syntax and whitespace checks:

```text
Get-ChildItem reporting -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
```

Output: no output; both commands exited `0`.

Implementation commit inspection:

```text
git show --stat --oneline e8b85d2
```

Output:

```text
e8b85d2 fix: harden weekly retro trend history
 reporting/src/history-adapter.mjs       | 19 +++++++--
 reporting/src/snapshot-store.mjs        | 36 +++++++++++++----
 reporting/src/trend-summary.mjs         | 30 +++++++++-----
 reporting/test/history-adapter.test.mjs | 71 +++++++++++++++++++++++++++++++++
 reporting/test/trend-summary.test.mjs   | 69 +++++++++++++++++++++++++++++---
 5 files changed, 198 insertions(+), 27 deletions(-)
```

## Fix-round concerns

- No remote, browser, scheduled-writer, production, or owner-approval evidence exists in this standalone local reporting checkout.
- Node `>=22.5.0` with `node:sqlite` remains required.
- The adapter still requires an explicitly supplied local source system and source ID.

## Fix round 2 — review regressions

Status: COMPLETE_WITH_CONCERNS

Addressed both review regressions:

1. `listSnapshots` now clamps every valid caller-provided limit to `MAX_LIST_RESULTS` (100) before SQL interpolation. Valid smaller limits remain supported. The snapshot-store regression test covers an oversized limit returning 100 rows and a bounded limit of 2 returning 2 rows.
2. `createHistoryAdapter` keeps the explicit `getLatestSnapshotWeek` capability as the optimized current-store path. The legacy `listSnapshots` fallback now requests a bounded 100-row fetch and selects the maximum returned ISO week client-side, so stores that ignore `order` or `limit` cannot silently treat `rows[0]` as latest. The compatibility regression test uses unsorted rows from a store that ignores both options and verifies `2026-W37` is selected.

Changed paths:

- `reporting/src/snapshot-store.mjs`
- `reporting/src/history-adapter.mjs`
- `reporting/test/snapshot-store.test.mjs`
- `reporting/test/history-adapter.test.mjs`

## Exact fix-round 2 verification commands and outputs

Full reporting package:

```text
npm --prefix reporting test
```

Output summary:

```text
ℹ tests 59
ℹ suites 0
ℹ pass 59
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

The passing suite includes:

```text
✔ legacy listSnapshots fallback selects the newest week when order and limit are ignored
✔ listSnapshots requires week bounds, filters category, and caps results
```

Syntax and whitespace checks:

```text
Get-ChildItem reporting -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
```

Output:

```text
test_exit=0 syntax_exit=0 diff_check_exit=0
```

Implementation commit inspection:

```text
git show --stat --oneline 32118ee
```

Output:

```text
32118ee fix: close task 4 review regressions
 reporting/src/history-adapter.mjs       | 13 +++++++++++--
 reporting/src/snapshot-store.mjs        |  3 ++-
 reporting/test/history-adapter.test.mjs | 25 +++++++++++++++++++++++++
 reporting/test/snapshot-store.test.mjs  | 13 +++++++++++++
 4 files changed, 51 insertions(+), 3 deletions(-)
```

Implementation commit:

`32118eeea73c4b7ca17fb2d6548deb308a17e375` — `fix: close task 4 review regressions`

The report is committed separately after the implementation hash and verification output were known.
