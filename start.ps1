# CC Switch Web - Startup Script (PowerShell)
# Starts both backend (Express) and frontend (Vite dev server)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Kill processes on our ports
foreach ($port in @(3120, 5210)) {
    $line = (netstat -ano 2>$null | Select-String ":$port\s" | Select-String "LISTENING")
    if ($line) {
        $procId = ($line -split '\s+')[-1]
        Write-Host "[CC Switch Web] Killing process on port $port (PID $procId)..." -ForegroundColor Yellow
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 0.5
    }
}

Write-Host "[CC Switch Web] Starting services..." -ForegroundColor Blue

# Start backend
$BackendInfo = New-Object System.Diagnostics.ProcessStartInfo
$BackendInfo.FileName = "cmd.exe"
$BackendInfo.Arguments = "/c npx tsx src/index.ts"
$BackendInfo.WorkingDirectory = "$ScriptDir\backend"
$BackendInfo.UseShellExecute = $false
$BackendProc = [System.Diagnostics.Process]::Start($BackendInfo)

Write-Host "[CC Switch Web] Starting backend on port 3120..." -ForegroundColor Blue

Start-Sleep -Seconds 2

# Start frontend
$FrontendInfo = New-Object System.Diagnostics.ProcessStartInfo
$FrontendInfo.FileName = "cmd.exe"
$FrontendInfo.Arguments = "/c npx vite --host 0.0.0.0 --port 5210"
$FrontendInfo.WorkingDirectory = "$ScriptDir\frontend"
$FrontendInfo.UseShellExecute = $false
$FrontendProc = [System.Diagnostics.Process]::Start($FrontendInfo)

Write-Host "[CC Switch Web] Backend:  http://localhost:3120" -ForegroundColor Green
Write-Host "[CC Switch Web] Frontend: http://localhost:5210" -ForegroundColor Green
Write-Host "[CC Switch Web] Press Ctrl+C to stop" -ForegroundColor Green

# Wait until user presses Ctrl+C
try {
    while (!$BackendProc.HasExited -and !$FrontendProc.HasExited) {
        Start-Sleep -Seconds 1
    }
    if ($BackendProc.HasExited) { Write-Host "[CC Switch Web] Backend stopped unexpectedly" -ForegroundColor Red }
    if ($FrontendProc.HasExited) { Write-Host "[CC Switch Web] Frontend stopped unexpectedly" -ForegroundColor Red }
}
finally {
    Write-Host "`n[CC Switch Web] Shutting down..." -ForegroundColor Blue
    if (!$BackendProc.HasExited) { & taskkill /PID $BackendProc.Id /T /F 2>$null }
    if (!$FrontendProc.HasExited) { & taskkill /PID $FrontendProc.Id /T /F 2>$null }
    Write-Host "[CC Switch Web] Stopped." -ForegroundColor Green
}
