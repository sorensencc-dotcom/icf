# Toolforge Read-Only Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute three read-only skills with explicit inputs, honest results, and equivalent clipboard commands on both ICF dashboards.

**Architecture:** Toolforge owns reviewed contracts, native-handler adapters, a bounded Node worker, and JSON-stdin CLI. ICF consumes this API through a separate route and optional inventory capability; legacy dispatch stays unchanged. Enable descriptors only after real-worker acceptance passes.

**Tech Stack:** Windows, Node 24, native TypeScript stripping, standard Node APIs, node:test, PowerShell 7, existing HTML/CSS/JavaScript, BrowserOS Neo. No new dependencies.

**Spec:** C:\dev\icf\docs\superpowers\specs\2026-10-09-toolforge-read-only-pilot-design.md (written spec approved in human transcript on 2026-10-09).

## Global Constraints

- Pilot requires Node major version 24.
- File selection: existing readable regular .md/.json files; absolute, realpath-contained within trusted workspace roots.
- Each selected file is limited to 1 MiB. Total serialized input/request is limited to 64 KiB of UTF-8 bytes.
- Retro filePaths: 1-32 distinct files, selected order preserved.
- Limits: 5-second wall-clock deadline from spawn, 128 KiB combined result/log output, and two concurrent pilot workers per server.
- Worker: no shell, detached mode, writes, subprocesses, worker threads, native addons, or WASI. Restrict environment and explicit file reads.
- Copied commands require PowerShell 7 or newer and reject Windows PowerShell 5.1 before invoking Node.
- Inputs/results remain in process/browser memory. No presets, recent-input storage, receipts, or run-history persistence.
- Preserve legacy /api/actions/run responses and runnable's standalone-CLI meaning.
- No npx, downloads, schema-policy changes, generic plugin discovery, production bots/tasks, or push without user request.
- Read-only permissions are not an OS sandbox or network firewall; hostile concurrent filesystem replacement remains outside support.

## Review Focus

- Windows case variants and duplicate realpath aliases: reject duplicate Retro selections; accept legitimate contained paths without case-sensitive false negatives (Task 1).
- UTF-8 byte boundaries and split multibyte chunks: 65,536 bytes accepted, 65,537 rejected without replacement-character corruption (Tasks 3-4).
- Already-aborted request and simultaneous timeout/disconnect: one terminal result, no leaked worker or occupied slot (Tasks 2, 4).
- Late result after input edit/dialog close: discard stale results and commands; never repopulate cleared inputs (Task 5).
- Source update preserving registry labels: disable pilot before changed code executes, including imported files/package resolution changes (Tasks 1-2).

## Scope and File Map

Toolforge repository: C:\dev (origin sorensencc-dotcom/toolforge). ICF repository: C:\dev\icf (origin sorensencc-dotcom/icf). Paths below are absolute; execute commands in owning isolated checkout, replacing these canonical prefixes with verified checkout roots.

Toolforge:
- Create skills/toolforge-cli/src/invocation-contracts.mjs: fixed descriptors, validation, availability, native result classification.
- Create skills/toolforge-cli/src/invocation-reviewed.json: reviewed source hashes and static import allowlists; no executable code.
- Create skills/toolforge-cli/src/invoke-skill.mjs: shared API, supervised workers, stdin CLI, clipboard command formatter.
- Create skills/toolforge-cli/src/invocation-worker.mjs: independent verification and native invocation.
- Create skills/toolforge-cli/tests/invocation-contracts.test.mjs, invocation-worker.test.mjs, invocation-cli.test.mjs.
- Modify skills/retro-schema-validator/src/index.js and tests/index.test.js; add root-type regressions.
- Modify skills/agent-drift-detector/SKILL.md; correct actualSchema/native output contract.
- Modify skills/toolforge-cli/README.md and SKILL.md; create docs/USAGE.md if absent. Leave src/cli.ps1 and skill registry permissions unchanged.

ICF:
- Modify src/server.mjs: managed API loading, trusted context, dedicated invocation route, inventory enrichment.
- Modify src/toolforge-inventory.mjs only if capability attachment requires it; preserve existing checks.
- Modify dashboard/index.html and dashboard/preview-enhanced.html: pilot Configure actions and dialog mounting.
- Create dashboard/toolforge-invocation.mjs: shared three-form dialog behavior and command formatting consumer.
- Create test/toolforge-invocation.test.mjs and test/toolforge-invocation-ui.test.mjs.
- Extend test/toolforge-inventory.test.mjs and test/toolforge-skill-command.test.mjs only for affected existing contracts.

No package/lockfile changes expected. No dashboard redesign, unrelated telemetry, or generated metadata changes.

## Task 1: Contracts, Reviewed Sources, and Real Validator Repair

**Files:** C:\dev\skills\toolforge-cli\src\invocation-contracts.mjs; src\invocation-reviewed.json; tests\invocation-contracts.test.mjs; C:\dev\skills\retro-schema-validator\src\index.js; tests\index.test.js; C:\dev\skills\agent-drift-detector\SKILL.md.

**Interfaces:**
- Produces validateInvocationInput(skillId, input, context) -> Promise<{input, readFiles}>; throws coded input errors with safe fieldErrors.
- Context: {toolforgeRoot, manifestPath, workspaceRoots, nodeExecutable, signal}; all configuration trusted and never taken from HTTP input.
- Produces inspectInvocation(skillId, context) -> Promise<{contractVersion:1, fields, available, reason}>.
- Produces classifyInvocationResult(skillId, result) -> "pass" | "findings"; malformed result or Roadmap SKILL_ERROR throws coded execution error.
- Descriptors fix roadmap default(input), agent detectDrift(input), retro validateFiles(input.filePaths); only registered pilot IDs accepted.

- [ ] **Step 1: Add failing contract/real-handler tests.** Assert Roadmap defaults false and invalid types/unknown fields rejected; Agent trimmed nonempty name, object-only schemas, top-level key comparison; Retro 1/32 accepted, 0/33 rejected, duplicate realpaths rejected, order retained. Assert readable contained paths accepted and relative/traversal/UNC/device/ADS/directory/escaping symlink or junction paths rejected; exact file-byte boundary enforced.
- [ ] **Step 2: Run focused tests.** Run `node --test skills/toolforge-cli/tests/invocation-contracts.test.mjs skills/retro-schema-validator/tests/index.test.js` from Toolforge checkout. New contract imports/root regressions must fail for intended missing behavior, not missing external fixtures.
- [ ] **Step 3: Implement contracts and Retro root guard.** validateFile returns an error violation with field "root" for every non-object JSON root, without changing SCHEMA or object-field behavior. Correct Agent docs only. Normalize defaults/name/path identity once; validate again inside worker immediately before handler reads.
- [ ] **Step 4: Freeze reviewed closure.** Review static imports; list allowed built-ins and every local source/resolution file in invocation-reviewed.json with SHA-256. Include all three runner source files, handlers, relevant installed metadata, and package.json files Node resolves through. Treat reviewed JSON as trusted deployment anchor, excluded from its own digest; never claim it authenticates an attacker who can alter both code and anchor. No automatic hash regeneration or generic source scanner. Dynamic imports must use only fixed reviewed descriptor mapping; handler dynamic imports are excluded.
- [ ] **Step 5: Run regressions.** Mutate copied entrypoint/import/runner/package metadata with labels unchanged; assert unavailable before handler import. Add null/array/string/number/boolean root cases, valid/warning/error/malformed JSON, ordered multiple files, real Agent aligned/missing/extra/empty-object cases, Roadmap valid/reversed/missing/strict-warning/verbose fixtures.
- [ ] **Step 6: Commit scoped deliverable.** Stage only Task 1 files; commit `fix: validate read-only pilot contracts and retro roots`. Fingerprint closure becomes final only after Task 2-3 runner sources exist; this intermediate commit must not advertise available execution.

## Task 2: Bounded Worker and Read-Only Enforcement

**Files:** C:\dev\skills\toolforge-cli\src\invoke-skill.mjs; src\invocation-worker.mjs; src\invocation-reviewed.json; tests\invocation-worker.test.mjs.

**Interfaces:**
- Consumes Task 1 validation/inspection/classification.
- Produces createInvocationRunner(context) -> {invokeSkill(skillId,input,{signal}={}), inspectInvocation(skillId), dispose()}; invokeSkill returns Promise<Envelope>.
- Envelope: {contractVersion:1, skillId, state, outcome, result, error, durationMs}; exact spec states; error {code,message,fieldErrors?}; duration nonnegative.
- Stable codes: INVALID_INPUT, INVALID_JSON, INVALID_TARGET, PAYLOAD_TOO_LARGE, RUNTIME_UNAVAILABLE, SOURCE_DRIFT, BUSY, WORKER_FAILED, TIMED_OUT, CANCELLED.
- Runner owns maximum two slots; dispose terminates active workers. Separate server instances do not share counters.
- Worker request: one {contractVersion:1,skillId,input,context} JSON object through stdin; worker stdout exactly one envelope, bounded diagnostics stderr.

- [ ] **Step 1: Write failing production-worker tests.** Real Roadmap/Agent TypeScript imports under deployed flags must work. Assert pass/findings/native optional fields, missing export/import failure, thrown handler, wrong protocol/version/result, abnormal exit, unexpected stdout, overflow, 5-second deadline, third request BUSY, and recovery after all failure states.
- [ ] **Step 2: Run `node --test skills/toolforge-cli/tests/invocation-worker.test.mjs`.** Expected new behavior fails before implementation.
- [ ] **Step 3: Implement supervisor and worker.** Use child_process.spawn with configured absolute executable, shell:false, detached:false, stdin/stdout/stderr pipes. Use --permission and --experimental-strip-types with exact --allow-fs-read file entries. Allow environment SystemRoot/WINDIR/TEMP/TMP only when runtime requires them; never inherit token/proxy/NODE_OPTIONS variables. Do not grant directory-wide roots. Recheck hashes/path/size in worker before mapped import and invocation.
- [ ] **Step 4: Prove resource and permission boundaries.** Assert already-aborted signal spawns nothing; timeout/abort/exit races release one slot exactly once; kill and await exit before release. Capture at most 131,072 combined bytes. Controlled trusted test workers probe denied write/child/worker/native-addon/WASI and unrelated reads under same flags. Fixtures are test-only, never request-selectable.
- [ ] **Step 5: Verify read-only/no-network evidence.** Hash/list fixture directories before/after real calls. Instrument controlled loopback listeners and network APIs during real-handler tests; assert no attempted requests, alongside explicit import review. Permission incompatibility disables availability, never silently weakens flags.
- [ ] **Step 6: Run Tasks 1-2 tests, refresh reviewed hashes after source review, then commit `feat: run pilot skills in bounded read-only workers`.** Runtime mismatch, registry drift, and hash mismatch must remain unavailable.

## Task 3: JSON CLI and Correct PowerShell Clipboard Text

**Files:** C:\dev\skills\toolforge-cli\src\invoke-skill.mjs; src\invocation-reviewed.json; tests\invocation-cli.test.mjs; README.md; SKILL.md; docs\USAGE.md.

**Interfaces:**
- Consumes createInvocationRunner and envelope contract.
- CLI: node <root>/skills/toolforge-cli/src/invoke-skill.mjs --skill <id> --workspace-root <absolute-root> (repeatable roots); stdin exactly one JSON object.
- Produces formatInvocationCommand(skillId,input,{nodeExecutable,scriptPath,workspaceRoots}) -> string; pure portable formatter exported for dashboard reuse.
- Exits: 0 completed/pass; 1 completed/findings; 2 all other states.

- [ ] **Step 1: Add failing subprocess tests.** CLI/managed API native semantic parity for each pilot and pass/findings/failure; reject unknown/missing arguments, arbitrary entrypoint/export args, empty/malformed/multiple stdin objects. Test byte cap including split UTF-8 chunks, stdin error, unavailable runtime, stderr diagnostics without stdout contamination.
- [ ] **Step 2: Run `node --test skills/toolforge-cli/tests/invocation-cli.test.mjs`.** Expected new CLI/formatter assertions fail.
- [ ] **Step 3: Implement CLI and formatter.** CLI entry guard must not execute when imported. Decode bounded Buffer input as strict UTF-8. Command uses call operator with single-quoted executable/script/args, apostrophe doubling and compact JSON. Run inside scriptblock; reject shell major <7 before Node, set BOM-less UTF-8 $OutputEncoding, restore finally. Preserve native process exit status without exiting user's interactive shell.
- [ ] **Step 4: Execute generated commands in pwsh.** Test apostrophe/quote/backslash/dollar/backtick/HTML and non-ASCII names/keys/paths, initially ASCII $OutputEncoding, restoration on success and Node failure. Use actual Windows PowerShell 5.1 executable to prove rejection before Node invocation. Assert no injection side effect; subprocess exit/native fields match expectations.
- [ ] **Step 5: Document shell/runtime/input/result limits and fail-closed behavior.** README <100 lines, SKILL.md <150 lines; multi-step examples/troubleshooting in USAGE. Existing PowerShell marketplace CLI unchanged.
- [ ] **Step 6: Run Tasks 1-3 tests, review and update pinned hashes, commit `feat: add input-aware pilot CLI and clipboard commands`.**

## Task 4: ICF Inventory Capability and Dedicated HTTP Route

**Files:** C:\dev\icf\src\server.mjs; src\toolforge-inventory.mjs if needed; test\toolforge-invocation.test.mjs; test\toolforge-inventory.test.mjs.

**Interfaces:**
- Consumes Toolforge createInvocationRunner and inspectInvocation through configured root, not arbitrary request imports.
- createGatewayServer options extend with toolforgeNodeExecutable, toolforgeWorkspaceRoots, toolforgeDashboardOrigin; defaults process.execPath, [ROOT], and configured loopback dashboard origin. Never derive trusted Origin from untrusted Host header.
- POST /api/toolforge/invoke accepts exactly {skillId,input}; returns envelope. GET /api/toolforge/skills attaches optional inputInvocation to only three pilots.
- Inventory metadata carries {contractVersion:1,fields,available,reason,commandContext}; commandContext contains trusted nodeExecutable, scriptPath, workspaceRoots. Standalone command/runnable fields remain unchanged. Do not expose context from request input.
- Browser formatting stays a pure, parity-tested consumer; do not expose Node supervisor source or add arbitrary file-serving routes.

- [ ] **Step 1: Add failing HTTP tests.** Use createGatewayServer({historyAdapter:{},...}) with disposable roots/storage. Assert all status codes: 200,400,403,405,413,429,503,500,504; pre-parse errors have null skillId/result/outcome. Test malformed pilot versus unchanged malformed legacy JSON response, unknown fields/IDs, no-origin rejection for browser route, hostile Origin/preflight, actual non-loopback guard, content type, and byte boundaries.
- [ ] **Step 2: Run `node --test test/toolforge-invocation.test.mjs test/toolforge-inventory.test.mjs`.** New route/capability assertions must fail.
- [ ] **Step 3: Load reviewed managed API and add route before legacy action parsing.** Missing runner/runtime/source keeps instructions available. Trusted roots come only from host options; no request overrides. Match exact configured Origin, enforce loopback/method/content type before bounded body read. Map stable errors to spec HTTP status; add METHOD_NOT_ALLOWED, FORBIDDEN, UNSUPPORTED_CONTENT_TYPE codes (content type rejection 400).
- [ ] **Step 4: Wire cancellation/cleanup.** Abort on incomplete request/disconnected response, not normal request-body completion; close server disposes runner. Test completed request does not prematurely cancel, disconnect releases slots, unexpected stream error returns stable failure without uncaught rejection.
- [ ] **Step 5: Verify no disclosure and legacy regressions.** Assert input/result absent from SSE/history/log sinks; inventory fallback no fabricated capability; no changes to old runnable/command/action contracts. POST stays awaited, never DISPATCHED.
- [ ] **Step 6: Run `npm run test:gateway`, then commit `feat: expose read-only Toolforge invocation in ICF`.**

## Task 5: Shared Pilot Dialog on Both Dashboards

**Files:** C:\dev\icf\dashboard\toolforge-invocation.mjs; dashboard\index.html; dashboard\preview-enhanced.html; test\toolforge-invocation-ui.test.mjs; test\toolforge-skill-command.test.mjs.

**Interfaces:**
- Produces mountToolforgeInvocation({inventory,rootElement,copyCommand,onResult}) -> {open(skillId,trigger),dispose()}.
- Consumes Task 4 metadata/route and Task 3 exact formatInvocationCommand behavior; any browser formatter copy is constrained to that pure function and tested against managed export, not a new runtime adapter.
- Consumes Task 4 commandContext; only host values, never user-edited executable arguments. Task 4 tests pin this metadata and Task 5 tests pin formatter parity.
- Roadmap defaults/Agent trim/Retro list semantics match Task 1. Server remains authority for filesystem validity.

- [ ] **Step 1: Add failing shared UI/markup tests.** Both surfaces load one shared module and expose Configure only for available pilots; other CLI/instructions controls unchanged. Validate required fields, JSON object types, unknown adapter fields, booleans and 1-32 paths. No framework/dependency addition.
- [ ] **Step 2: Run `node --test test/toolforge-invocation-ui.test.mjs test/toolforge-skill-command.test.mjs`.** Expected missing module/dialog behaviors fail.
- [ ] **Step 3: Implement compact existing-style dialog.** Roadmap path and two checkboxes; Agent name and two JSON textareas; Retro explicit add/remove list. Native dialog focus management, Inputs/Result views, textContent rendering, visible focus and responsive wrapping. AbortController per run; duplicate submit disabled.
- [ ] **Step 4: Gate copy on server-validated unchanged inputs.** No additional filesystem-validation endpoint. Copy remains disabled until completed/pass or completed/findings; command uses same unchanged inputs/defaults and trusted commandContext, revalidated by CLI. Edits immediately invalidate result/command; failed/cancelled runs cannot enable copy. Accessible control description states PowerShell 7 requirement.
- [ ] **Step 5: Add stale-state and clipboard tests.** Closing clears input/result and aborts; older request token cannot overwrite new dialog state. Missing/rejected clipboard API yields visible failure, never false success; copied command exactly matches pure managed formatter. No local/session storage or HTML interpolation. Ensure scripts serve with JavaScript MIME through existing static routing.
- [ ] **Step 6: Run gateway/UI tests, then commit `feat: configure read-only pilot skills on both dashboards`.**

## Task 6: Full Acceptance, Live Neo QA, and Delivery

**Files:** Existing tests above; C:\dev\icf\docs\superpowers\plans\2026-10-09-toolforge-read-only-pilot.md (checkbox progress); chat outputs/toolforge-pilot-qa.md and screenshots.

**Interfaces:** Completed Tasks 1-5; no new execution capability.

- [ ] **Step 1: Run focused native suites.** Toolforge: `node --test skills/toolforge-cli/tests/invocation-*.test.mjs skills/retro-schema-validator/tests/index.test.js`. Run existing Agent/Roadmap tests using their checked installed local runner, never npx downloads. Record missing dependencies as gaps, not passes.
- [ ] **Step 2: Run full ICF `npm test`.** Require all tests pass, classify unrelated failures explicitly. Record commands/counts/skips separately from real-handler and browser evidence.
- [ ] **Step 3: Start isolated loopback server on free port.** Use verified isolated ICF checkout and matching reviewed Toolforge root. Configure exact dashboard Origin before launch. Preserve unknown 8080 owner; no production bot/task starts.
- [ ] **Step 4: BrowserOS Neo full QA.** Read browseros-neo skill; own session/pages. Main wiki-alias governance deep link and preview: every pilot form, strict/verbose/list controls, pass/findings/errors, real cancellation, unavailable fallback, exact actual clipboard, execute copied commands against disposable fixtures, keyboard/focus restoration, desktop/mobile screenshots, wrapping and no stale state. Re-audit every existing clipboard family without executing mutating commands.
- [ ] **Step 5: Review whole scoped diff and rerun regressions for each fix.** Verify static import closure/hash anchor matches final reviewed sources; compare fixture hashes/listings; no input/result persistence or unintended files. Do not mark invocation available after any failed production-worker gate.
- [ ] **Step 6: Deliver evidence and scoped commits.** Report changed files, findings, focused/full/live/real-handler results, current server URL, remaining limitations. No push. Rollback removes inputInvocation metadata/Configure and restores instructions; legacy dispatch intact.

## Execution Preflight and Order

- [ ] Before implementation, load chosen execution skill plus using-git-worktrees. Inspect exact roots, local instructions/governance/checklists, dirty status, git remotes and owner paths. Use verified isolated Toolforge and ICF checkouts; no canonical runtime edits.
- [ ] Carry forward only scoped existing command-audit files from canonical ICF into isolated baseline: dashboard/index.html, dashboard/preview-enhanced.html, src/server.mjs, src/toolforge-inventory.mjs, src/toolforge-skill-command.mjs, test/toolforge-inventory.test.mjs, test/toolforge-skill-command.test.mjs. Verify diff/hashes; preserve all unrelated changes. Do not stage telemetry or untracked agent configs.
- [ ] Pin Toolforge root explicitly in isolated ICF; do not assume sibling path still points to correct owner.
- [ ] Execute Tasks 1 -> 2 -> 3 -> 4 -> 5 -> 6. Fresh review after each independently testable task for subagent-driven mode; final whole-branch review regardless of method.
- [ ] Reviewed fingerprint anchor is deployment trust assumption, not self-authentication. If implementation cannot meet production flags/import/permission tests, stop enabling pilot and report unavailable; do not substitute relaxed execution.
- [ ] Plan approval plus human execution-method selection required before implementation.

## Self-Review

Coverage: spec contracts/path rules -> Task 1; fingerprints/read-only/resources -> Tasks 1-2; CLI/envelopes/encoding -> Tasks 2-3; inventory/HTTP/privacy -> Task 4; forms/copy/cancellation/accessibility -> Task 5; full/live delivery -> Task 6.
Review Focus cases assigned to named test steps. Shared signatures, envelopes and fixed pilot mappings used consistently. No schema discovery, dependency installation, data persistence, remote delivery, or unrequested redesign.
