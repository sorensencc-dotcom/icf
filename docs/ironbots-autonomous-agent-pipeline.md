# Ironbots autonomous agent pipeline & policy

Ironbots is the background automated robot subsystem operating within Toolforge and supervised by the Iron Command Forge (ICF) telemetry aggregator.

![Ironbots Autonomous Architecture](ironbots-architecture-diagram.png)

<details>
<summary>Mermaid source...</summary>

```mermaid
flowchart TD
    subgraph Scheduler["1. Task Scheduler & Triggers"]
        A["Windows Task Scheduler (\Ironbots\)"]
        B["Manual / CI Invocation (npm run bot:all)"]
        C["Agent Status Probing (<100 tokens)"]
        P["Fleet Engineering Policy Contract"]
    end

    subgraph Engines["2. Autonomous Bot Fleet"]
        D["KB-Sentinel Bot (Daily 03:00 AM)\nscripts/kb-sentinel-bot.mjs"]
        E["TRM-Bot (Daily 04:00 AM)\nscripts/trm-bot-runner.mjs"]
        K["Daemon-Healer Bot (Every 15 Min)\nscripts/daemon-healer-bot.mjs"]
        L["CI-Watchdog Bot (Hourly / 06:00 AM)\nscripts/ci-watchdog-bot.mjs"]
    end

    subgraph Targets["3. Knowledge Base & Telemetry"]
        F["Wiki Frontmatter & Link Autoheal"]
        G["RFC Decision Notes (wiki/research/rfc-gap-*.md)"]
        M["Port 8080 Process Recovery & Uptime"]
        N["CI Failure Detection & Error Logs"]
        I["Telemetry Hub (_status-feed/*.json)"]
        J["Iron Command Forge (ICF Snapshot Store)"]
    end

    A -->|Daily 03:00 AM| D
    A -->|Daily 04:00 AM| E
    A -->|Every 15 Min| K
    A -->|Hourly 06:00 AM| L

    B --> D
    B --> E
    B --> K
    B --> L

    D --> F
    D --> I
    E --> G
    E --> I
    K --> M
    K --> I
    L --> N
    L --> I
    I --> J
    I -.-> C
```

</details>

---

## Ironbots fleet engineering policy

All background automation bots added to the `\Ironbots\` fleet must adhere to these four core rules:

1. **Unattended execution (S4U)**:
   - Must provide a dedicated PowerShell scheduled task wrapper under `\Ironbots\`.
   - Must support Service-for-User (`-LogonType S4U`) so tasks run continuously when the user is logged out.
2. **Zero token footprint**:
   - Heavy parsing, regex linting, link checking, process recovery, and CI log scraping must execute deterministically on the host CPU with 0 LLM tokens.
3. **Structured JSON telemetry**:
   - Must emit telemetry to `_status-feed/` for consumption by ICF and conversational agents.
4. **Paired regression testing**:
   - Must be verified in `tests/ironbots.test.mjs` to satisfy the repository's Delivery Guard CI governance policy.

---

## Active bot roster & schedules

| Bot Name | Script Entrypoint | Schedule | Task Category | Primary Telemetry Artifact |
|---|---|---|---|---|
| **KB-Sentinel** | `scripts/kb-sentinel-bot.mjs` | Daily 03:00 AM | `\Ironbots\` | `_status-feed/kb_sentinel_report.json` |
| **TRM-Bot** | `scripts/trm-bot-runner.mjs` | Daily 04:00 AM | `\Ironbots\` | `_status-feed/trm_bot_report.json` |
| **Daemon-Healer** | `scripts/daemon-healer-bot.mjs` | Every 15 Minutes | `\Ironbots\` | `_status-feed/daemon_health.json` |
| **CI-Watchdog** | `scripts/ci-watchdog-bot.mjs` | Daily 06:00 AM | `\Ironbots\` | `_status-feed/ci_alerts.json` |

---

## Operational commands

### Synchronous execution
```bash
# Run entire fleet
npm run bot:all

# Run individual bots
npm run bot:kb:sentinel
npm run bot:trm:triage
npm run bot:daemon:heal
npm run bot:ci:watchdog
```

### Windows Task Scheduler administration
```powershell
# View all registered Ironbots tasks
Get-ScheduledTask -TaskPath "\Ironbots\"

# Upgrade all tasks to Unattended S4U Mode (Run in Administrator PowerShell)
pwsh -NoProfile -File scripts/schedule-task-wrapper-KB-Sentinel.ps1 -Action Register -Unattended -Force
pwsh -NoProfile -File scripts/schedule-task-wrapper-TRM-Bot.ps1 -Action Register -Unattended -Force
pwsh -NoProfile -File scripts/schedule-task-wrapper-Daemon-Healer.ps1 -Action Register -Unattended -Force
pwsh -NoProfile -File scripts/schedule-task-wrapper-CI-Watchdog.ps1 -Action Register -Unattended -Force
```
