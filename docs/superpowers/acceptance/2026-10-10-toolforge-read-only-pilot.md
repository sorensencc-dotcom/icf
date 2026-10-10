# Toolforge Read-Only Pilot: Final Acceptance

Date: 2026-10-10. Operational delivery. Approved three-skill pilot complete in isolated worktrees; no merge or push.

## Findings Closed

- Commands now follow checked runtime/entrypoint contracts rather than treating every registered skill as a standalone CLI. Other skills retain checked legacy CLI or documentation behavior; this does not implement input-aware adapters for every skill.
- Roadmap, Agent Drift, and Retro use fixed native exports, explicit validated inputs, reviewed source closure, bounded read-only workers, JSON-stdin CLI, and matching PowerShell 7 commands.
- Retro non-object JSON roots produce validation findings instead of TypeError. Agent documentation matches actualSchema and native output.
- Clipboard failures no longer announce success. Toasts cannot block repeat clicks. Wiki-link and Standup failures handled honestly.
- Dialog rejects malformed completions; edits/close invalidate results and commands; late requests cannot restore stale state. Native Tab boundaries remain inside dialog. Retro field validity clears after correction.
- Final review's configured-owner legacy dispatch defect fixed: installed script and cwd derive from server-configured Toolforge owner, without changing other action families or DISPATCHED semantics.
- Four wiki command families now use quoted kb-sync owner paths with Push-Location/try/finally/Pop-Location. Four matching main copy-only controls added beside existing actions. Pilot command text is not globally prefixed.
- Stale registry badge and misleading Instructions Only labels corrected without changing capability/count semantics.

Initial whole-branch review requested three final fixes. One fix wave completed; scoped independent re-review PASS, no new fix-induced findings. See accompanying final review, final-fix report, and final-rereview artifacts. Reviewer did not rerun suites/browser; controller evidence below closes reviewer's pending live checks.

## Verification

| Evidence | Result |
| --- | --- |
| Managed contract/worker/CLI plus Retro tests | 47/47, zero skips |
| Original Roadmap local Jest | 18/18 |
| Original Agent local Jest | 2/2 |
| Full final ICF npm test | 151/151: 87 reporting + 64 gateway, zero skips |
| Final fix focused tests | Implementer 55/55; intended regression RED then GREEN |
| Reviewed source closure | 15 pins match; anchor SHA-256 e93d685b466750a29471df2991491dc841585987d819cc92b3a292c8be83eb51 |
| Disposable read-only fixtures | Eight hashes and sorted directory listing unchanged |

Full ICF uses ICF_REPORTING_DATABASE_PATH=:memory:, unchanged sandbox telemetry siblings, and explicitly synthetic untracked history fixture. Existing installed local Jest dependencies reused through isolated junctions; no downloads. These adaptations are test-environment evidence, not proof of default persistent reporting deployment.

Controller full final suite passed against ICF product head 3b2e70f. Toolforge product head 903c4436 unchanged. ICF acceptance-plan commit 269d83e is documentation-only.

## BrowserOS Neo Live QA

Main wiki-alias and enhanced preview, owned isolated loopback pages:

- Existing governance clipboard controls: 9/9 each, actual clipboard equals visible payload.
- Additional command-family samples: PowerShell scripts, npm-prefix, scheduled start/inspection/filter, network diagnostics, Node/Python/PowerShell CLI. Copied operational commands not executed.
- All three actual pilot forms on both surfaces: native pass/findings, field/JSON errors, strict/verbose Roadmap, Agent drift/object-only inputs, ordered Retro files and scalar-root findings.
- Eleven real HTTP input/result cases match expected native semantics and status envelopes.
- Actual clipboard for all three pilot families on both surfaces matches reviewed managed formatter byte-for-byte. Unicode, apostrophes, dollars, backticks, and HTML-like input remain literal.
- Actual copied Main Roadmap/Agent pass commands execute exit 0. Main Agent findings and Retro warning execute exit 1. Preview strict Roadmap executes exit 1. Preview Agent/Retro copied and formatter-verified, not separately executed.
- Missing/synchronous/rejected clipboard cases report failure; temporary overrides restored. Edited input disables copy and clears result. Escape clears inputs/results, restores trigger focus; reopening blank. Late clipboard/request state ignored.
- Real throttled Fetch cancellation: Running disables Run/Copy, Cancel gives Cancelled/copy disabled; subsequent run passes. Running Escape/reopen cannot resurrect inputs/results. Browser network settings restored. Native worker-close/slot recovery proven separately by managed tests.
- Native Tab/ShiftTab wrap inside modal. Retro Add reaches 32, disables Add; removal to 31 re-enables. Invalid-to-valid clears aria-invalid. Blank list disables Run; reopen resets one blank row.
- Desktop 1440x900 and mobile 390x844 bounds fit without page/dialog horizontal overflow. Four unchanged PNG screenshots exported and visually inspected. Preview desktop screenshot predates final background label-only correction; do not use it as current-label proof. Final mobile dialog evidence and final live label checks remain valid.
- Unavailable-runtime server: exactly three unavailable capabilities, zero Configure controls, POST 503 with safe null result/outcome, legacy instructions retained.
- Final server restarted with corrected source. Actual synthetic legacy Run Skill button dispatch writes test-only receipt with exact configured script/cwd/PID; no real production skill executed.
- Final four wiki families: actual clipboard 4/4 Main and 4/4 Preview, exact kb-sync owner and finally restoration text. No mutating wiki execution. Native tests/reviewer interception separately verify cwd restoration after success/failure and fail-before-invocation on missing owner.

Browser harness limits: renewed sessions required ownership restoration; background screenshots required Page.bringToFront. One emulated pointer-coordinate mismatch checked with native viewport pointer and emulated keyboard activation. Timeout/harness failures were corrected and never counted as product passes. Canonical user 8080 page left unchanged.

## Changed Files

Toolforge owner: C:/dev; isolated checkout C:/dev/dev-sandbox/toolforge-read-only-pilot. Thirteen files from base de310f24:

- skills/agent-drift-detector/SKILL.md
- skills/retro-schema-validator/src/index.js
- skills/retro-schema-validator/tests/index.test.js
- skills/toolforge-cli/README.md
- skills/toolforge-cli/SKILL.md
- skills/toolforge-cli/docs/USAGE.md
- skills/toolforge-cli/src/invocation-contracts.mjs
- skills/toolforge-cli/src/invocation-reviewed.json
- skills/toolforge-cli/src/invocation-worker.mjs
- skills/toolforge-cli/src/invoke-skill.mjs
- skills/toolforge-cli/tests/invocation-cli.test.mjs
- skills/toolforge-cli/tests/invocation-contracts.test.mjs
- skills/toolforge-cli/tests/invocation-worker.test.mjs

ICF owner: C:/dev/icf; isolated checkout C:/dev/dev-sandbox/icf-read-only-pilot. Twelve files from approved-spec base 351f666, including carried-forward scoped command-audit baseline:

- dashboard/index.html
- dashboard/preview-enhanced.html
- dashboard/toolforge-invocation.mjs
- docs/superpowers/plans/2026-10-09-toolforge-read-only-pilot.md
- docs/superpowers/specs/2026-10-09-toolforge-read-only-pilot-design.md
- src/server.mjs
- src/toolforge-inventory.mjs
- src/toolforge-skill-command.mjs
- test/toolforge-inventory.test.mjs
- test/toolforge-invocation.test.mjs
- test/toolforge-invocation-ui.test.mjs
- test/toolforge-skill-command.test.mjs

No package/lockfile, registry permission, or governance policy changes. Existing unrelated Toolforge audit dirt preserved. Synthetic history untracked, not committed. Canonical prior command-audit changes preserved; pilot runtime edits only isolated. Ledger and review artifacts retained.

## Rulings and Costs

1. Git worktree fallback because app tool has no repository selector. Cost: manual checkout ownership/upkeep.
2. In-memory reporting rather than canonical persisted data. Cost: default-persistence deployment not live-tested.
3. Native Process UTF-8 StandardInput.Write and ArgumentList, no newline/cap relaxation/new flag. Cost: PowerShell 7/Windows-specific process behavior.
4. Migrate prior unavailable assertion after reviewed runner completion; retain incomplete-anchor negative case. Cost: regression expectation maintenance.
5. Pin tracked SKILL.json spelling; no metadata provisioning. Cost: casing portability must stay exact.
6. Copy unchanged verified telemetry siblings into sandbox namespace without overwrite. Cost: test layout differs from deployment.
7. Minimum adjacent toast/Wiki-link/Standup fixes and live-observed native focus fix. Cost: small legacy UI behavior surface added to regression scope.
8. Human GO covers narrow owner/cwd repair despite original legacy-unchanged boundary; four main copy controls for parity. Cost: limited adjacent dispatch/UI adjustment.

## Delivery and Limits

Branch in both repositories: feat/toolforge-read-only-pilot-20261009. Worktrees remain preserved, unmerged, unpushed. Canonical current branches are not automatically integration targets; confirm original base branches before merge.

Live isolated QA: http://127.0.0.1:8082/modules/wiki/dashboard.html#category-governance and http://127.0.0.1:8082/dashboard/preview-enhanced.html#category-governance.

Host configuration currently allows only synthetic chat fixture root. Real C:/dev inputs require separately reviewed host configuration/integration. Node 24 and PowerShell 7 required. Deadline 5 seconds, two concurrent workers, 64 KiB input, 128 KiB combined output, 1 MiB per selected file, 1-32 Retro files.

No remote CI, merge, push, production activation, real mutating wiki scripts, bot/task starts, new dependencies, or all-skill input-aware rollout. Native Node permissions/source fingerprints are not an OS sandbox or network firewall; hostile concurrent filesystem replacement and an owner replacing both source and trust anchor remain outside guarantee.
