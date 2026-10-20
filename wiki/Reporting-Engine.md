<!--
title: "Reporting Engine"
status: active
owner: chris
last-reviewed: 2026-09-27
brand: hybrid
hybrid-primary: icf
hybrid-secondary: cic
-->

# Reporting Engine

The Iron Command Forge (ICF) reporting engine provides deterministic telemetry evaluation, snapshot persistence, trend analytics, and action tracking using embedded SQLite (`node:sqlite`).

---

## Storage architecture

The snapshot store uses five incremental SQL migrations:
1. `001_snapshot_store.sql` — Base tables for snapshot envelopes, source metadata, and computed summaries.
2. `002_evidence_indexes.sql` — Optimized indexes for fast composite query execution.
3. `003_action_continuity.sql` — Action tracking, state progressions, and carry-forward linkages.
4. `004_redaction_ledgers.sql` — Redaction ledger and privacy tombstone markers.
5. `005_routing_support.sql` — Category-level routing and destination tagging.

---

## API endpoints

The reporting server exposes the following endpoints:

| Endpoint | Method | Purpose |
| :--- | :---: | :--- |
| `/api/reporting/weekly-retro` | `GET` | Returns the latest weekly retrospective envelope and status. |
| `/api/reporting/weekly-retro/history` | `GET` | Returns historical retrospective records over configurable date bounds. |
| `/api/reporting/weekly-retro/categories` | `GET` | Returns grouped metrics across system categories. |
| `/api/reporting/weekly-retro/evidence` | `GET` | Returns granular evidence records for drill-down investigation. |
| `/api/reporting/weekly-retro/actions` | `GET`, `POST` | Manages action items, state transitions, and carry-forwards. |
| `/api/reporting/weekly-retro/routing` | `GET` | Returns category destination routes and routing rules. |

---

## Verification test suite

The reporting core includes 83 unit and contract tests verifying:
- Snapshot schema migrations and rollbacks
- Rolling trend evaluations across 4, 8, and 12-week windows
- Fallback degradation under missing historical data
- Redaction ledger compliance and tombstone immutability

To execute the reporting test suite, run:
```powershell
npm test
```
