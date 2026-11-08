---
title: "Promote refuses filename-only cards, rejected receipts, and completed aliases"
author: Chris
date: 2026-11-08
branch: fix/promote-guard-filename-only
id: l-60be93dd
scope: repo
status: active
src: agent
touches:
  - dashboard/daily_status.json
  - src/server.mjs
  - test/trm-backlog-api.test.mjs
---

## Decided
- `/api/reporting/trm-backlog/promote` refuses cards whose source body was not fetched (`context.body_fetch_failed`, fetch-failed notes, or body-extraction errors), cards in REJECTED/FAILED/QUARANTINED status, rejected receipts, and completed sibling aliases named in `archived_path` or `parent_action_id`.
- Filename-only gdoc stubs must not become GitHub issues. ICF #60 and #61 were that failure: the auditor already shipped as toolforge#256.

## Tried and ruled out
- Blocking only `issue_url`, `COMPLETED`, and `receipt-${id}-completed.json`. Rejected receipts and remediating sibling IDs still promoted.

## Watch out
- Research cards with `research_ref` may still promote after COMPLETED. Filename-only and rejected cards do not get that exception.
