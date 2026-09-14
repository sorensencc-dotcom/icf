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

## Fix round 1 — close snapshot persistence review findings

### Status

DONE_WITH_CONCERNS

### Findings and fixes

1. Snapshot identity is now `sourceSystem + sourceId + weekKey + categoryId`. `sourceSystem` accepts the canonical and snake_case boundary aliases, is checked against embedded envelope identity, participates in the raw and summary primary/foreign keys, and is present in every join, lookup, redaction lookup, filter result, and deterministic ordering clause. Same source IDs from different systems remain distinct.
2. Redaction stores a sanitized `redactedAggregate` projection in the standalone tombstone. Known numeric report aggregates and explicitly declared aggregate counts/summaries survive; raw envelope JSON is nulled; derived summary state is stale with `snapshot_redacted`. Sensitive arbitrary fields are not copied into the projection.
3. `onBeforeCommit` is a narrow transaction fault-injection seam. The rollback regression test throws after upsert mutations and before `COMMIT`, then proves the prior record remains unchanged and no partial record appears.
4. `reporting/package.json` declares Node `>=22.5.0`; the store uses a contextual dynamic-import guard for missing `node:sqlite`/`DatabaseSync` support.
5. Tombstones have no foreign key to deletable raw rows, carry their aggregate projection, and are queried from a union of raw and tombstone identities. A raw-row deletion test proves the tombstone and aggregate remain readable.
6. Envelope JSON is recursively canonicalized before persistence/comparison, so equivalent property order is idempotent without timestamp changes.
7. Serialization failures and non-object `toJSON` results become contextual `envelope.toJSON output validation failed` errors.

### Fix-round changed paths

- `reporting/package.json`
- `reporting/schema/001_snapshot_store.sql`
- `reporting/src/snapshot-store.mjs`
- `reporting/test/snapshot-store.test.mjs`
- `.superpowers/sdd/weekly-retro-dashboard-expansion-implementation-plan/task-3-report.md`

### Exact focused verification

Command:

```text
npm --prefix reporting test -- --test-name-pattern='snapshot|redaction|publication|runtime|JSON'
```

Output:

```text
ℹ tests 45
ℹ pass 45
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### Exact full verification

Command:

```text
npm --prefix reporting test
```

Output:

```text
ℹ tests 45
ℹ pass 45
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

The 45 passing tests include the existing Task 1/2 contract and server tests plus source-system collision/separation and ordering, runtime declaration, canonical JSON idempotency, post-write rollback, aggregate-preserving redaction, durable tombstones after raw deletion, contextual `toJSON` validation, bounded queries, and publication coverage.

### Exact syntax, whitespace, and runtime evidence

Commands:

```text
Get-ChildItem reporting -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
node --version
node -p "process.versions.sqlite"
```

Output:

```text
node v24.18.0
3.53.1
```

Syntax and whitespace commands produced no output and exited `0`. Runtime is above the declared minimum and exposes `node:sqlite`.

### Fix-round implementation commit

`0a55ba1` — `fix: harden weekly retro snapshot persistence`

### Fix-round concerns

- The parent report generator/application server wiring remains outside this standalone checkout. The explicit local `createReportingServer` publication option is covered, but no parent integration, live service, remote, or production evidence is claimed.
- Task 4 summary calculation/rebuild remains future work. Redaction preserves only the safe aggregate projection and marks derived summary state stale; it does not rebuild summaries.
- The fixed 100-row list bound remains intentionally unpaginated; later history consumers need narrower windows or an approved pagination contract.

## Fix round 2 — migrate pre-fix SQLite databases

### Status

DONE_WITH_CONCERNS

### Finding addressed

Existing databases created by the original version-1 schema were not readable after fix round 1: `001_snapshot_store.sql` had been edited in place to add `source_system` and `aggregate_json`, while `CREATE TABLE IF NOT EXISTS` left existing tables unchanged. Reopening those files then failed on missing columns.

### Fix

- Added `reporting/schema/002_snapshot_store_source_system.sql`, a transactional table-rebuild migration for the pre-fix three-part schema. It preserves raw envelope rows, summary state, redaction reasons, and redaction timestamps; legacy rows receive the stable `sourceSystem: 'legacy'` sentinel. Pre-fix tombstones receive `redactedAggregate: null` because that schema did not retain an aggregate projection.
- Changed store initialization to inspect the physical schema before executing the current fresh-store schema. Existing version-1 legacy tables run migration 002; current round-1 tables receive the version-2 migration record without a rebuild. `PRAGMA user_version` is set to `2` in both paths.
- Added regression coverage that creates a real pre-fix database with raw and tombstone data, reopens it through the current store, verifies source-system projection, raw/tombstone readability, aggregate projection behavior after migration, version metadata, and a second idempotent reopen.

### Changed paths

- `reporting/schema/002_snapshot_store_source_system.sql`
- `reporting/src/snapshot-store.mjs`
- `reporting/test/snapshot-store.test.mjs`
- `.superpowers/sdd/weekly-retro-dashboard-expansion-implementation-plan/task-3-report.md`

### Exact verification commands and outputs

Focused migration and persistence tests:

```text
npm --prefix reporting test -- --test-name-pattern='migration|snapshot|redaction|publication|runtime|JSON'
```

Output:

```text
ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1023.0116
```

Full reporting package:

```text
npm --prefix reporting test
```

Output:

```text
ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1131.9758
```

Syntax and whitespace checks:

```text
Get-ChildItem reporting -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
```

Output: no output; exit code `0`.

### Fix-round 2 commit

Committed together with the implementation and regression tests as `fix: migrate legacy weekly retro snapshot databases`.

### Fix-round 2 concerns

- Pre-fix redaction rows never stored aggregate data, so migration cannot reconstruct an aggregate after raw content was already nulled; it preserves the tombstone with a null projection and preserves aggregate projection behavior for post-migration redactions.
- No live, remote, production, or parent report-generator integration evidence is claimed.
