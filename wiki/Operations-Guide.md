<!--
title: "Iron Command Forge (ICF) Operations Manual"
status: active
owner: chris
last-reviewed: 2026-10-08
brand: hybrid
hybrid-primary: icf
hybrid-secondary: cic
version: 1.5.0
-->

# Iron Command Forge (ICF) Operations Manual

This manual details standard operating procedures, architectural topology, tab controls, background daemons, and administrative runbooks for Iron Command Forge (ICF).

---

## 1. System Overview and Topology

Iron Command Forge (ICF) serves as the central control plane, real-time telemetry matrix, and automation console for the zero-token local bot fleet. ICF consolidates observability across knowledge synthesis (KB-Sync), autonomous bot runners (IronBots), topic research mining (TRM), ledger accounting (IronLedger), and model headroom optimization.

### Architectural Diagram

```
+--------------------------------------------------------------------------+
|                        Browser Client (Neo / Local)                      |
|                 http://127.0.0.1:8080/dashboard (Parchment/Forge)        |
+--------------------------------------------------------------------------+
       |                                                    |
  HTTP REST & Action Dispatch                         SSE Stream (/api/events)
       |                                                    |
+--------------------------------------------------------------------------+
|                     ICF Gateway Server (Port 8080)                       |
|                      c:\dev\icf\src\server.mjs                           |
|  - Loopback Security Guard                                               |
|  - Action Dispatcher (POST /api/actions/run, POST /api/actions/clear)    |
|  - Static Asset Resolver (Dashboard, Modules, Wiki Markdown)             |
|  - SSE Live Telemetry Broadcaster (15s Heartbeat, FS Watcher)            |
+--------------------------------------------------------------------------+
       |                           |                         |
+---------------+          +---------------+         +---------------------+
| Scheduled Task|          | Status Feeds  |         | Knowledge Base      |
| Daemon-Healer |          | c:\dev\_status|         | Obsidian Vault      |
| Watchdog Loop |          | *.json feeds  |         | c:\dev\wiki\*.md    |
+---------------+          +---------------+         +---------------------+
```

---

## 2. Server Management and Lifecycle

The ICF server runs as an elevated Node.js service binding to loopback host `127.0.0.1` on port `8080`.

### Manual Foreground Startup
To start the standalone ICF server in the foreground:
```powershell
cd C:\dev\icf
npm run start
```
The server logs its initialization and binds to `http://127.0.0.1:8080`.

### Background Daemon Watchdog
To verify health and start the server process in the background if uncontactable:
```powershell
pwsh -NoProfile -File C:\dev\icf\scripts\ensure-dashboard-server.ps1
```

### Self-Healing Restarts via Sentinel File
Because the background daemon executes with highest administrative privileges under Windows Task Scheduler, direct unprivileged process termination (`taskkill` / `Process.Kill()`) results in `Access Denied`.

To perform a clean zero-downtime daemon restart:
1. Touch the sentinel trigger file:
   ```powershell
   New-Item -ItemType File -Path "C:\dev\.restart-trigger" -Force
   ```
2. Trigger the scheduled watchdog bot:
   ```powershell
   Start-ScheduledTask -TaskPath "\Ironbots\" -TaskName "Daemon-Healer"
   ```
The `daemon-healer-bot.mjs` supervisor detects the sentinel, evicts stale worker PIDs, starts a fresh server instance rooted at `C:\dev\icf`, and deletes `C:\dev\.restart-trigger`.

---

## 3. Tab Reference Guide

The ICF dashboard organizes operational domains across 10 specialized views:

| Tab ID | Tab Name | Primary Function | Primary Data Sources |
| :--- | :--- | :--- | :--- |
| `tab-daily` | **01. Daily Feed** | Priority burn-down, operator calendar, daily action items, and task status. | `latest-weekly-retro.json`, local daily logs. |
| `tab-trm` | **02. TRM Research** | Topic Research Mining (TRM) matrix, gap triage queue, and notebook artifacts. | `_status-feed/trm_ingress_status.json`, `_status-feed/trm_history/`. |
| `tab-wiki` | **03. Knowledge Base** | Vault integrity, wikilink validation, orphan detection, and document drift. | `_status-feed/wiki_status.json`, `_status-feed/kb_drift_status.json`. |
| `tab-fleet` | **04. IronBots Fleet** | Status of autonomous bots (Sentinel, Watchdog, Reporter, Pruner, Healer). | `_status-feed/ironbots_fleet.json`, `daemon_health.json`. |
| `tab-reporting` | **05. Weekly Retro** | Historical retrospectives, KPI trends, category health metrics, and commit volume. | `/api/reporting/retro`, `/api/reporting/history`. |
| `tab-mcp` | **06. MCP Matrix** | Health of Model Context Protocol endpoints (Headroom, IronLedger, NotebookLM). | Port 8787, Port 8000, stdio client states. |
| `tab-ops` | **07. Operations** | Scheduled task triggers, inter-stage pipelines, process runbooks, and manual triggers. | Windows Task Scheduler (`\Ironbots\`, `\KB-SYNC\`). |
| `tab-headroom` | **08. Headroom Engine** | Context compression, prompt cache optimization, and token cost savings telemetry. | `/api/reporting/headroom`, Port 8787 proxy. |
| `tab-ledger` | **09. IronLedger** | Financial balances, capital gains tax lots, bank feeds, and statement reconciliation. | Port 8000 daemon, `_status-feed/ironledger_status.json`. |
| `tab-mobile` | **10. Mobile Outbox** | Mobile push notifications, dispatch receipts, and outbox queue telemetry. | `trm-drive/inbox/outbox/`, `.trm/inbox/outbox/`. |

---

## 4. Dual-Action Execution Engine

ICF buttons feature a dual-execution model supporting both direct backend process dispatch and clipboard copy fallback.

### Live Process Execution (`runAction`)
When the dashboard is connected to the backend over HTTP/SSE:
1. Clicking an actionable button dispatches an asynchronous `POST` request to `/api/actions/run`.
2. The payload specifies the action identifier and parameters:
   ```json
   {
     "action": "run-bot",
     "script": "ironbots-daily-reporter.mjs"
   }
   ```
3. The server validates loopback origin and whitelisted script names, spawns a detached background process, and returns the operating system process ID (`pid`).
4. The dashboard UI temporarily transitions the button text to `Running... ⏳` and displays a confirmation toast containing the spawned PID (`Process dispatched (PID: 12345) · Output logged to daemon.log`).
5. After execution completes, the button label reverts to `Triggered ✓`.

### Allowed Action Whitelist
To prevent arbitrary command execution, `c:\dev\icf\src\server.mjs` enforces a strict loopback whitelist:
- `run-bot`: Executes approved bots (`ironbots-daily-reporter.mjs`, `kb-sentinel-bot.mjs`, `daemon-healer-bot.mjs`, `trm-bot-runner.mjs`, `workspace-storage-cleaner.mjs`).
- `run-task`: Dispatches configured Windows Scheduled Tasks (`\Ironbots\Ironbots-Reporter`, `\KB-SYNC\KB-Sync-Master-Pipeline`).
- `run-skill`: Triggers Toolforge skill packs via `pwsh`.
- `validate-wiki`: Dispatches automated wikilink graph validation.
- `autoheal-wiki`: Dispatches automated healing for missing forward links.

### Fallback Clipboard Copy (`copyCmd`)
Holding `Shift` while clicking, or clicking buttons designated as manual terminal commands, invokes `copyCmd(cmd, event)`. The command string copies directly to the operating system clipboard, and an amber toast confirms the copied shell syntax.

---

## 5. Scheduled Tasks Roster

All scheduled tasks execute with highest privileges (`RunLevel: Highest`) to prevent interactive credential prompts.

| Task Path and Name | Schedule / Interval | Target Script | Role |
| :--- | :--- | :--- | :--- |
| `\Ironbots\Daemon-Healer` | Every 5 minutes | `scripts/daemon-healer-bot.mjs` | Probes port 8080; auto-restarts ICF daemon if down or hung. |
| `\Ironbots\Ironbots-Reporter` | Daily 06:00 ET | `scripts/ironbots-daily-reporter.mjs` | Generates daily zero-token operations report in `_status-feed`. |
| `\Ironbots\KB-Sentinel` | Every 30 minutes | `scripts/kb-sentinel-bot.mjs` | Verifies Obsidian vault wikilink health and metadata schemas. |
| `\KB-SYNC\KB-Sync-Master-Pipeline` | Daily 06:30 ET | `kb-sync/pipeline/master-sync.mjs` | Reconciles external sources into canonical Obsidian knowledge vault. |
| `\KB-SYNC\KB-Sync-TRM-Triage` | Daily 07:00 ET | `scripts/trm-bot-runner.mjs` | Ingests pending TRM research notes and routes gap triage tickets. |
| `\Sigil\SigilMeshDaemon` | Persistent / On Logon | `scripts/run-sigil-daemon.ps1` | Superintends inter-agent message mesh protocol. |

---

## 6. Diagnostic and Runbook Procedures

### Procedure 1: Diagnose HTTP 500 or Connection Refused on Port 8080
1. Inspect running Node.js processes:
   ```powershell
   Get-Process -Name node | Select-Object Id, CPU, WorkingSet64, StartTime
   ```
2. Verify port ownership:
   ```powershell
   Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue
   ```
3. If no process is bound, inspect the daemon log:
   ```powershell
   Get-Content C:\dev\icf\daemon.log -Tail 50
   ```
4. Trigger the daemon healer:
   ```powershell
   pwsh -NoProfile -File C:\dev\icf\scripts\ensure-dashboard-server.ps1
   ```

### Procedure 2: Remediate Broken Wikilinks in Tab 03
1. Open Tab 03 (**Knowledge Base**) in the ICF dashboard.
2. Click **Run Linter** or run via command line:
   ```powershell
   cd C:\dev\kb-sync
   npm run wiki:validate
   ```
3. If unresolved stubs are detected, execute auto-heal:
   ```powershell
   npm run wiki:autoheal
   ```

### Procedure 3: Purge Browser and Backend Caches
1. In the ICF dashboard header, click **CLEAR CACHE**.
2. The browser automatically purges `localStorage`, `sessionStorage`, and dispatches `POST /api/actions/clear-cache`.
3. The page automatically reloads, pulling fresh telemetry feeds via Server-Sent Events.

---

## 7. Verification and Testing

Execute the test suite to verify server integrity and routing contracts:
```powershell
cd C:\dev\icf
node --test test/gateway.test.mjs
```
Expected result: `9 passed, 0 failed`.
