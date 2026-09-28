'use strict';

// =============================================================================
// HW-4C1 & HW-4C1A FRIEND-SIDE BOARD IDENTIFICATION CONTRACT TESTS
// =============================================================================

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkgDir = path.join(root, 'tools', 'friend-board-identification');

console.log('Running HW-4C1 / HW-4C1A Friend-Side Board Identification Package contract tests...\n');

// 1. FILE EXISTENCE & STRUCTURE
const requiredFiles = [
  'detect-gasguard-board.ps1',
  'open-serial-info.ps1',
  'README-TH.md',
  'README-EN.md',
  'report-schema.json',
  'sample-report.json',
  'detect-board.cmd'
];

for (const file of requiredFiles) {
  const filePath = path.join(pkgDir, file);
  assert.ok(fs.existsSync(filePath), `Required file missing: ${file}`);
}
console.log('  [1] All required package files exist: PASS');

// 2. STATIC SAFETY INSPECTION ON POWERSHELL SCRIPT
const psContent = fs.readFileSync(path.join(pkgDir, 'detect-gasguard-board.ps1'), 'utf8');

const forbiddenCommands = [
  'erase-flash',
  'erase_flash',
  'write-flash',
  'write_flash',
  'burn-efuse',
  'burn_efuse',
  'write-mem',
  'write_mem',
  'merge-bin',
  'merge_bin',
  'Set-WiFi',
  'Get-NetIPAddress',
  'Install-Module',
  'pip install'
];

for (const cmd of forbiddenCommands) {
  assert.equal(psContent.includes(cmd), false,
    `PowerShell script must NEVER contain destructive or automated installation command: ${cmd}`);
}
console.log('  [2] PowerShell script contains NO destructive flash/efuse/install commands: PASS');

// 3. PNP IDENTIFIER HARDENING (InstanceId for Get-PnpDevice, PNPDeviceID for Win32_SerialPort)
assert.ok(psContent.includes('$dev.InstanceId'),
  'detect-gasguard-board.ps1 must use $dev.InstanceId for Get-PnpDevice identification');
assert.ok(psContent.includes('$cp.PNPDeviceID'),
  'detect-gasguard-board.ps1 must use $cp.PNPDeviceID for Win32_SerialPort fallback');
console.log('  [3] PnP device identifier uses InstanceId for Get-PnpDevice and PNPDeviceID for Win32_SerialPort: PASS');

// 4. SAFE CANDIDATE SELECTION & AMBIGUITY HANDLING
assert.ok(psContent.includes('AMBIGUOUS_DEVICE_SELECTION'),
  'detect-gasguard-board.ps1 must report AMBIGUOUS_DEVICE_SELECTION on multiple candidate ports');
assert.ok(psContent.includes('UNIQUE_CANDIDATE'),
  'detect-gasguard-board.ps1 must require UNIQUE_CANDIDATE to run esptool');
assert.ok(psContent.includes('DRIVER_OR_USB_DATA_PATH_REVIEW_REQUIRED'),
  'detect-gasguard-board.ps1 must report DRIVER_OR_USB_DATA_PATH_REVIEW_REQUIRED when PnP bridge has no COM port');
console.log('  [4] Safe candidate selection & ambiguity handling enforced: PASS');

// 5. ESPTOOL DISCOVERY & NON-DESTRUCTIVE COMMAND SELECTION
assert.ok(psContent.includes('py -m esptool'), 'esptool discovery must include py -m esptool');
assert.ok(psContent.includes('flash-id'), 'esptool must support current flash-id command syntax');
assert.ok(psContent.includes('flash_id'), 'esptool must allow legacy flash_id command compatibility');
console.log('  [5] esptool discovery order & safe flash-id / flash_id syntax supported: PASS');

// 6. SERIAL MONITOR HELPER HARDENING
const serialPsContent = fs.readFileSync(path.join(pkgDir, 'open-serial-info.ps1'), 'utf8');
assert.ok(serialPsContent.includes('MULTIPLE COM PORTS DETECTED'),
  'open-serial-info.ps1 must reject ambiguous automatic selection when multiple ports exist');
assert.ok(serialPsContent.includes('Single active COM port detected'),
  'open-serial-info.ps1 may select single active port automatically');
console.log('  [6] Serial monitor helper refuses ambiguous COM selection: PASS');

// 7. SAMPLE REPORT & SCHEMA FIELD NAMING CONSISTENCY
const sampleReport = JSON.parse(fs.readFileSync(path.join(pkgDir, 'sample-report.json'), 'utf8'));
const reportSchema = JSON.parse(fs.readFileSync(path.join(pkgDir, 'report-schema.json'), 'utf8'));

assert.ok(sampleReport.detectionStatus, 'Sample report must contain detectionStatus');
assert.equal(sampleReport.serialPorts[0].deviceUid, undefined, 'serialPorts must NOT use deviceUid');
assert.ok(sampleReport.serialPorts[0].comPort, 'serialPorts must use comPort');
assert.ok(sampleReport.serialPorts[0].pnpDeviceId, 'serialPorts must use pnpDeviceId');

assert.equal(sampleReport.board.exactModel, 'NOT_CONFIRMED', 'exactModel must remain NOT_CONFIRMED');
assert.equal(sampleReport.board.fqbn, 'NOT_CONFIRMED', 'fqbn must remain NOT_CONFIRMED');
assert.equal(sampleReport.board.secondSensorModel, 'NOT_CONFIRMED', 'secondSensorModel must remain NOT_CONFIRMED');
console.log('  [7] Sample report field naming matches generated report schema & maintains NOT_CONFIRMED status: PASS');

// 8. REPORT PRIVACY COMPLIANCE
const sampleStr = JSON.stringify(sampleReport);
assert.equal(sampleStr.includes('wifi'), false, 'Report must not collect Wi-Fi credentials');
assert.equal(sampleStr.includes('password'), false, 'Report must not collect passwords');
assert.equal(sampleStr.includes('serviceRoleKey'), false, 'Report must not collect Supabase secrets');
console.log('  [8] Report contains NO Wi-Fi or secret credentials: PASS');

// 9. ELECTRICAL SAFETY & AMBIGUITY GUIDANCE IN READMES
const readmeTh = fs.readFileSync(path.join(pkgDir, 'README-TH.md'), 'utf8');
const readmeEn = fs.readFileSync(path.join(pkgDir, 'README-EN.md'), 'utf8');

assert.ok(readmeTh.includes('USB'), 'README-TH must mention USB connection');
assert.ok(readmeTh.includes('ถอดอุปกรณ์เสริมทั้งหมดออก'), 'README-TH must instruct disconnecting sensors/relays');
assert.ok(readmeTh.includes('AMBIGUOUS_DEVICE_SELECTION'), 'README-TH must explain AMBIGUOUS_DEVICE_SELECTION resolution');
assert.ok(readmeEn.includes('Bare ESP32 USB Connection Only'), 'README-EN must instruct bare ESP32 USB connection');
assert.ok(readmeEn.includes('AMBIGUOUS_DEVICE_SELECTION'), 'README-EN must explain AMBIGUOUS_DEVICE_SELECTION resolution');
console.log('  [9] Electrical safety & AMBIGUOUS_DEVICE_SELECTION troubleshooting in TH/EN READMEs: PASS');

// 10. NO FIRMWARE BINARIES CREATED IN THIS CHECKPOINT
const firmwareBins = ['firmware.bin', 'bootloader.bin', 'partitions.bin', 'merged.bin'];
for (const bin of firmwareBins) {
  assert.equal(fs.existsSync(path.join(pkgDir, bin)), false, `Firmware binary ${bin} must NOT exist in HW-4C1/HW-4C1A`);
}
console.log('  [10] No firmware binary created in HW-4C1A: PASS');

console.log('\nALL HW-4C1 / HW-4C1A FRIEND-SIDE BOARD IDENTIFICATION HARDENING TESTS PASSED!');
