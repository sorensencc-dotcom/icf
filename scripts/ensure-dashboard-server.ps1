[CmdletBinding()]
param(
    [string]$RepoRoot = 'C:\dev\icf',
    [int]$Port = 8080,
    [int]$WaitSeconds = 15
)

$ErrorActionPreference = 'Stop'
$DashboardUrl = "http://127.0.0.1:$Port/dashboard"
$ApiUrl = "http://127.0.0.1:$Port/api/reporting/weekly-retro"
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$ServerScript = Join-Path $RepoRoot 'src\server.mjs'

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

Start-Process -FilePath $Node `
    -ArgumentList @($ServerScript) `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden

$deadline = (Get-Date).AddSeconds($WaitSeconds)
do {
    Start-Sleep -Milliseconds 500
    if (Test-Dashboard) {
        Write-Output "ICF Dashboard started and healthy: $DashboardUrl"
        exit 0
    }
} while ((Get-Date) -lt $deadline)

throw "ICF Dashboard did not become healthy within $WaitSeconds seconds: $DashboardUrl"
