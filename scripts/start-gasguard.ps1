$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 5567
$mainUrl = "http://localhost:$port/"

if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
  throw "ไม่พบ package.json ใน $projectRoot"
}

function Test-GasGuardServer {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-GasGuardServer)) {
  Write-Host "Starting GasGuard at port $port..." -ForegroundColor Yellow
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev' -WorkingDirectory $projectRoot -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(20)
  while (-not (Test-GasGuardServer)) {
    if ((Get-Date) -ge $deadline) {
      throw "GasGuard did not start at http://localhost:$port within 20 seconds."
    }
    Start-Sleep -Milliseconds 400
  }
}

Write-Host "GasGuard is ready. Opening the main system..." -ForegroundColor Green
Start-Process $mainUrl
