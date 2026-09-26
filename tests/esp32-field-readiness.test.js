'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../server/esp32-field-contract.js');
const registry = require('../server/device-registry.js');
const { createDeviceIngress } = require('../server/device-ingress.js');
const { createPipeline } = require('../server/pipeline-runtime.js');

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
  profileConfirmed: true,
  inputScale: 1.5
});
assert.equal(mq6Desc.role, 'PRIMARY_LPG_SENSOR', 'MQ-6 must be primary LPG channel');

const mq3Desc = contract.createSensorDescriptor({
  sensorId: 'MQ3-01',
  sensorType: 'MQ3',
  role: contract.SENSOR_ROLES.AUXILIARY_CONTEXT_SENSOR,
  pin: 35,
  profileConfirmed: true,
  inputScale: 1.5
});
assert.equal(mq3Desc.role, 'AUXILIARY_CONTEXT_SENSOR', 'MQ-3 must be auxiliary context channel');
assert.notEqual(mq6Desc.role, mq3Desc.role, 'MQ-3 and MQ-6 roles must remain distinct');

// 4. Raw-only produces CALIBRATION_REQUIRED and no invented ppm
const reading6 = contract.processUncalibratedReading(mq6Desc, 2048);
assert.equal(reading6.calibrationStatus, 'CALIBRATION_REQUIRED');
assert.equal(reading6.calibratedPpm, null, 'Uncalibrated reading must not invent ppm value');
assert.equal(reading6.confidence, null, 'Uncalibrated reading must not invent confidence score');
assert.ok(reading6.sensorVoltage > 0 && reading6.inputAdjustedVoltage > reading6.sensorVoltage, 'voltage divider scale applied when confirmed');

// 5. Unconfirmed hardware profile produces CONFIG_ERROR or equivalent refusal
assert.throws(
  () => contract.createSensorDescriptor({ sensorId: 'MQ6-01', sensorType: 'MQ6', role: contract.SENSOR_ROLES.PRIMARY_LPG_SENSOR, pin: 34, profileConfirmed: false }),
  /UNCONFIRMED/,
  'Unconfirmed hardware profile must be refused'
);

// 6. Setup pipeline & ingress instance
const keys = { 'ESP32-KITCHEN-01': 'test-secret-key' };
const pipelines = { 'hardware-pilot': createPipeline(root) };
const ingress = createDeviceIngress({ registry, credentials: keys, pipelines });

// 7. Device Ingress behavior for Raw-Only Authenticated Packet
const rawPayload = contract.formatRawMeasurementPayload({
  deviceId: 'ESP32-KITCHEN-01',
  reading: reading6,
  bootId: 'boot-xyz-123',
  sequence: 42,
  timestamp: new Date().toISOString()
});

// Verify raw packet does NOT claim gasguard.telemetry.v1.1
assert.equal(rawPayload.schemaVersion, undefined, 'Raw field packet is NOT falsely labelled canonical Telemetry V1.1');
assert.equal(rawPayload.deviceId, 'ESP32-KITCHEN-01');
assert.equal(rawPayload.sensorId, 'MQ6-01');

const validHeaders = {
  'x-device-key': 'test-secret-key'
};

const ingressRes = ingress.ingest({ headers: validHeaders, payload: rawPayload });
assert.equal(ingressRes.status, 202, 'Raw-only authenticated device packet must return HTTP 202');
assert.equal(ingressRes.body.ok, true);
assert.equal(ingressRes.body.code, 'CALIBRATION_REQUIRED');
assert.equal(ingressRes.body.gasPpm, null, 'Raw-only packet must set gasPpm to null');
assert.equal(ingressRes.body.safety, 'UNKNOWN', 'Raw-only packet must set safety to UNKNOWN');
assert.equal(ingressRes.body.workspaceId, 'hardware-pilot');

// Verify Raw-only packet did NOT pollute Safety Engine readings
assert.equal(pipelines['hardware-pilot'].engine.state.readings.length, 0, 'Raw-only packet must not enter Safety Engine as calibrated telemetry');

// 8. Device auth failure
const invalidAuthRes = ingress.ingest({ headers: { 'x-device-key': 'wrong-key' }, payload: rawPayload });
assert.equal(invalidAuthRes.status, 401, 'Device auth still required');

// 9. Invalid raw measurement rejected
const invalidRawRes = ingress.ingest({ headers: validHeaders, payload: { deviceId: 'ESP32-KITCHEN-01', raw: {} } });
assert.equal(invalidRawRes.status, 422, 'Invalid raw measurement must be rejected with 422 status');

// 10. Valid upstreamPpm path still works
const calibratedPayload = {
  schemaVersion: 'gasguard.telemetry.v1.1',
  deviceId: 'ESP32-KITCHEN-01',
  sensorId: reading6.sensorId,
  sensorType: reading6.sensorType,
  bootId: 'boot-xyz-123',
  sequence: 43,
  timestamp: new Date().toISOString(),
  upstreamPpm: 15.5,
  raw: {
    adc: reading6.rawAdc,
    sensorVoltage: reading6.sensorVoltage,
    calibrationStatus: 'CALIBRATED'
  }
};
const calibratedRes = ingress.ingest({ headers: validHeaders, payload: calibratedPayload });
assert.equal(calibratedRes.status, 202);
assert.equal(calibratedRes.body.gasPpm, 15.5);
assert.equal(calibratedRes.body.safety, 'safe');
assert.equal(pipelines['hardware-pilot'].engine.state.readings.length, 1, 'Calibrated telemetry enters Safety Engine');

// 11. Check firmware files for timestamp fallback & hardcoded scaling defaults
const inoContent = fs.readFileSync(path.join(fieldNodeDir, 'esp32-field-node.ino'), 'utf8');
assert.equal(inoContent.includes('2026-09-26T00:00:00Z'), false, 'Hardcoded timestamp fallback must be removed');
assert.ok(inoContent.includes('TIME_UNAVAILABLE'), 'Must report TIME_UNAVAILABLE when NTP is missing');

const boardConfigContent = fs.readFileSync(path.join(fieldNodeDir, 'board_config.h'), 'utf8');
assert.ok(boardConfigContent.includes('GASGUARD_HARDWARE_PROFILE_CONFIRMED false'), 'Hardware profile must default to false/unconfirmed');

// 12. Secret redaction verification
const rawDiag = {
  deviceId: 'ESP32-KITCHEN-01',
  wifiPassword: 'super-secret-wifi-pass',
  deviceKey: 'secret-device-key-value',
  currentState: 'READY'
};
const formattedDiag = contract.formatFieldDiagnostics(rawDiag);
assert.equal(formattedDiag.wifiPassword, '[REDACTED]', 'Wi-Fi password must be redacted from diagnostics');
assert.equal(formattedDiag.deviceKey, '[REDACTED]', 'Device key must be redacted from diagnostics');

// 13. Documentation checks: SoftAP not implemented & 48h preheat
const fieldIntegrationDoc = fs.readFileSync(path.join(root, 'docs', 'ESP32_FIELD_INTEGRATION.md'), 'utf8');
assert.ok(fieldIntegrationDoc.includes('48 hours'), 'Documentation must require >=48h preheat for MQ sensors');
assert.ok(fieldIntegrationDoc.includes('NOT YET IMPLEMENTED') || fieldIntegrationDoc.includes('PLANNED'), 'Documentation must state SoftAP is not yet implemented');

const readmeDoc = fs.readFileSync(path.join(fieldNodeDir, 'README.md'), 'utf8');
assert.ok(readmeDoc.includes('48 hours'), 'README must specify >=48h preheat');
assert.ok(readmeDoc.includes('NOT YET IMPLEMENTED') || readmeDoc.includes('PLANNED'), 'README must state SoftAP is not yet implemented');

console.log('esp32 field readiness correctness tests passed!');
