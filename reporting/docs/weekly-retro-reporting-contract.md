# Weekly retro reporting contract

This repository is a standalone reporting boundary. It does not migrate or modify the existing `kb-sync`, Toolforge, or wiki dashboard applications.

## Read and write boundaries

`GET /api/reporting/weekly-retro` reads and validates the current report. History, category, evidence, action, and routing endpoints expose bounded projections. Readers remain available without a snapshot writer.

`publishWeeklyRetro` writes only when `ICF_WEEKLY_RETRO_WRITER_ENABLED` is `true`, `TRUE`, or `1`. Generation completes before report validation and SQLite persistence. Snapshot upserts are atomic and repeat-identical writes are idempotent.

## Snapshot identity and history

Every snapshot is identified by `sourceSystem`, `sourceId`, `weekKey`, and `categoryId`. Legacy envelopes are normalized on read without mutation. Trend summaries are derived state; stale summaries must be rebuilt before being treated as current.

## Actions, provenance, and redaction

Actions have stable identity and carry-forward history. Updates retain existing provenance and cannot detach or reassign it. Explicit `status: null` is invalid. Redaction removes raw wording, owner, history, and provenance, including legacy rows without origin columns, while retaining safe aggregate/tombstone state.

## Category and routing semantics

The initial registry contains four immutable launch categories. Metrics carry direction, unit, source, and explicit empty/partial/zero-activity/unavailable state semantics. Routing facts are evaluator metadata only; invalid or unavailable routing interpretation never replaces report evidence.

## Rollback

Disable `ICF_WEEKLY_RETRO_WRITER_ENABLED` and restart the publisher. Readers continue serving the last valid report. Generator failures and invalid reports are rejected before persistence, preserving that last valid snapshot. Production rollout, remote publication, and migration of the existing dashboard are separate efforts.
