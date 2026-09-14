# Task 1 report — Lock current contracts and fixtures

## Status

DONE_WITH_CONCERNS

## Scope and repository evidence

Implementation repository: `C:\dev\icf`

Branch: `codex/weekly-retro-reporting`

The repository was intentionally standalone and contained no source files or test runner before this task. Preflight located the existing parent contracts as read-only references:

- `C:\dev\scripts\run-weekly-retro.ps1`
- `C:\dev\kb-sync\server.mjs`
- `C:\dev\kb-sync\modules\wiki\weekly-reporting-dashboard.mjs`
- Current local artifact: `C:\dev\.icf-retros\weekly\latest-weekly-retro.json`

No parent-repository files were modified. The implementation adapts the observed contracts under `reporting/` without creating an external integration path.

## Changed paths

- `reporting/package.json`
- `reporting/src/server.mjs`
- `reporting/src/weekly-retro-contract.mjs`
- `reporting/weekly-reporting-dashboard.mjs`
- `reporting/test/dashboard-entrypoint.test.mjs`
- `reporting/test/server.test.mjs`
- `reporting/test/weekly-retro-contract.test.mjs`
- `reporting/test/fixtures/valid-report.json`
- `reporting/test/fixtures/partial-report.json`
- `reporting/test/fixtures/empty-category.json`
- `reporting/test/fixtures/malformed-report.json`
- `reporting/test/fixtures/routing-failure.json`
- `reporting/test/fixtures/manifest.json`

## Frozen contracts

- Report shape preserves the observed top-level field order and metrics field order from the current local artifact.
- API route is `/api/reporting/weekly-retro`.
- Success response is `{ "status": "SUCCESS", "data": <report> }`.
- Unavailable response is `{ "status": "UNAVAILABLE", "error": <message> }` with HTTP 503 from the standalone server.
- Dashboard element is `weekly-reporting-dashboard`; it reads `src`, sends `GET` with `Accept: application/json`, and retains existing missing-endpoint and transport-error copy.
- Launch category IDs are fixed, in order: `delivery`, `quality`, `reliability`, `governance`.
- Fixture week keys are fixed to `2026-W36` and `2026-W37`; category record order is the launch category order above.
- Partial reports require explicit `allowPartial: true`; malformed JSON and unavailable routing remain failures.
- Standalone server defaults to the checked-in valid fixture and binds only to loopback when started. No cloud routing or remote persistence was added.

## Design decisions

1. Created a small Node ESM package under `reporting/` because the approved parent application is absent from `C:\dev\icf`.
2. Kept report validation and API serialization in one contract module so Task 2 can consume stable constants and failure semantics.
3. Used a manifest to make fixture IDs, fixed week keys, category IDs, and ordering explicit rather than relying on filesystem or object-discovery order.
4. Kept the dashboard adapter importable in Node tests by exporting request/error semantics and guarding custom-element registration when DOM globals are absent.
5. Used dependency injection for report reading in server tests, with temporary local malformed input only; no live service or parent checkout is required.

## Fixtures

- `valid-report.json`: current observed report values, including explicit field ordering.
- `partial-report.json`: minimum report data with omitted optional sections; accepted only in explicit partial mode.
- `empty-category.json`: fixed `2026-W36` empty `quality` category with an explicit empty record list.
- `malformed-report.json`: intentionally truncated JSON.
- `routing-failure.json`: frozen `UNAVAILABLE` API response shape with a local missing-artifact path.
- `manifest.json`: fixture schema version, week keys, launch category IDs, record order, and case order.

## Exact verification commands and outputs

### Focused package tests

Command:

```text
cd C:\dev\icf\reporting
npm test
```

Output:

```text
> test
> node --test test/*.test.mjs

✔ freezes dashboard entrypoint and request semantics
✔ dashboard reports missing endpoint and transport failures with current copy
✔ GET /api/reporting/weekly-retro preserves current success response
✔ GET /api/reporting/weekly-retro returns bounded unavailable shape for malformed input
✔ freezes current report field shape and deterministic source values
✔ accepts partial report fixture only through explicit partial mode
✔ preserves empty category state and launch category ordering
✔ freezes SUCCESS and UNAVAILABLE API response shapes
✔ rejects malformed report JSON without weakening boundary validation
✔ manifest fixes week keys, category IDs, and record order for downstream tasks
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Exit code: `0`.

### Syntax and whitespace checks

Command:

```text
cd C:\dev\icf
Get-ChildItem reporting -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
git diff --cached --check
```

Output: no output; all commands exited `0`.

### Baseline/full/live evidence

The implementation checkout had no pre-existing report, API, dashboard, package, or test files, so there was no existing focused baseline command to run. No full parent-application suite, browser run, live service probe, remote verification, or production approval was claimed; those are outside this standalone Task 1 scope.

## Commit hash

Implementation commit:

`da4853bb139ab4f0d49056891633ffed75aabe90`

Message: `test: freeze weekly retro contracts`

## Concerns

- The parent report generator and dashboard live in another checkout and were not changed or executed as part of this isolated repository task.
- The current report contract is intentionally frozen and strict; future category fields or schema evolution should be introduced by the approved Task 2 compatibility work, not appended silently here.
- The standalone server serves the checked-in fixture by default. It is a contract-test boundary, not evidence of scheduled generation, browser readiness, remote delivery, or production operation.
