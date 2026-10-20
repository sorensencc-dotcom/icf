<!--
title: "Web Dashboard & Cast Iron Charlie Design System"
status: active
owner: chris
last-reviewed: 2026-09-27
brand: hybrid
hybrid-primary: icf
hybrid-secondary: cic
-->

# Web Dashboard & Cast Iron Charlie Design System

The Iron Command Forge (ICF) web dashboard (`dashboard/`) provides an interactive command center for developer telemetry, DAG execution runs, and weekly retrospectives.

---

## Design tokens and typography

The dashboard uses the Cast Iron Charlie design system (`dashboard/_ds/`):
- **Paper / Canvas**: `#f2ece2` (warm vintage tone)
- **Ink / Typography**: `#2c2420` (deep contrast charcoal)
- **Muted / Subtitle**: `#5c5349` (secondary text and axis lines)
- **Terracotta Accent**: `#c4501a` (active tabs, highlights, and primary CTA)
- **Primary Serif**: `Playfair Display` (editorial headings)
- **Primary Sans**: `Barlow Condensed` (dense tabular data and system labels)
- **Monospace**: `Geist Mono` (code snippets, status tags, and commit hashes)

---

## Web component architecture

The dashboard integrates custom web elements:
- `<weekly-reporting-dashboard>`: Mounts the executive summary, review cards, evidence inspection drawers, and action tracking components.
- Handles automated data binding to `/api/reporting/weekly-retro/*` routes with graceful loading and offline fallback states.

---

## Accessing the dashboard

To access the dashboard locally:
1. Start the server using `npm run start` or `scripts/ensure-dashboard-server.ps1`.
2. Open `http://127.0.0.1:8080/dashboard` in a web browser.
