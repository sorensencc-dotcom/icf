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
