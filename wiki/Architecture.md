<!--
title: "Architecture Specification"
status: active
owner: chris
last-reviewed: 2026-09-27
brand: hybrid
hybrid-primary: icf
hybrid-secondary: cic
-->

# Architecture Specification

Iron Command Forge (ICF) consolidates workspace operations into four decoupled subsystems:
1. Web dashboard and user experience (`dashboard/`)
2. Server runtime and HTTP gateway (`src/server.mjs`)
3. Reporting core and snapshot store (`reporting/src/`)
4. Daemon supervision and automation (`scripts/`)

---

## Architectural diagram

![Iron Command Forge Architecture](icf-architecture-diagram.png)

<details>
<summary>Mermaid source...</summary>

```mermaid
flowchart TD
  classDef darkStyle fill:#2c2420,stroke:#c4501a,stroke-width:1.5px,color:#f2ece2;
  classDef lightStyle fill:#f2ece2,stroke:#2c2420,stroke-width:1.5px,color:#2c2420;
  classDef accentStyle fill:#fff,stroke:#c4501a,stroke-width:1.5px,color:#2c2420;

  subgraph S1["Subsystem 1: Web Dashboard & UX (/dashboard)"]
    D1["Web Dashboard SPA (index.html)"]:::lightStyle
    D2["Cast Iron Charlie Design System (_ds/)"]:::lightStyle
    D3["Custom Element (<weekly-reporting-dashboard>)"]:::accentStyle
  end

  subgraph S2["Subsystem 2: Server & Gateway Runtime (src/server.mjs)"]
    G1["Static Asset Server (Path Traversal Guard)"]:::lightStyle
    G2["API Projection Router (/api/reporting/weekly-retro/*)"]:::accentStyle
    G3["LocalFileAdapterTransport.mjs"]:::lightStyle
  end

  subgraph S3["Subsystem 3: Reporting Core & Persistence (reporting/src)"]
    R1["SQLite Snapshot Store (001_snapshot_store.sql)"]:::darkStyle
    R2["Trend Analytics (4, 8, 12-week windows)"]:::darkStyle
    R3["Action Continuity & Redaction Ledger"]:::darkStyle
  end

  subgraph S4["Subsystem 4: Daemon & Watchdog (scripts/)"]
    W1["ensure-dashboard-server.ps1"]:::lightStyle
    W2["Scheduled Task: ICF-Dashboard-Server"]:::lightStyle
  end

  D1 -. Static Fetch .-> G1
  D3 -- JSON API --> G2
  G2 --> R1
  G2 --> R2
  G2 --> R3
  G3 --> G2
  W1 -- Supervises Port 8080 --> G1
```

</details>

---

## Subsystem specifications

### 1. Web dashboard surface (`/dashboard`)
The web dashboard provides a multi-tab operations center for system ingestion, operational telemetry, and weekly engineering retrospectives.
- **Design system**: Incorporates Cast Iron Charlie (`dashboard/_ds/`) with serif editorial headers (`Playfair Display`), structured tabular sans (`Barlow Condensed`), and monospace badges (`Geist Mono`).
- **Modular components**: Renders `<weekly-reporting-dashboard>` as a custom element connecting directly to the API projection layer.

### 2. Server and gateway runtime (`src/server.mjs`)
The standalone Node.js server exposes HTTP routes on `127.0.0.1:8080`.
- **Security controls**: Verifies incoming URI strings against directory traversal sequences (`/..`, `\..`, `%2e%2e`, and `%2E%2E`) prior to URL normalization, returning HTTP 403 Forbidden on violation.
- **Static routing**: Mounts `dashboard/` assets strictly under the `/dashboard` prefix and returns HTTP 404 for invalid resource paths.
- **API delegation**: Routes `/api/reporting/weekly-retro` queries to `LocalFileAdapterTransport.mjs` or embedded SQLite projections.

### 3. Reporting core and snapshot store (`reporting/src`)
The reporting engine processes weekly telemetry and retrospective data using native `node:sqlite`.
- **Schema versioning**: Applies migrations (`001_snapshot_store.sql` through `005_routing_support.sql`) upon database initialization.
- **Trend evaluation**: Computes rolling metrics across 4, 8, and 12-week intervals, emitting explicit statuses (`EMPTY_WINDOW`, `DATA_PRESENT`, or `TREND_RECALCULATING`).
- **Action tracking**: Manages remediation life cycles, status progressions, and redaction tombstones.

### 4. Background daemon supervision (`scripts/`)
PowerShell automation scripts ensure persistent service availability.
- **Probing and watchdog**: `scripts/ensure-dashboard-server.ps1` checks endpoint responsiveness on port 8080, launching the server process in the background if offline.
- **Task automation**: `scripts/register-dashboard-server-task.ps1` registers the `ICF-Dashboard-Server` task within Windows Task Scheduler.
