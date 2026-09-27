# =============================================================================
# GasGuard ESP32 Friend-Side Board Identification Tool
# =============================================================================
# Non-destructive Windows PowerShell script for detecting USB/COM parameters,
# checking esptool availability, and generating a redacted report bundle.
# =============================================================================

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host " GasGuard ESP32 Friend-Side Board Identification Package (HW-4C1)" -ForegroundColor Cyan
Write-Host "=======================================================================" -ForegroundColor Cyan
Write-Host ""

# Function to extract USB VID/PID from PNPDeviceID string
function Parse-VidPid([string]$pnpId) {
    $vid = $null
    $pid = $null
    if ($pnpId -match "VID_([0-9A-Fa-f]{4})") { $vid = $Matches[1].ToUpper() }
    if ($pnpId -match "PID_([0-9A-Fa-f]{4})") { $pid = $Matches[1].ToUpper() }
    return @{ VID = $vid; PID = $pid }
}

# Function to classify USB-UART bridge from VID/PID
function Classify-UsbBridge([string]$vid, [string]$pid) {
    if ($vid -eq "10C4" -and $pid -eq "EA60") { return "CP210X" }
    if ($vid -eq "1A86" -and ($pid -eq "7523" -or $pid -eq "5523" -or $pid -eq "7522")) { return "CH340_CH341" }
    if ($vid -eq "0403" -and ($pid -eq "6001" -or $pid -eq "6015")) { return "FTDI" }
    if ($vid -eq "303A" -and ($pid -eq "1001" -or $pid -eq "0002")) { return "ESPRESSIF_USB_JTAG_SERIAL" }
    return "UNKNOWN"
}

# Function to list current COM devices
function Get-GasGuardComDevices() {
    [array]$devices = @()
    try {
        $pnpPorts = Get-PnpDevice -Class "Ports" -ErrorAction SilentlyContinue | Where-Object { $_.Present -eq $true }
        if ($pnpPorts) {
            foreach ($dev in $pnpPorts) {
                $name = $dev.FriendlyName
                $comPort = $null
                if ($name -match "\((COM\d+)\)") { $comPort = $Matches[1] }
                $vidpid = Parse-VidPid $dev.PNPDeviceID
                $devices += [PSCustomObject]@{
                    comPort                 = $comPort
                    friendlyName            = $name
                    pnpDeviceId             = $dev.PNPDeviceID
                    vid                     = $vidpid.VID
                    pid                     = $vidpid.PID
                    usbBridgeClassification = (Classify-UsbBridge $vidpid.VID $vidpid.PID)
                }
            }
        }
    } catch {
        # Fallback if Get-PnpDevice is not available
    }

    if ($devices.Count -eq 0) {
        try {
            $cimPorts = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue
            if ($cimPorts) {
                foreach ($cp in $cimPorts) {
                    $vidpid = Parse-VidPid $cp.PNPDeviceID
                    $devices += [PSCustomObject]@{
                        comPort                 = $cp.DeviceID
                        friendlyName            = $cp.Name
                        pnpDeviceId             = $cp.PNPDeviceID
                        vid                     = $vidpid.VID
                        pid                     = $vidpid.PID
                        usbBridgeClassification = (Classify-UsbBridge $vidpid.VID $vidpid.PID)
                    }
                }
            }
        } catch {}
    }
    return [array]$devices
}

# -----------------------------------------------------------------------------
# STEP 1: BEFORE / AFTER DETECTION PROMPT
# -----------------------------------------------------------------------------
Write-Host "STEP 1: Initial System Scan" -ForegroundColor Yellow
$initialDevices = Get-GasGuardComDevices
Write-Host "Found $($initialDevices.Count) COM device(s) currently connected." -ForegroundColor Gray
foreach ($d in $initialDevices) {
    Write-Host "  - $($d.comPort): $($d.friendlyName) [VID:$($d.vid) PID:$($d.pid)]" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Do you want to perform a BEFORE/AFTER comparison to detect newly plugged ESP32?" -ForegroundColor Cyan
Write-Host "If you haven't plugged in your ESP32 yet, type 'Y', press Enter, plug in the ESP32 USB, then press Enter again." -ForegroundColor Gray
$response = Read-Host "Perform before/after scan? (Y/n)"

$newDevices = @()
if ($response -eq "" -or $response -like "y*") {
    Write-Host ""
    Write-Host ">> Please connect your ESP32 board via USB cable now." -ForegroundColor Green
    $null = Read-Host ">> Press ENTER after plugging in the ESP32 USB cable..."
    
    $afterDevices = Get-GasGuardComDevices
    foreach ($ad in $afterDevices) {
        $isExisting = $false
        foreach ($id in $initialDevices) {
            if ($id.pnpDeviceId -eq $ad.pnpDeviceId) { $isExisting = $true; break }
        }
        if (-not $isExisting) {
            $newDevices += $ad
        }
    }
}

# -----------------------------------------------------------------------------
# STEP 2: SELECT CANDIDATE DEVICE
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "STEP 2: Evaluating Device Candidates" -ForegroundColor Yellow

$allDevices = Get-GasGuardComDevices
$selectedCandidate = $null

if ($newDevices.Count -gt 0) {
    $selectedCandidate = $newDevices[0]
    Write-Host "NEW DEVICE CANDIDATE DETECTED:" -ForegroundColor Green
    Write-Host "  Port: $($selectedCandidate.comPort)" -ForegroundColor White
    Write-Host "  Name: $($selectedCandidate.friendlyName)" -ForegroundColor White
    Write-Host "  Bridge: $($selectedCandidate.usbBridgeClassification) (VID:$($selectedCandidate.vid) PID:$($selectedCandidate.pid))" -ForegroundColor White
} elseif ($allDevices.Count -eq 1) {
    $selectedCandidate = $allDevices[0]
    Write-Host "SINGLE COM DEVICE DETECTED:" -ForegroundColor Green
    Write-Host "  Port: $($selectedCandidate.comPort)" -ForegroundColor White
    Write-Host "  Name: $($selectedCandidate.friendlyName)" -ForegroundColor White
    Write-Host "  Bridge: $($selectedCandidate.usbBridgeClassification)" -ForegroundColor White
} elseif ($allDevices.Count -gt 1) {
    $selectedCandidate = $allDevices[0]
    Write-Host "MULTIPLE COM DEVICES FOUND ($($allDevices.Count)). Selecting first port: $($selectedCandidate.comPort)" -ForegroundColor Yellow
} else {
    Write-Host "NO COM PORTS DETECTED!" -ForegroundColor Red
    Write-Host "  Possible causes:" -ForegroundColor Red
    Write-Host "    1. USB cable is CHARGE-ONLY (does not have data lines)." -ForegroundColor Red
    Write-Host "    2. USB driver is missing for VID/PID bridge chip." -ForegroundColor Red
    Write-Host "    3. Board is not powered on or USB port issue." -ForegroundColor Red
}

# -----------------------------------------------------------------------------
# STEP 3: ESPTOOL DISCOVERY & NON-DESTRUCTIVE IDENTIFICATION
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "STEP 3: Checking esptool Availability (NON-DESTRUCTIVE)" -ForegroundColor Yellow

$esptoolAvailable = $false
$esptoolVersion = $null
$esptoolCmd = $null
$chipFamily = $null
$chipRevision = $null
$deviceMac = $null
$flashId = $null
$flashSize = $null

# Check for esptool executable or python module without installing anything
if (Get-Command "esptool" -ErrorAction SilentlyContinue) {
    $esptoolAvailable = $true
    $esptoolCmd = "esptool"
} elseif (Get-Command "esptool.py" -ErrorAction SilentlyContinue) {
    $esptoolAvailable = $true
    $esptoolCmd = "esptool.py"
} else {
    try {
        $pyVer = & python -m esptool version 2>&1
        if ($LASTEXITCODE -eq 0) {
            $esptoolAvailable = $true
            $esptoolCmd = "python -m esptool"
        }
    } catch {}
}

if ($esptoolAvailable) {
    try {
        if ($esptoolCmd -eq "python -m esptool") {
            $vOut = & python -m esptool version 2>&1
        } else {
            $vOut = & $esptoolCmd version 2>&1
        }
        $esptoolVersion = ($vOut | Out-String).Trim()
        Write-Host "Found esptool version: $esptoolVersion" -ForegroundColor Green

        if ($selectedCandidate -and $selectedCandidate.comPort) {
            Write-Host "Running NON-DESTRUCTIVE esptool chip_id / flash_id query on $($selectedCandidate.comPort)..." -ForegroundColor Gray
            
            # Execute flash_id query (safe, non-destructive read)
            $flashOut = $null
            if ($esptoolCmd -eq "python -m esptool") {
                $flashOut = & python -m esptool --port $($selectedCandidate.comPort) flash_id 2>&1
            } else {
                $flashOut = & $esptoolCmd --port $($selectedCandidate.comPort) flash_id 2>&1
            }
            $flashStr = $flashOut | Out-String

            if ($flashStr -match "Detecting chip type\.\.\.\s*([^\r\n]+)") { $chipFamily = $Matches[1].Trim() }
            if ($flashStr -match "Chip is\s*([^\r\n]+)") { $chipFamily = $Matches[1].Trim() }
            if ($flashStr -match "MAC:\s*([0-9a-fa-f:]+)") { $deviceMac = $Matches[1].ToUpper() }
            if ($flashStr -match "Manufacturer:\s*([^\r\n]+)") { $flashId = $Matches[1].Trim() }
            if ($flashStr -match "Detected flash size:\s*([^\r\n]+)") { $flashSize = $Matches[1].Trim() }
            
            Write-Host "  Detected Chip: $chipFamily" -ForegroundColor White
            Write-Host "  Device MAC:    $deviceMac" -ForegroundColor White
            Write-Host "  Flash Size:    $flashSize" -ForegroundColor White
        }
    } catch {
        Write-Host "esptool query failed or port busy: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "esptool is not installed on this PC. Skipping chip memory query (Safe)." -ForegroundColor Gray
}

# -----------------------------------------------------------------------------
# STEP 4: GENERATE REPORTS
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "STEP 4: Generating Evidence Bundle Reports" -ForegroundColor Yellow

$osInfo = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$reportData = [PSCustomObject]@{
    schema = "gasguard.board-identification.v1"
    capturedAt = $timestamp
    os = [PSCustomObject]@{
        caption = if ($osInfo) { $osInfo.Caption } else { "Microsoft Windows" }
        version = if ($osInfo) { $osInfo.Version } else { $null }
        psVersion = $PSVersionTable.PSVersion.ToString()
    }
    serialPorts = $allDevices
    usbCandidates = if ($newDevices.Count -gt 0) { $newDevices } else { $allDevices }
    selectedCandidate = [PSCustomObject]@{
        comPort = if ($selectedCandidate) { $selectedCandidate.comPort } else { $null }
        vid = if ($selectedCandidate) { $selectedCandidate.vid } else { $null }
        pid = if ($selectedCandidate) { $selectedCandidate.pid } else { $null }
        friendlyName = if ($selectedCandidate) { $selectedCandidate.friendlyName } else { $null }
        usbBridgeClassification = if ($selectedCandidate) { $selectedCandidate.usbBridgeClassification } else { "UNKNOWN" }
    }
    esptool = [PSCustomObject]@{
        available = $esptoolAvailable
        version = $esptoolVersion
        chipFamily = $chipFamily
        chipRevision = $chipRevision
        deviceMac = $deviceMac
        flashId = $flashId
        flashSize = $flashSize
    }
    board = [PSCustomObject]@{
        exactModel = "NOT_CONFIRMED"
        fqbn = "NOT_CONFIRMED"
        secondSensorModel = "NOT_CONFIRMED"
    }
    nextEvidenceRequired = @(
        "FRONT_BOARD_PHOTO",
        "BACK_BOARD_PHOTO",
        "RF_MODULE_TEXT_PHOTO",
        "USB_BRIDGE_CHIP_PHOTO",
        "PIN_LABEL_PHOTO",
        "SENSOR_MODULE_PHOTO"
    )
}

# Save JSON report
$jsonPath = Join-Path $PSScriptRoot "gasguard-board-report.json"
$reportData | ConvertTo-Json -Depth 5 | Out-File -FilePath $jsonPath -Encoding utf8

# Save Text report
$txtPath = Join-Path $PSScriptRoot "gasguard-board-report.txt"
$txtContent = @"
===============================================================================
 GASGUARD ESP32 BOARD IDENTIFICATION REPORT (HW-4C1)
===============================================================================
Captured At: $timestamp
OS: $($reportData.os.caption) (Build $($reportData.os.version))
PowerShell Version: $($reportData.os.psVersion)

-------------------------------------------------------------------------------
1. USB / SERIAL PORT DETECTION
-------------------------------------------------------------------------------
Selected COM Port: $($reportData.selectedCandidate.comPort)
Device Name:       $($reportData.selectedCandidate.friendlyName)
USB VID:           $($reportData.selectedCandidate.vid)
USB PID:           $($reportData.selectedCandidate.pid)
Bridge Class:      $($reportData.selectedCandidate.usbBridgeClassification)

-------------------------------------------------------------------------------
2. ESPTOOL STATUS
-------------------------------------------------------------------------------
esptool Available: $($reportData.esptool.available)
esptool Version:   $($reportData.esptool.version)
Detected Chip:     $($reportData.esptool.chipFamily)
Device MAC:        $($reportData.esptool.deviceMac)
Flash ID:          $($reportData.esptool.flashId)
Flash Size:        $($reportData.esptool.flashSize)

-------------------------------------------------------------------------------
3. BOARD IDENTITY & TOOLCHAIN LOCK STATUS
-------------------------------------------------------------------------------
Exact Board Model: $($reportData.board.exactModel)
Arduino FQBN:      $($reportData.board.fqbn)
Second Sensor:     $($reportData.board.secondSensorModel)

-------------------------------------------------------------------------------
4. REQUIRED PHYSICAL EVIDENCE (SEND TO GASGUARD TEAM)
-------------------------------------------------------------------------------
[ ] 1. gasguard-board-report.txt & gasguard-board-report.json
[ ] 2. Front Photo of ESP32 Board
[ ] 3. Back Photo of ESP32 Board
[ ] 4. Close-up Photo of Metal RF Module Text (e.g. ESP-WROOM-32)
[ ] 5. Close-up Photo of USB-UART Chip (e.g. CP2102, CH340G)
[ ] 6. Close-up Photo of Header Pin Labels
[ ] 7. Photo of Second Sensor Module Markings (MQ-3 vs MQ-2)
===============================================================================
"@
$txtContent | Out-File -FilePath $txtPath -Encoding utf8

Write-Host "Generated Report Files:" -ForegroundColor Green
Write-Host "  1. $txtPath" -ForegroundColor White
Write-Host "  2. $jsonPath" -ForegroundColor White
Write-Host ""
Write-Host "Please send BOTH report files and photographs back to the GasGuard engineering team." -ForegroundColor Cyan
