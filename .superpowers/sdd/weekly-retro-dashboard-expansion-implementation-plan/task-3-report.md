# Task 3 report — Add SQLite snapshot persistence

## Status

DONE_WITH_CONCERNS

## Scope

Implementation repository: `C:\dev\icf`

Branch: `codex/weekly-retro-reporting`

Task 3 stayed within the standalone `reporting/` package. No agents were spawned. The store uses the repository runtime's built-in `node:sqlite`; no external package or cloud/remote persistence was added.

## Changed paths

Implementation commit:

- `reporting/schema/001_snapshot_store.sql`
- `reporting/src/snapshot-store.mjs`
- `reporting/src/server.mjs`
- `reporting/test/snapshot-store.test.mjs`

Documentation commit:

- `.superpowers/sdd/weekly-retro-dashboard-expansion-implementation-plan/task-3-report.md`

## Decisions

1. Added a version-1 SQLite migration with separate `snapshot_envelopes`, `snapshot_summary_state`, and `snapshot_redactions` tables. Raw envelope JSON never shares a column with derived summary data; the summary table currently stores freshness state only for Task 4 consumers.
2. Defined the composite identity as `sourceId + weekKey + categoryId`. Input aliases for snake_case/source-identity names are accepted at the boundary, while records return the canonical camelCase shape. Week keys are constrained to `YYYY-W01` through `YYYY-W53`; category IDs are constrained to the Task 2 launch registry.
3. `upsertSnapshot` validates JSON-serializable envelopes, rejects an embedded envelope identity that disagrees with the composite key, and runs insert/update plus summary-state changes inside `BEGIN IMMEDIATE`/`COMMIT`. An unchanged envelope/schema version returns the existing record unchanged, including timestamps and freshness state.
4. Changed snapshots mark summary state stale with `snapshot_changed`. A redacted snapshot cannot be restored by a later upsert; this prevents raw sensitive content from being reintroduced under an existing tombstone.
5. `redactSnapshot` nulls the raw envelope, writes an immutable tombstone with the first reason/timestamp, and marks summary state stale with `snapshot_redacted`. Redaction of an unknown identity creates a tombstone row and blocks later ingestion for that identity.
6. `listSnapshots` requires both week bounds, supports an optional category filter, orders deterministically, and applies a fixed 100-row limit. Redacted records remain listable as safe tombstone projections.
7. Added `publishWeeklyRetroSnapshot` and optional `snapshotStore`/`snapshotIdentity` wiring at the reporting server boundary. Existing server behavior remains read-only when no store is configured; publication is explicit and local when a store is supplied.

## Tests added

`reporting/test/snapshot-store.test.mjs` covers:

- migration table presence;
- distinct source/week/category composite identities;
- persistence after closing and reopening a SQLite file;
- embedded identity collision rejection;
- atomic upsert behavior and repeat-identical idempotency;
- bounded week/category queries and the 100-record cap;
- raw-content removal, tombstone persistence, stale-summary signaling, and redaction blocking;
- explicit publication and optional server publication wiring.

## Exact verification commands and outputs

Failing-first command:

```text
npm --prefix reporting test -- --test-name-pattern='snapshot|redaction|publication'
```

Initial output before implementation:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\dev\icf\reporting\src\snapshot-store.mjs'
ℹ tests 32
ℹ pass 31
ℹ fail 1
```

Focused command after implementation:

```text
npm --prefix reporting test -- --test-name-pattern='snapshot|redaction|publication'
```

Output:

```text
ℹ tests 40
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Full reporting package command:

```text
npm --prefix reporting test
```

Output:

```text
ℹ tests 40
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Syntax command:

```text
Get-ChildItem reporting -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
```

Output: no output; exit code `0`.

Whitespace commands:

```text
git diff --check
git diff --cached --check
```

Output: no output; exit code `0`.

Runtime observed during tests: Node `v24.18.0`, with built-in SQLite `3.53.1` exposed through `node:sqlite`.

## Commits

`d351533` — `feat: persist weekly retro snapshots locally`

The report was committed separately after the implementation hash was known.

## Concerns

- The standalone checkout has no parent report generator, application shell, live service, remote persistence, or production environment. No integration, live, remote, or production approval is claimed.
- `node:sqlite` is runtime-provided and was verified on Node 24.18.0; environments without that API need a repository-approved runtime update or dependency decision before execution.
- No derived summary calculation exists in Task 3. Consumers must treat `summaryStale: true` as requiring rebuild; this task only persists the signal.
- The fixed 100-row list bound is intentionally safe but has no pagination interface yet; later history consumers must use narrower windows or add an approved pagination contract.
- The repository-level `AGENTS.md`, `CLAUDE.md`, governance documents, and `memory/` paths named in supplied governance instructions were absent from this checkout. The supplied task brief, existing Task 1/Task 2 artifacts, and `progress.md` were used instead.
