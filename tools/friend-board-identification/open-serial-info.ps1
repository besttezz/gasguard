# PowerShell script for friend-side serial monitor
param(
    [string]$Port = "",
    [int]$BaudRate = 115200
)

Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host "GasGuard ESP32 Serial Monitor Helper (READ-ONLY)" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan

if ([string]::IsNullOrWhiteSpace($Port)) {
    [array]$ports = [System.IO.Ports.SerialPort]::GetPortNames()
    if ($ports.Count -eq 0) {
        Write-Host "No active COM ports detected!" -ForegroundColor Red
        exit 1
    } elseif ($ports.Count -eq 1) {
        $Port = $ports[0]
        Write-Host "Single active COM port detected: $Port" -ForegroundColor Green
    } else {
        Write-Host "MULTIPLE COM PORTS DETECTED ($($ports.Count)):" -ForegroundColor Yellow
        foreach ($p in $ports) {
            Write-Host "  - $p" -ForegroundColor White
        }
        Write-Host "`nPlease specify the target port explicitly, e.g.:" -ForegroundColor Red
        Write-Host "  .\open-serial-info.ps1 -Port $($ports[0])" -ForegroundColor White
        exit 1
    }
}

Write-Host "Opening $Port at $BaudRate baud (Press Ctrl+C to stop)...`n" -ForegroundColor Green

try {
    $sp = New-Object System.IO.Ports.SerialPort $Port, $BaudRate, None, 8, One
    $sp.Open()
    while ($sp.IsOpen) {
        if ($sp.BytesToRead -gt 0) {
            $data = $sp.ReadExisting()
            Write-Host -NoNewline $data
        }
        Start-Sleep -Milliseconds 50
    }
} catch {
    Write-Host "Error accessing serial port: $_" -ForegroundColor Red
} finally {
    if ($sp -and $sp.IsOpen) {
        $sp.Close()
    }
}
