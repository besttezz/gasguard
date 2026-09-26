'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../server/esp32-field-contract.js');

const root = path.resolve(__dirname, '..');
const fieldNodeDir = path.join(root, 'firmware', 'esp32-field-node');

// 1. Verify firmware directory structure and files exist
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'README.md')), 'README.md must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'board_config.h')), 'board_config.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'sensor_config.h')), 'sensor_config.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'sensor_config.cpp')), 'sensor_config.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'measurement.h')), 'measurement.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'measurement.cpp')), 'measurement.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'telemetry.h')), 'telemetry.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'telemetry.cpp')), 'telemetry.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'network_provisioning.h')), 'network_provisioning.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'network_provisioning.cpp')), 'network_provisioning.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'transport.h')), 'transport.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'transport.cpp')), 'transport.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'diagnostics.h')), 'diagnostics.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'diagnostics.cpp')), 'diagnostics.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'esp32-field-node.ino')), 'esp32-field-node.ino must exist');

// 2. Existing handshake firmware remains available
assert.ok(fs.existsSync(path.join(root, 'firmware', 'esp32-handshake', 'esp32-handshake.ino')), 'handshake firmware must remain available as reference tool');

// 3. Sensor roles contract verification
const mq6Desc = contract.createSensorDescriptor({
  sensorId: 'MQ6-01',
  sensorType: 'MQ6',
  role: contract.SENSOR_ROLES.PRIMARY_LPG_SENSOR,
  pin: 34,
  inputScale: 1.5
});
assert.equal(mq6Desc.role, 'PRIMARY_LPG_SENSOR', 'MQ-6 must be primary LPG channel');

const mq3Desc = contract.createSensorDescriptor({
  sensorId: 'MQ3-01',
  sensorType: 'MQ3',
  role: contract.SENSOR_ROLES.AUXILIARY_CONTEXT_SENSOR,
  pin: 35,
  inputScale: 1.5
});
assert.equal(mq3Desc.role, 'AUXILIARY_CONTEXT_SENSOR', 'MQ-3 must be auxiliary context channel');
assert.notEqual(mq6Desc.role, mq3Desc.role, 'MQ-3 and MQ-6 roles must remain distinct');

// 4. Raw-only produces CALIBRATION_REQUIRED and no invented ppm
const reading6 = contract.processUncalibratedReading(mq6Desc, 2048);
assert.equal(reading6.calibrationStatus, 'CALIBRATION_REQUIRED');
assert.equal(reading6.calibratedPpm, null, 'Uncalibrated reading must not invent ppm value');
assert.equal(reading6.confidence, null, 'Uncalibrated reading must not invent confidence score');
assert.ok(reading6.sensorVoltage > 0 && reading6.inputAdjustedVoltage > reading6.sensorVoltage, 'voltage divider scale applied');

// 5. Invalid pin configuration rejected (must be ADC1 pins 32..39)
assert.throws(
  () => contract.createSensorDescriptor({ sensorId: 'MQ6-01', sensorType: 'MQ6', role: contract.SENSOR_ROLES.PRIMARY_LPG_SENSOR, pin: 15 }), // GPIO 15 is not ADC1
  /ADC1 pin/,
  'non-ADC1 pin configuration must be rejected'
);

// 6. Telemetry payload contract (gasguard.telemetry.v1.1)
const payload = contract.formatTelemetryPayload({
  deviceId: 'ESP32-KITCHEN-01',
  reading: reading6,
  bootId: 'boot-xyz-123',
  sequence: 42,
  timestamp: '2026-09-26T16:00:00Z'
});

assert.equal(payload.schemaVersion, 'gasguard.telemetry.v1.1');
assert.equal(payload.deviceId, 'ESP32-KITCHEN-01');
assert.equal(payload.sensorId, 'MQ6-01');
assert.equal(payload.bootId, 'boot-xyz-123');
assert.equal(payload.sequence, 42);
assert.equal(payload.raw.calibrationStatus, 'CALIBRATION_REQUIRED');

// 7. Field diagnostics secret redaction
const rawDiag = {
  deviceId: 'ESP32-KITCHEN-01',
  wifiPassword: 'super-secret-wifi-pass',
  deviceKey: 'secret-device-key-value',
  currentState: 'READY'
};
const formattedDiag = contract.formatFieldDiagnostics(rawDiag);
assert.equal(formattedDiag.wifiPassword, '[REDACTED]', 'Wi-Fi password must be redacted from diagnostics');
assert.equal(formattedDiag.deviceKey, '[REDACTED]', 'Device key must be redacted from diagnostics');

// 8. Verify no secrets committed in firmware source files
const firmwareFiles = fs.readdirSync(fieldNodeDir).filter(f => f.endsWith('.h') || f.endsWith('.cpp') || f.endsWith('.ino'));
for (const file of firmwareFiles) {
  const content = fs.readFileSync(path.join(fieldNodeDir, file), 'utf8');
  assert.equal(/GASGUARD_(WIFI_PASS|DEVICE_SECRET|SERVICE_ROLE)/.test(content), false, `firmware file ${file} must not contain real secret placeholders`);
}

// 9. Documentation files exist
assert.ok(fs.existsSync(path.join(root, 'docs', 'ESP32_FIELD_INTEGRATION.md')), 'ESP32_FIELD_INTEGRATION.md must exist');
assert.ok(fs.existsSync(path.join(root, 'docs', 'ESP32_FIRST_CONNECTION_CHECKLIST.md')), 'ESP32_FIRST_CONNECTION_CHECKLIST.md must exist');

console.log('esp32 field readiness tests passed');
