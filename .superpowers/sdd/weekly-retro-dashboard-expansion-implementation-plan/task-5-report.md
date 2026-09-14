# Task 5 report — Add action-item continuity

## Status

DONE_WITH_CONCERNS

## Scope

Implementation repository: `C:\dev\icf`

Branch: `codex/weekly-retro-reporting`

No agents were spawned. Implementation remains local-only and uses the existing SQLite boundary.

## Changed paths

- `reporting/src/action-continuity.mjs`
- `reporting/src/snapshot-store.mjs`
- `reporting/src/snapshot-envelope.mjs`
- `reporting/src/weekly-retro-contract.mjs`
- `reporting/schema/004_action_continuity.sql`
- `reporting/test/action-continuity.test.mjs`
- `reporting/test/snapshot-store.test.mjs`

## Implementation

- Added `upsertAction`, `listActions`, `carryForwardActions`, and `getAction` to the local snapshot store, plus `createActionContinuity` facade.
- Action identity is the composite `(source_system, source_id, week_key, category_id)`. Source IDs are never fabricated.
- Duplicate canonical ingestion is idempotent. Owner, wording, display label, status, theme, and provenance changes update current values while appending prior/current versions to history.
- Supported lifecycle statuses are `open`, `in_progress`, `carried_over`, `completed`, and `abandoned`; only active prior-week actions carry forward.
- Carry-forward creates one target-week record per identity, preserves source history, records `carriedFromWeek`, and is safe to repeat.
- Returned records expose current wording/label plus `history`/`wordingHistory`, provenance links, and recurring-theme projections.
- Report/snapshot normalization accepts optional top-level or category action lists and persists normalized actions in the same transaction as snapshot ingestion.
- Added schema migration 004 and preserved migration order 1, 2, 3, 4.
- Action reads require an exact week or explicit week range and cap results at 100; recurring-theme history scans cap at 1,000 rows.

## Exact verification commands and outputs

Focused action integration tests:

```text
node --test test/action-continuity.test.mjs
```

```text
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Full reporting package:

```text
npm test
```

```text
ℹ tests 66
ℹ pass 66
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Syntax and whitespace checks:

```text
Get-ChildItem . -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
```

Output: no output; both commands exited `0`.

## Commit

`0a9db2cbfc02f0de41aa996a9d93a8489a27d517` — `feat: preserve weekly retro action continuity`

The implementation commit contains only the seven changed implementation/schema/test paths above. This report is committed separately after verification.

## Concerns

- Checkout is a standalone reporting repository. No parent report generator, scheduled writer, action HTTP endpoint, live service, remote integration, or production approval exists here or is claimed; later API work must wire the facade explicitly.
- Runtime requires Node `>=22.5.0` with built-in `node:sqlite`; verification used Node `v24.18.0`.
- Action ingestion requires a stable source ID and non-empty wording. Missing identity is rejected rather than assigned a guessed ID.
- The bounded list cap is 100 records and recurring-theme scan cap is 1,000 rows. Larger history/reporting views need an explicitly versioned pagination contract.
- The root-level `AGENTS.md` and governance/memory paths named in the supplied instructions were not present in this standalone checkout; the task brief and existing repository contracts were used as the governing local sources.

## Task 5 fix round 1 — review findings addressed

Status: COMPLETE_WITH_CONCERNS

Implementation commit: `2f64c32` — `fix: close task 5 action continuity review findings`

No agents were spawned. Changes remain local on `codex/weekly-retro-reporting`.

Findings closed:

- Action IDs are explicit and required; facade defaults no longer inject a snapshot `sourceId`, so missing IDs cannot collapse actions.
- `unresolved` is present in runtime normalization, SQLite constraints, active carry-forward selection, and regression coverage.
- Actions persist an `originatingSnapshot`; redaction scrubs linked wording, label, owner, status, themes, history, carry source, and provenance, and filters sensitive aggregate summary keys.
- Carry-forward reads active source rows inside `BEGIN IMMEDIATE`; target completed/abandoned rows are skipped.
- Carry-forward rejects same/future source weeks. ISO week validation rejects impossible week 53 values and invalid report calendar dates.
- Report/API validation normalizes action IDs, wording, status, category, provenance, safe URL/path values, and originating-evidence linkage without requiring a configured store.
- Schema migration v5 rebuilds the action table to add unresolved support, originating snapshot columns, and redaction state while preserving v3/v4 data; write/redaction rollback coverage is included.

Changed paths in this fix round:

- `reporting/src/action-continuity.mjs`
- `reporting/src/snapshot-envelope.mjs`
- `reporting/src/snapshot-store.mjs`
- `reporting/src/weekly-retro-contract.mjs`
- `reporting/schema/004_action_continuity.sql`
- `reporting/schema/005_action_redaction.sql`
- `reporting/test/action-continuity.test.mjs`
- `reporting/test/snapshot-store.test.mjs`

## Exact verification commands and outputs — fix round 1

Focused action continuity regression suite:

```text
node --test test/action-continuity.test.mjs
```

```text
ℹ tests 15
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Full reporting package:

```text
npm test
```

```text
ℹ tests 74
ℹ pass 74
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Syntax and whitespace checks:

```text
Get-ChildItem . -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
```

Output: no output; both commands exited `0`.

Concerns remain unchanged: this checkout is a standalone local reporting repository with no parent report generator, scheduled writer, action HTTP endpoint, remote integration, or production approval. Node `v24.18.0` with built-in `node:sqlite` was used for verification. No push was requested or performed.

Final post-commit verification:

```text
node --test test/action-continuity.test.mjs
```

```text
ℹ tests 15
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

```text
git diff --check
Get-ChildItem . -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
```

Output: no output; both commands exited `0`.

Follow-up commit: `548a1f2` — `fix: tighten action provenance boundary`.
