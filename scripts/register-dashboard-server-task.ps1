[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$List,
    [string]$RepoRoot = 'C:\dev\icf',
    [string]$TaskName = 'ICF-Dashboard-Server',
    [int]$Port = 8081
)

$ErrorActionPreference = 'Stop'
$ScriptPath = Join-Path $RepoRoot 'scripts\ensure-dashboard-server.ps1'

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "Watchdog script not found: $ScriptPath"
}

if ($List) {
    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue |
        Format-List TaskName, State, Author, Description
    exit 0
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Removed scheduled task: $TaskName"
    exit 0
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -RepoRoot `"$RepoRoot`" -Port $Port"
$triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -AtLogOn)
)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Keeps the Iron Command Forge (ICF) dashboard available on the Tailscale address at port $Port." `
    -Force `
    -ErrorAction Stop | Out-Null

Write-Output "Registered scheduled task: $TaskName"
