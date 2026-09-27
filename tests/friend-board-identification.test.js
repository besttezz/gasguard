'use strict';

// =============================================================================
// HW-4C1 FRIEND-SIDE BOARD IDENTIFICATION PACKAGE CONTRACT TESTS
// =============================================================================

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkgDir = path.join(root, 'tools', 'friend-board-identification');

console.log('Running HW-4C1 Friend-Side Board Identification Package contract tests...\n');

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
  'write-flash',
  'burn-efuse',
  'write-mem',
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

// 3. BOARD TRUTH AND UNCONFIRMED IDENTITY
const sampleReport = JSON.parse(fs.readFileSync(path.join(pkgDir, 'sample-report.json'), 'utf8'));
assert.equal(sampleReport.board.exactModel, 'NOT_CONFIRMED', 'exactModel must remain NOT_CONFIRMED');
assert.equal(sampleReport.board.fqbn, 'NOT_CONFIRMED', 'fqbn must remain NOT_CONFIRMED');
assert.equal(sampleReport.board.secondSensorModel, 'NOT_CONFIRMED', 'secondSensorModel must remain NOT_CONFIRMED');
console.log('  [3] Report schema preserves NOT_CONFIRMED status for exactModel/FQBN/secondSensor: PASS');

// 4. REPORT PRIVACY COMPLIANCE
const sampleStr = JSON.stringify(sampleReport);
assert.equal(sampleStr.includes('wifi'), false, 'Report must not collect Wi-Fi credentials');
assert.equal(sampleStr.includes('password'), false, 'Report must not collect passwords');
assert.equal(sampleStr.includes('serviceRoleKey'), false, 'Report must not collect Supabase secrets');
console.log('  [4] Report contains NO Wi-Fi or secret credentials: PASS');

// 5. ELECTRICAL SAFETY DOCUMENTED IN READMES
const readmeTh = fs.readFileSync(path.join(pkgDir, 'README-TH.md'), 'utf8');
const readmeEn = fs.readFileSync(path.join(pkgDir, 'README-EN.md'), 'utf8');

assert.ok(readmeTh.includes('USB'), 'README-TH must mention USB connection');
assert.ok(readmeTh.includes('ถอดอุปกรณ์เสริมทั้งหมดออก'), 'README-TH must instruct disconnecting sensors/relays');
assert.ok(readmeEn.includes('Bare ESP32 USB Connection Only'), 'README-EN must instruct bare ESP32 USB connection');
console.log('  [5] Electrical safety & USB-only requirement documented in TH/EN READMEs: PASS');

// 6. NO FIRMWARE BINARIES CREATED IN THIS CHECKPOINT
const firmwareBins = ['firmware.bin', 'bootloader.bin', 'partitions.bin', 'merged.bin'];
for (const bin of firmwareBins) {
  assert.equal(fs.existsSync(path.join(pkgDir, bin)), false, `Firmware binary ${bin} must NOT exist in HW-4C1`);
}
console.log('  [6] No firmware binary created in HW-4C1: PASS');

console.log('\nALL HW-4C1 FRIEND-SIDE BOARD IDENTIFICATION PACKAGE CONTRACT TESTS PASSED!');
