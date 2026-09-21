[CmdletBinding()]
param(
    [string]$RepoRoot = 'C:\dev\icf',
    [int]$Port = 8080,
    [string]$BindHost = '',
    [int]$WaitSeconds = 15
)

$ErrorActionPreference = 'Stop'
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$ServerScript = Join-Path $RepoRoot 'src\server.mjs'

if ([string]::IsNullOrWhiteSpace($BindHost)) { $BindHost = (tailscale ip -4 2>$null | Select-Object -First 1).Trim() }
if ([string]::IsNullOrWhiteSpace($BindHost)) { throw 'Tailscale IPv4 address unavailable; start Tailscale before starting ICF.' }
$DashboardUrl = "http://$BindHost`:$Port/dashboard"
$ApiUrl = "http://$BindHost`:$Port/api/reporting/weekly-retro"
$env:PORT = [string]$Port
$env:ICF_HOST = $BindHost

function Test-Dashboard {
    try {
        $response = Invoke-WebRequest -Uri $DashboardUrl -UseBasicParsing -TimeoutSec 3
        $api = Invoke-WebRequest -Uri $ApiUrl -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -eq 200 -and $api.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (Test-Dashboard) {
    Write-Output "ICF Dashboard already healthy: $DashboardUrl"
    exit 0
}

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)"
        if ($process.CommandLine -like '*http-server*' -or $process.CommandLine -like '*dashboard-server.py*' -or $process.CommandLine -like '*server.mjs*') {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }

if (-not (Test-Path -LiteralPath $ServerScript -PathType Leaf)) {
    throw "ICF Dashboard server script not found: $ServerScript"
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Node
$psi.Arguments = "`"$ServerScript`""
$psi.WorkingDirectory = $RepoRoot
$psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$psi.UseShellExecute = $true
[System.Diagnostics.Process]::Start($psi) | Out-Null

$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
    Start-Sleep -Milliseconds 500
    if (Test-Dashboard) {
        Write-Output "ICF Dashboard started and healthy: $DashboardUrl"
        exit 0
    }
} while ((Get-Date) -lt $deadline)

throw "ICF Dashboard did not become healthy within $WaitSeconds seconds: $DashboardUrl"
