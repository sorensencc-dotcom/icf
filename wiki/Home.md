<!--
title: "Iron Command Forge Wiki"
status: active
owner: chris
last-reviewed: 2026-09-27
brand: hybrid
hybrid-primary: icf
hybrid-secondary: cic
-->

# Iron Command Forge Wiki

Iron Command Forge (ICF) is the centralized operations, reporting, telemetry aggregation, and dashboard platform for the developer workspace.

ICF combines an SQLite-backed reporting engine with bounded trend projection, a multi-tab operations dashboard powered by the Cast Iron Charlie design system, an HTTP static and API gateway server, and Windows background daemon supervision.

---

## Core documentation

- [[Architecture]]: System design, subsystem boundaries, and visual architecture specifications.
- [[Reporting-Engine|Reporting Engine]]: SQLite snapshot store schema, rolling trend calculations, action continuity, and redaction ledger.
- [[Web-Dashboard|Web Dashboard]]: Cast Iron Charlie design system, custom HTML web components, and review surfaces.
- [[Operations-Guide|Operations Guide]]: Daemon management, Scheduled Task watchdog installation, and automated health verification.

---

## Architecture overview

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

## Quick start

To start the standalone ICF server, run:
```powershell
npm run start
```

To run all 84 unit and gateway integration tests, run:
```powershell
npm test
```

To verify repository preflight conformance, run:
```powershell
pwsh -NoProfile -File C:\dev\scripts\verify-repo-context.ps1 -Path C:\dev\icf
```
