<!--
title: "Operations Guide"
status: active
owner: chris
last-reviewed: 2026-09-27
brand: hybrid
hybrid-primary: icf
hybrid-secondary: cic
-->

# Operations Guide

This guide details operating procedures for running, supervising, and verifying Iron Command Forge (ICF).

---

## Server management

### Manual startup
To start the standalone ICF server in the foreground, run:
```powershell
npm run start
```
The server binds to `127.0.0.1:8080`.

### Daemon watchdog
To probe the server and start it in the background if uncontactable, run:
```powershell
pwsh -NoProfile -File C:\dev\icf\scripts\ensure-dashboard-server.ps1
```

### Scheduled Task registration
To register the `ICF-Dashboard-Server` task in Windows Task Scheduler, run:
```powershell
pwsh -NoProfile -File C:\dev\icf\scripts\register-dashboard-server-task.ps1
```

---

## Testing and validation

### Automated test execution
To run all 84 test suites (83 reporting unit tests + 1 gateway security test), run:
```powershell
npm test
```

### Repository preflight validation
To verify repository structure, Git branch, and manifest integrity, run:
```powershell
pwsh -NoProfile -File C:\dev\scripts\verify-repo-context.ps1 -Path C:\dev\icf
```
Expected output: `PREFLIGHT_PASS`.
