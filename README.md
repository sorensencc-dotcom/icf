# Iron Command Forge (ICF)

Standalone operational command center, reporting engine, telemetry aggregator, and knowledge dashboard repository.

## Repository Overview

- **`dashboard/`**: Interactive web dashboard (`index.html`), Cast Iron Charlie design system tokens (`_ds/`), and UI support scripts.
- **`reporting/`**: Embedded SQLite snapshot store, weekly retro contract validation, action continuity, and 83 verified unit/contract tests.
- **`src/`**: Consolidated HTTP static asset delivery with boundary-enforced path traversal protection, local file transport adapters, and reporting API gateway (`/api/reporting/weekly-retro/*`).
- **`scripts/`**: Operational PowerShell supervision scripts (`ensure-dashboard-server.ps1`, `register-dashboard-server-task.ps1`).
- **`docs/`**: Architectural specifications and diagrams compliant with the Cathryn Lavery visual design standard.

## Prerequisites

- Node.js >= 22.5.0 (with native `node:sqlite`)
- PowerShell 7+ (`pwsh`)

## Quick Start

### 1. Run Preflight Conformance
To verify repository structure and branch context:
```powershell
pwsh -NoProfile -File C:\dev\scripts\verify-repo-context.ps1 -Path C:\dev\icf
```

### 2. Run Test Suites
To run all test suites (reporting contract + gateway integration):
```powershell
npm test
```

### 3. Start the Server Gateway
To start the server manually on `http://127.0.0.1:8080`:
```powershell
npm start
```

### 4. Background Supervision
To ensure the server is running with automated health probing and restart:
```powershell
pwsh -NoProfile -File scripts/ensure-dashboard-server.ps1
```

To register or manage the Windows Scheduled Task:
```powershell
# Register at startup and user login
pwsh -NoProfile -File scripts/register-dashboard-server-task.ps1

# Check task status
pwsh -NoProfile -File scripts/register-dashboard-server-task.ps1 -List
```
