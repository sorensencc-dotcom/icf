# Toolforge Read-Only Input Execution Pilot

Date: 2026-10-09
Status: Draft for written-spec review
Classification: Operational design. No governance rules or validator policies change.

User approved pilot-first scope, read-only operation, explicit adapters, three pilot skills, and conversational execution design. This approval permits writing this spec; implementation remains a later stage.

## Intent and Success

Make three real skills usable from ICF through explicit inputs, correct function invocation, visible results, and equivalent copied commands. Toolforge owns contracts/adapters; ICF consumes them.

Success requires real-handler tests, shared input validation, dashboard/CLI semantic parity, clear findings versus runtime failure, bounded execution, and evidence that selected files remain unchanged. Do not infer readiness from a runtime label or source markers.

Exclude all other instruction-based skills, stub repair, automatic export/schema discovery, mutating skills, scheduled tasks, pipelines, external services, dependency downloads, saved inputs/results, batch orchestration, and canonical schema changes.

## Verified Baseline

- ICF source: src/toolforge-inventory.mjs, src/toolforge-skill-command.mjs, src/server.mjs, dashboard/index.html, and dashboard/preview-enhanced.html.
- Existing GET /api/toolforge/skills supplies checked inventory. Existing POST /api/actions/run dispatches allowlisted actions and rejects non-loopback callers.
- Existing run-skill accepts no structured input and returns DISPATCHED rather than a handler result. Preserve that legacy contract.
- Native Node v24.18.0 is installed. Local help exposes --permission, --allow-fs-read, and --experimental-strip-types. ICF currently declares >=22.5.0; that existing minimum is not proof of pilot compatibility.
- Agent Drift Detector documentation disagrees with its exported function. Runtime behavior is the pilot baseline; documentation must be reconciled without changing its algorithm.
- analyze-token-burn and doc-sync-drift-audit are excluded because their inspected implementations are stub/mock behavior.

Source observations are not production execution proof. Recheck installed modules/runtime before enabling the pilot.

## Pilot Contracts

| Skill ID | Installed relative entrypoint | Export and invocation |
| --- | --- | --- |
| roadmap-validator | skills/roadmap-validator/src/index.ts | default(input) |
| agent-drift-detector | skills/agent-drift-detector/src/index.ts | detectDrift(input) |
| retro-schema-validator | skills/retro-schema-validator/src/index.js | validateFiles(input.filePaths) |

All inputs are JSON objects. Reject unknown top-level fields, null/array substitutes for objects, malformed JSON, and implicit type coercion. Shared validation applies defaults and normalization identically for HTTP and CLI.

### Roadmap Validator

- roadmapPath: required nonempty absolute path to an existing readable .md regular file within configured workspace roots.
- strict: optional boolean, default false.
- verbose: optional boolean, default false.

Preserve native status, message, optional code, and optional data. Strict validation failures can omit data; UI must not fabricate missing findings. Existing sync-marker and markdown validation rules remain unchanged.

### Agent Drift Detector

- agentName: required nonempty string; trim surrounding whitespace.
- expectedSchema: required JSON object; empty object permitted.
- actualSchema: required JSON object; empty object permitted.

Preserve agentName, driftDetected, missingFields, extraFields, and recommendations. The function compares top-level field names, not nested types or JSON Schema. Values remain JSON data, never evaluated code.

Do not silently translate docs-only observedOutput, ignore strict, or fabricate docs-only output fields. Reconcile SKILL.md with the actual contract and freeze it with regression tests.

### Retro Schema Validator

- filePaths: required array of 1-32 distinct absolute paths to existing readable .json regular files within configured workspace roots.

Preserve selected order and native status, verdict, filesValidated, violations, and timestamp. No directory autodetection, --all expansion, or new interpretation of canonical schema v1.0. Existing CLI flags verbose/failOnWarning are not this adapter's input fields.

Before enabling this pilot, guard the real validator's document root: null, arrays, strings, numbers, and booleans produce a root-object schema violation through the existing result format, not a thrown TypeError. Preserve existing object-field rules and canonical schema v1.0. Malformed JSON retains its existing validation finding.

### Path and Size Rules

- Workspace roots come from trusted host configuration, never HTTP input. ICF defaults to its own ROOT. Additional roots require explicit host configuration. CLI supplies context through repeatable --workspace-root arguments.
- Resolve roots and files through realpath before platform containment checks. Reject traversal, escaping symlinks/junctions, directories, UNC/device paths, alternate data streams, and relative paths.
- Each selected file is limited to 1 MiB. Total serialized input/request is limited to 64 KiB of UTF-8 bytes. Check readability before invocation and repeat path checks immediately before handler reads.
- Inputs/results remain in process/browser memory. No presets, recent-input storage, receipts, or run-history persistence.

## Ownership and Components

Extend existing managed toolforge-cli skill; do not create an unregistered platform:

- skills/toolforge-cli/src/invocation-contracts.mjs: reviewed descriptors, three direct validation functions, export mappings, and outcome classification.
- skills/toolforge-cli/src/invoke-skill.mjs: shared API and CLI entrypoint.
- skills/toolforge-cli/src/invocation-worker.mjs: bounded child-process invocation.
- skills/toolforge-cli/tests/: adapter, worker, CLI parity, and read-only coverage.
- Existing toolforge-cli README/SKILL.md/docs/USAGE.md: invocation documentation; existing PowerShell CLI entrypoint remains unchanged.
- Existing agent-drift-detector SKILL.md: contract correction, with algorithm/API unchanged.
- Existing retro-schema-validator src/index.js and tests/: root-object guard and regression coverage; canonical schema remains unchanged.

ICF imports the managed API from configured Toolforge root. Missing/incompatible runner retains instructions behavior. Consumer logic remains in existing server/inventory, both dashboards, and focused tests.

Descriptors contain contract version 1, ID, reviewed relative entrypoint/export, read-only classification, form field metadata, and explicit validation/normalization functions. Use ordinary validators, not a new JSON Schema interpreter or dependency.

Requests cannot specify entrypoints/exports. Installed registry must resolve the pilot IDs. Descriptors pin reviewed SHA-256 fingerprints for each entrypoint and its complete local import closure, including runner files and package metadata affecting resolution. Built-in imports are explicitly allowlisted; dynamic imports and unreviewed dependencies are unavailable. Verify these fingerprints before every spawn and again in the worker before importing. Any source/import, entrypoint, export, or runtime mismatch disables the affected pilot until explicit review updates its descriptor; never regenerate trusted fingerprints at startup. Do not auto-select exports from source text. Fingerprints detect changed installed code, not concurrent hostile filesystem mutation.

## Runtime and Read-Only Boundary

Pilot requires Node major version 24. Other supported ICF Node versions retain existing behavior and report pilot unavailable. Use configured installed executable; no npx or automatic installation.

Use native TypeScript stripping for the two reviewed modules. Production-worker acceptance tests must import both real files under the deployed flags. An import failure disables execution rather than falling back to compilation/install.

Parent validates input and spawns one worker without a shell or detached mode. Send JSON through stdin; import only the mapped module/export. Environment is restricted to runtime necessities, excluding API keys, auth tokens, proxy settings, and NODE_OPTIONS.

Worker uses --permission and explicit --allow-fs-read entries for runner/module/package files and selected input files. No filesystem-write, child-process, worker-thread, native-addon, or WASI permission. Configured workspace roots authorize selection; they do not grant worker-wide directory reads.

Acceptance tests must verify permission behavior on Windows Node 24. Missing enforcement makes pilot unavailable. Permission controls supplement source review; they are not an OS sandbox. They must not be described as a network firewall. No network-dependent handlers are included; source/import review and negative network tests establish this pilot's no-network behavior.

Runner writes no temp files, compiled output, artifacts, snapshots, or receipts. Standard output/error pipes and in-memory capture are allowed. Read-only applies to pilot invocation, not all existing ICF subsystems.

Limits: 5-second wall-clock deadline from spawn, 128 KiB combined result/log output, and two concurrent pilot workers per server. Further requests return BUSY rather than queueing. Timeout, cancellation, or disconnect terminates the worker and releases resources. Retry requires explicit resubmission.

Known limit: realpath/read checks cannot eliminate every concurrent file-replacement race. Detected escapes fail closed; this pilot is not support for adversarial filesystem mutation or hostile native code.

## Shared API, Results, and Clipboard

Managed API takes skillId, input, and trusted context (workspace roots, Node executable, abort signal). Parent and worker validate fixed pilot contract versions. Both HTTP and CLI call this API.

CLI interface:

    node <toolforge-root>/skills/toolforge-cli/src/invoke-skill.mjs --skill <pilot-id> --workspace-root <absolute-root>

Read exactly one JSON object from stdin. Print one result envelope to stdout; capture handler diagnostics separately. Never accept arbitrary module/export arguments. Exit 0 for completed/pass, 1 for completed/findings, and 2 for rejected/unavailable/failed/timed_out/cancelled.

Envelope: contractVersion (1), skillId (or null for invalid target), state, outcome, result, error, durationMs. State is completed/rejected/unavailable/failed/timed_out/cancelled. Outcome is pass/findings only when completed; otherwise null. Result is unmodified native JSON only when completed. Error is null or stable code, safe message, and optional field errors. Duration is nonnegative, including zero for pre-execution rejection.

Roadmap SKILL_ERROR is execution failure; other returned validation errors/warnings are completed/findings. Agent driftDetected true means findings. Retro GREEN means pass; YELLOW/RED mean findings. Thrown handler, malformed result/protocol, unexpected stdout, abnormal exit, or missing export means execution failure, not successful validation.

Copied commands require PowerShell 7 or newer and reject Windows PowerShell 5.1 before invoking Node. Set $OutputEncoding to a BOM-less UTF-8 encoding for the JSON pipe and restore its prior value in finally, including on errors. Invoke the same CLI with the same normalized input and workspace roots. Pipe compact JSON from a single-quoted literal, doubling apostrophes; quote all executable/script/argument paths. Never interpolate raw input into executable shell text. Independently executed results must match semantic native fields/outcome/error codes; timestamps, durations, and diagnostic formatting need not be byte-identical. Document this shell requirement alongside Copy Command; do not silently substitute ASCII input.

## ICF HTTP Integration

GET /api/toolforge/skills adds optional inputInvocation metadata for the three pilots: contract version, fields, runtime availability, and unavailable reason. Preserve runnable's current standalone-CLI meaning. Input invocation is a separate capability, not inferred from source markers.

Add dedicated POST /api/toolforge/invoke with skillId and input object. Leave existing /api/actions/run parsing, actions, and response contracts unchanged. Route selection occurs before body parsing, so malformed pilot JSON still receives the pilot envelope. Example:

```json
{"skillId":"agent-drift-detector","input":{"agentName":"example-agent","expectedSchema":{"status":"string"},"actualSchema":{"status":"success"}}}
```

New route rejects unknown envelope fields, enforces UTF-8 byte cap, application/json Content-Type, and loopback remote address. Browser Origin must match configured same-origin dashboard URL; reject other origins/preflights. CLI uses managed API directly, not HTTP. Pre-parse failures use the same envelope with skillId null, result/outcome null, and stable error codes; malformed JSON is rejected/400.

Wait for bounded completion and return envelope, never DISPATCHED. Do not publish input/result to existing SSE/action-history storage.

HTTP codes: completed findings/pass 200; input/target rejection 400; origin/remote rejection 403; method rejection 405; oversized body 413; BUSY 429; missing runtime/runner 503; worker/protocol failure 500; timeout 504. Browser cancellation closes the request and displays cancelled; no response is required after disconnect.

## Dashboard Experience

Available pilots replace bare Run Skill with Configure. Use one compact accessible dialog with Inputs and Result views, on both dashboard surfaces:

- Roadmap: path input plus strict/verbose checkboxes.
- Agent: agent-name input and two labeled JSON textareas.
- Retro: editable explicit file-path list with add/remove controls and fixed maximum.
- Run submits to reviewed adapter. Cancel aborts active execution. Disable duplicate submission while running.
- Field errors preserve entered values. JSON errors identify the field; path errors do not expose unrelated contents.
- Run and Copy Command require valid input/runtime. Any edit invalidates previously prepared command.
- Distinguish Completed/Pass or Findings from Rejected/Unavailable/Failed/Timed Out/Cancelled. Show native structured result only when available.
- Render paths, strings, logs, and results as text, not injected HTML. Keep bounded diagnostics in memory.
- Provide accessible name, focus trap/restore, keyboard controls, visible focus, and mobile-safe wrapping.
- Closing idle dialog discards inputs/result; closing running dialog cancels. No localStorage/sessionStorage persistence.
- Retain instructions command when integration is unavailable. Other skills/CLI controls are unchanged.

Use existing Cast Iron Charlie styling and compact controls. No landing page, generic form framework, or visual redesign.

## Acceptance Contract

1. Exercise real Roadmap handler on valid, missing/reversed-marker, strict-warning, and verbose fixtures; preserve native optional-data behavior. Missing/unreadable/oversized paths reject before invocation.
2. Exercise real Agent handler on aligned/missing/extra keys, empty objects, wrong types, and unknown fields. Freeze actual documented contract; no invented nested-schema validation.
3. Exercise real Retro handler on valid/warning/error/malformed JSON fixtures and explicit ordered multiple files. Include null, array, string, number, and boolean roots; each valid non-object JSON root must return completed/findings with a root-object violation, not worker failure. Preserve canonical schema v1.0 and existing object-field behavior.
4. Import real TypeScript modules under production worker flags without downloading dependencies or creating build output. Verify missing runtime/export/contract-drift errors. Mutate an entrypoint, local imported module, runner, and resolution metadata without changing registry entrypoint/runtime; each must disable invocation before handler execution. Test parent/worker fingerprint checks and rejection of unreviewed imports.
5. Test timeout, cancellation/disconnect, output overflow, exceptions, malformed protocol, saturation, and resource recovery using controlled fixtures.
6. Compare file hashes and directory listings before/after real runs. Verify write/child/native-addon probes denied; reject traversal, symlink/junction escape, directory/UNC/device/ADS paths, and size violations.
7. Review all pilot import paths and test no network requests. Absence of file writes is not evidence of no external calls.
8. CLI/HTTP semantic parity covers pass, findings, and stable failures. Existing legacy dispatch responses remain unchanged.
9. HTTP tests cover dedicated pilot routing, content type/origin/loopback/method rules, byte limits, unknown fields/IDs, malformed bodies, concurrency, and absence of input/result persistence/SSE disclosure. Verify malformed pilot bodies return the pilot envelope while malformed legacy bodies retain their existing response shape.
10. BrowserOS Neo verifies both surfaces: forms, toggles/errors, exact clipboard payload, actual copied-command execution against fixtures, result/cancel states, focus/keyboard, desktop/mobile wrapping, and unavailable fallback.
11. Treat apostrophes, quotes, backslashes, dollar signs, backticks, and HTML as data. Execute copied commands under PowerShell 7 with non-ASCII names, keys, and file paths, plus non-default initial $OutputEncoding; verify exact input parity and encoding restoration on success/failure. Verify PowerShell 5.1 rejects without invoking Node. Copied commands preserve input and never execute injected commands.
12. Run managed runner/skill tests and full ICF npm test. Report focused/full-suite/live-browser/real-handler evidence separately.

Use disposable fixtures and isolated reporting storage. Never run production bots/tasks/pipelines or modify canonical inputs to obtain evidence.

## Delivery and Approval

Implement in verified isolated checkouts preserving current scoped command-audit fixes as baseline. Keep Toolforge-owned work separate from ICF consumer work. Preserve unrelated telemetry/generated changes. No push without user request.

Enable only tested descriptors. Rollback removes inputInvocation capability and restores instructions behavior. Do not restart unknown existing server owners; use separate loopback port and report stale live backends explicitly.

This is a written-spec review artifact, not an implementation plan or execution approval. After user approves this written spec, invoke writing-plans to produce a concrete plan. User then reviews plan and selects execution method before implementation, per explicitly invoked brainstorming workflow.

## Implementation and Delivery Status - 2026-10-10

Human-approved plan executed for all three fixed pilots. Native contracts, bounded workers, JSON CLI, HTTP route, shared forms, and clipboard parity passed acceptance. See [completed plan](../plans/2026-10-09-toolforge-read-only-pilot.md) and [acceptance evidence](../acceptance/2026-10-10-toolforge-read-only-pilot.md).

Approved implementation ruling narrows legacy-unchanged scope: configured Toolforge owner now controls run-skill script/cwd; four wiki command families restore caller location under kb-sync owner, with matching main copy-only controls. Legacy response shapes and other action families remain unchanged. Clipboard error/focus/label fixes do not expand runtime capabilities.

Human explicitly authorized push and PR creation on 2026-10-10. This authorizes remote branch/document delivery only, not merge, production activation, or canonical server restart. ICF PR targets existing fix/dashboard-docs-button-8001 baseline; matching Toolforge PR targets parkd821-20260908 to exclude unrelated history.
