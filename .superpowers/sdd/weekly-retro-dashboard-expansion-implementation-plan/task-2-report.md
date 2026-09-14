# Task 2 report — Add category registry and metric contract

## Status

DONE_WITH_CONCERNS

## Scope

Implementation repository: `C:\dev\icf`

Branch: `codex/weekly-retro-reporting`

Task 2 stayed within the standalone `reporting/` package. No agents were spawned. The current validated artifact remains `reporting/test/fixtures/valid-report.json`, and its existing report/API/dashboard compatibility tests remain unchanged and passing.

## Changed paths

- `reporting/src/category-contract.mjs`
- `reporting/src/weekly-retro-contract.mjs`
- `reporting/test/category-contract.test.mjs`

## Decisions

1. Added a versioned registry with `version: "1.0"` and exactly four ordered launch categories: `delivery`, `quality`, `reliability`, and `governance`.
2. Each category explicitly carries stable metadata, metric definitions, source paths, quality requirements, WoW support, rolling windows `[4, 8, 12]`, evidence/drill-down metadata, and distinct copy for `empty`, `partial`, `unavailable`, and `zero_activity` states.
3. Each metric explicitly declares `id`, label, unit, directionality (`higher_is_better`, `lower_is_better`, or `neutral`), calculation rule, source field, and value type.
4. `validateCategoryRegistry` rejects wrong versions, unknown registry fields, wrong category IDs/order, duplicate categories/metrics/source fields, missing metadata, unsupported directionality/value types, and metrics whose source fields are not declared by their category.
5. `normalizeMetric` validates category and metric identity, declared value type/range, source-field provenance when a source report is supplied, and state semantics. Zero is preserved as `zero_activity`; it is not conflated with `empty` or missing data. Partial metrics may be absent; empty/unavailable metrics must be absent or null; success/zero-activity metrics require values.
6. The existing `validateWeeklyRetroReport` entry point now validates the default registry and accepts an explicit `categoryRegistry` override for boundary testing, without adding fields to or changing the shape of the current report fixture.
7. Registry exports are re-exported from `weekly-retro-contract.mjs` so existing reporting consumers have one validated contract entry point.

## Tests added

`reporting/test/category-contract.test.mjs` covers:

- required category metadata and version/order;
- metric directionality and calculation/source declarations;
- missing metadata, directionality, and source-field rejection;
- duplicate, unknown, and incorrectly versioned registry rejection;
- measured metric normalization with unit, direction, and source provenance;
- distinct empty, partial, unavailable, success, and zero-activity semantics, including hyphenated zero-activity input;
- source mismatch, unknown metric, invalid value, and invalid state rejection;
- invalid-registry rejection through `validateWeeklyRetroReport` without changing report missing-field behavior;
- normalization of every registered metric against the current validated report fixture.

## Exact verification commands and outputs

### Failing-first test

Command:

```text
npm --prefix reporting test -- --test-name-pattern='registry|metric|state|source'
```

Initial output was the expected red state: `ERR_MODULE_NOT_FOUND` for `reporting/src/category-contract.mjs`, with the 14 pre-existing tests passing and the new test file failing at module resolution.

### Focused/full reporting tests

Command:

```text
npm --prefix reporting test
```

Output:

```text
✔ launch registry is versioned and carries required category metadata
✔ every metric declares supported directionality and a source field
✔ rejects missing metadata, directionality, and source-field requirements
✔ rejects duplicate, unknown, and incorrectly versioned registry entries
✔ normalizes a measured metric with direction, unit, and source provenance
✔ normalizes empty, partial, unavailable, and zero-activity states distinctly
✔ rejects source mismatches, unknown metrics, invalid values, and invalid states
✔ validated report entry point rejects an invalid category registry without changing report shape
✔ normalizes every launch metric from the current validated report fixture
✔ imports as a browser-valid custom element and renders fetched data
✔ runs connected lifecycle and renders endpoint, transport, and payload errors
✔ GET /api/reporting/weekly-retro preserves current success response
✔ GET /api/reporting/weekly-retro routes committed malformed fixture to UNAVAILABLE
✔ GET /api/reporting/weekly-retro routes committed unavailable fixture for missing artifact
✔ freezes current report field shape and deterministic source values
✔ accepts partial report fixture only through explicit partial mode
✔ preserves empty category state and launch category ordering
✔ preserves non-empty category record ordering
✔ freezes SUCCESS and UNAVAILABLE API response shapes
✔ rejects missing, unknown, and incorrectly typed metrics
✔ preserves and validates optional canonical provenance fields when present
✔ rejects malformed report JSON without weakening boundary validation
✔ manifest fixes week keys, category IDs, and record order for downstream tasks
ℹ tests 23
ℹ pass 23
ℹ fail 0
```

Exit code: `0`.

### Syntax and whitespace

Commands:

```text
Get-ChildItem reporting -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
git diff --cached --check
```

Output: no output; all commands exited `0` before commit.

## Commit

`7ddf0c2a5bb6e737f2af25f1439f10ab41bb65e1` — `feat: add weekly retro category contract`

## Concerns

- `C:\dev\icf` is a standalone implementation checkout. The parent report generator and application are not present, so no parent integration, scheduled generation, browser-engine run, live service probe, remote verification, or production approval is claimed.
- The repository-level `AGENTS.md`, `CLAUDE.md`, governance documents, and `memory/` paths named in the supplied governance instructions were absent from this checkout; available Task 1/project artifacts and the supplied expansion spec were used instead.
- Category definitions intentionally reference fields proven by the current validated report. Task 3+ consumers must preserve registry IDs/source paths and must not infer new categories or source schemas outside this contract.
- The package has no separate lint/build/full-parent-suite command; `npm --prefix reporting test`, Node syntax checks, and diff checks are the available local evidence.

## Fix round 1 — review findings addressed

### Status

DONE_WITH_CONCERNS

### Findings and fixes

1. Runtime report validation now calls `normalizeCategoryMetrics` after registry validation. Strict reports must provide every registered source field with the declared value type; explicit partial mode permits missing registered fields and marks them partial. The malformed nested `test_health.total_test_files` path is rejected before a successful response can be emitted. `server.mjs` now serializes before writing the `200` headers, so injected reader failures remain bounded `503 UNAVAILABLE` responses.
2. `normalizeMetric` now validates `null` for non-nullable value types instead of skipping validation. Null remains permitted only for nullable metric types or explicit empty/partial/unavailable states.
3. Evidence is contract-validated: exact evidence keys, boolean `drilldown`, non-empty string `source_fields`, unique fields, and linkage to category required source fields.
4. Rolling windows are constrained to the exact ordered unique list `[4, 8, 12]`.
5. When source data is supplied, normalized metric values must equal their registered source-field values using `Object.is`; mismatches fail with contextual errors.
6. Duplicate tests now mutate an existing category ID, add a real duplicate metric ID, duplicate a required source field, and duplicate a metric source field. Registry validation rejects all four cases.
7. Duplicate metric source fields are now rejected in addition to duplicate required source-field entries.
8. State tests cover every launch category, including state-copy presence and empty/partial/unavailable/zero-activity normalization for each category's first registered metric.

### Fix-round changed paths

- `reporting/src/category-contract.mjs`
- `reporting/src/server.mjs`
- `reporting/src/weekly-retro-contract.mjs`
- `reporting/test/category-contract.test.mjs`
- `reporting/test/server.test.mjs`

### Exact failing-first evidence

Command:

```text
npm --prefix reporting test -- --test-name-pattern='category|metric|registry|state|source|report entry'
```

Output before fixes:

```text
ℹ tests 27
ℹ pass 22
ℹ fail 5
```

The five expected red failures covered duplicate metric source fields, null non-nullable metrics, empty evidence, invalid rolling windows, and malformed nested report source validation.

The initial HTTP covering test also exposed this exact runtime error before the serialization-order correction:

```text
Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent to the client
```

### Exact focused/full verification

Command:

```text
npm --prefix reporting test
```

Output:

```text
✔ launch registry is versioned and carries required category metadata
✔ every metric declares supported directionality and a source field
✔ rejects missing metadata, directionality, and source-field requirements
✔ rejects duplicate, unknown, and incorrectly versioned registry entries
✔ normalizes a measured metric with direction, unit, and source provenance
✔ normalizes empty, partial, unavailable, and zero-activity states distinctly
✔ rejects source mismatches, unknown metrics, invalid values, and invalid states
✔ validates evidence drill-down shape, uniqueness, and source linkage
✔ requires exact ordered unique rolling windows
✔ validated report entry point rejects an invalid category registry without changing report shape
✔ validated report entry point rejects malformed nested registry source values
✔ applies state semantics and copy across all launch categories
✔ normalizes every launch metric from the current validated report fixture
✔ imports as a browser-valid custom element and renders fetched data
✔ runs connected lifecycle and renders endpoint, transport, and payload errors
✔ GET /api/reporting/weekly-retro preserves current success response
✔ GET /api/reporting/weekly-retro routes committed malformed fixture to UNAVAILABLE
✔ GET /api/reporting/weekly-retro routes committed unavailable fixture for missing artifact
✔ GET /api/reporting/weekly-retro rejects malformed nested category source data
✔ freezes current report field shape and deterministic source values
✔ accepts partial report fixture only through explicit partial mode
✔ preserves empty category state and launch category ordering
✔ preserves non-empty category record ordering
✔ freezes SUCCESS and UNAVAILABLE API response shapes
✔ rejects missing, unknown, and incorrectly typed metrics
✔ preserves and validates optional canonical provenance fields when present
✔ rejects malformed report JSON without weakening boundary validation
✔ manifest fixes week keys, category IDs, and record order for downstream tasks
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

Exit code: `0`.

Commands:

```text
Get-ChildItem reporting -Recurse -File -Include *.mjs | ForEach-Object { node --check $_.FullName }
git diff --check
```

Output: no output; both commands exited `0`.

### Fix-round implementation commit

`6ccf681a574960e498a1b8976633c2f30ce947e3` — `fix: close weekly retro category contract findings`

### Fix-round concerns

- Validation is now enforced through the standalone server's existing `readWeeklyRetro`/serialization path, but the parent report generator remains outside this checkout and was not executed.
- Local evidence remains focused/full package evidence only; no real browser engine, live service, remote, or production evidence is claimed.
