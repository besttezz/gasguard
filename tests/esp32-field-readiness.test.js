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

// 3. validateBoardProfile contract function exists and validates board boundaries
assert.equal(typeof contract.validateBoardProfile, 'function', 'validateBoardProfile contract function must exist');

// Unconfirmed profile rejects startup
const unconfirmedProfileRes = contract.validateBoardProfile({ profileConfirmed: false });
assert.equal(unconfirmedProfileRes.ok, false, 'Unconfirmed profile must reject startup');
assert.equal(unconfirmedProfileRes.code, 'CONFIG_ERROR');

// Confirmed profile with unverified physical board model rejects
const unverifiedBoardRes = contract.validateBoardProfile({
  profileConfirmed: true,
  boardVariant: 'ESP32_GENERIC_UNVERIFIED',
  sensors: { mq6: { enabled: true, pin: 34, inputScale: 1.5 } }
});
assert.equal(unverifiedBoardRes.ok, false, 'Unverified board variant must reject startup');

// 4. Sensor descriptors contract verification
const mq6Desc = contract.createSensorDescriptor({
  sensorId: 'MQ6-01',
  sensorType: 'MQ6',
  role: contract.SENSOR_ROLES.PRIMARY_LPG_SENSOR,
  pin: 34,
  adcAttenuation: 'ADC_11db',
  profileConfirmed: true,
  inputScale: 1.5
});
assert.equal(mq6Desc.role, 'PRIMARY_LPG_SENSOR', 'MQ-6 must be primary LPG channel');
assert.equal(mq6Desc.adcAttenuation, 'ADC_11db', 'Attenuation uses explicit ADC attenuation type/constant');

const mq3Desc = contract.createSensorDescriptor({
  sensorId: 'MQ3-01',
  sensorType: 'MQ3',
  role: contract.SENSOR_ROLES.AUXILIARY_CONTEXT_SENSOR,
  pin: 35,
  adcAttenuation: 'ADC_11db',
  profileConfirmed: true,
  inputScale: 1.5
});
assert.equal(mq3Desc.role, 'AUXILIARY_CONTEXT_SENSOR', 'MQ-3 must be auxiliary context channel');

// 5. Raw-only produces CALIBRATION_REQUIRED, explicit mV, and NO 3.3/4095 fallback
const readingWithMv = contract.processUncalibratedReading(mq6Desc, 2048, 1650);
assert.equal(readingWithMv.calibrationStatus, 'CALIBRATION_REQUIRED');
assert.equal(readingWithMv.calibratedPpm, null, 'Uncalibrated reading must not invent ppm value');
assert.equal(readingWithMv.confidence, null, 'Uncalibrated reading must not invent confidence score');
assert.equal(readingWithMv.sensorVoltage, 1.650, 'Explicit pin millivolts used');
assert.equal(readingWithMv.inputAdjustedVoltage, 2.475, 'Voltage divider scale applied');

// Verify NO 3.3/4095 fallback when pinMilliVolts is absent/null
const readingNoMv = contract.processUncalibratedReading(mq6Desc, 2048);
assert.equal(readingNoMv.sensorVoltage, null, 'No 3.3/4095 fallback allowed; sensorVoltage must be null when mV absent');
assert.equal(readingNoMv.inputAdjustedVoltage, null, 'inputAdjustedVoltage must be null when sensorVoltage is null');

// 6. Setup pipeline & ingress instance
const keys = { 'ESP32-KITCHEN-01': 'test-secret-key' };
const pipelines = { 'hardware-pilot': createPipeline(root) };
const ingress = createDeviceIngress({ registry, credentials: keys, pipelines });
const validHeaders = { 'x-device-key': 'test-secret-key' };

// 7. Test State Immutability on Rejected Packets
// Step 1: Send valid MQ-6 raw packet
const validRawPayload = contract.formatRawMeasurementPayload({
  deviceId: 'ESP32-KITCHEN-01',
  reading: readingWithMv,
  bootId: 'boot-xyz-123',
  sequence: 42,
  timestamp: new Date().toISOString()
});
const firstRes = ingress.ingest({ headers: validHeaders, payload: validRawPayload });
assert.equal(firstRes.status, 202);
assert.equal(firstRes.body.code, 'CALIBRATION_REQUIRED');

const statusBefore = ingress.status('hardware-pilot');
assert.equal(statusBefore.latestMeasurement.rawAdc, 2048);
assert.equal(statusBefore.sensors.length, 1);
assert.equal(statusBefore.sensors[0], 'MQ6-01');

// Step 2: Send authenticated INVALID MQ-6 packet with bogus values & bogus new sensorId
const invalidPayload = {
  deviceId: 'ESP32-KITCHEN-01',
  sensorId: 'BOGUS-INVALID-SENSOR',
  sensorType: 'MQ6',
  bootId: 'boot-xyz-123',
  sequence: 43,
  timestamp: new Date().toISOString(),
  raw: { adc: 9999, sensorVoltage: -1.0 } // invalid raw ADC out of 0..4095 bounds
};
const invalidRes = ingress.ingest({ headers: validHeaders, payload: invalidPayload });
assert.equal(invalidRes.status, 422, 'Invalid packet must return HTTP 422');

// Step 3: Verify device status was UNCHANGED (zero state mutation on rejection)
const statusAfter = ingress.status('hardware-pilot');
assert.equal(statusAfter.latestMeasurement.rawAdc, 2048, 'Rejected packet must NOT modify latest raw measurement state');
assert.equal(statusAfter.sensors.length, 1, 'Rejected packet must NOT add bogus sensor to knownSensors');
assert.equal(statusAfter.sensors[0], 'MQ6-01');
assert.equal(statusAfter.latestMeasurementsBySensor['BOGUS-INVALID-SENSOR'], undefined, 'Bogus sensor state must NOT be recorded');

// Verify Raw-only packet did NOT pollute Safety Engine readings
assert.equal(pipelines['hardware-pilot'].engine.state.readings.length, 0, 'Safety Engine receives zero raw-only readings');

// 8. Ingest valid MQ-3 payload independently and verify per-sensor freshness
const reading3 = contract.processUncalibratedReading(mq3Desc, 1024, 825);
const validPayloadMQ3 = contract.formatRawMeasurementPayload({
  deviceId: 'ESP32-KITCHEN-01',
  reading: reading3,
  bootId: 'boot-xyz-123',
  sequence: 12,
  timestamp: new Date().toISOString()
});
ingress.ingest({ headers: validHeaders, payload: validPayloadMQ3 });

const statusResBoth = ingress.status('hardware-pilot');
assert.ok(statusResBoth.latestMeasurementsBySensor['MQ6-01'], 'MQ-6 raw state retained');
assert.ok(statusResBoth.latestMeasurementsBySensor['MQ3-01'], 'MQ-3 raw state retained independently');
assert.equal(statusResBoth.latestMeasurementsBySensor['MQ3-01'].rawAdc, 1024);
assert.equal(typeof statusResBoth.latestMeasurementsBySensor['MQ3-01'].receivedAt, 'string', 'per-sensor receivedAt timestamp present');
assert.equal(statusResBoth.latestMeasurementsBySensor['MQ3-01'].stale, false, 'per-sensor freshness tracked');

// 9. No secrets enter device status
const statusString = JSON.stringify(statusResBoth);
assert.equal(statusString.includes('test-secret-key'), false, 'no secrets enter device status');

// 10. Check firmware source code for correctness requirements
const inoContent = fs.readFileSync(path.join(fieldNodeDir, 'esp32-field-node.ino'), 'utf8');
assert.ok(inoContent.includes('validateBoardProfile()'), 'validateBoardProfile exists in firmware');
assert.ok(inoContent.includes('nextIngressAttemptAtMs'), 'Real retry gate exists in firmware');

const sensorConfigContent = fs.readFileSync(path.join(fieldNodeDir, 'sensor_config.cpp'), 'utf8');
assert.ok(sensorConfigContent.includes('isConfiguredBoardPinAllowed'), 'Firmware uses configured board pin allowed boundary');
assert.ok(sensorConfigContent.includes('ESP32_GENERIC_UNVERIFIED'), 'Generic unverified board variant stays unconfirmed');

const measurementContent = fs.readFileSync(path.join(fieldNodeDir, 'measurement.cpp'), 'utf8');
assert.ok(measurementContent.includes('analogRead(') && measurementContent.includes('analogReadMilliVolts('), 'Raw ADC and calibrated millivolt reads remain separate');

// 11. Calibrated path still works
const calibratedPayload = {
  schemaVersion: 'gasguard.telemetry.v1.1',
  deviceId: 'ESP32-KITCHEN-01',
  sensorId: readingWithMv.sensorId,
  sensorType: readingWithMv.sensorType,
  bootId: 'boot-xyz-123',
  sequence: 44,
  timestamp: new Date().toISOString(),
  upstreamPpm: 15.5,
  raw: {
    adc: readingWithMv.rawAdc,
    sensorVoltage: readingWithMv.sensorVoltage,
    calibrationStatus: 'CALIBRATED'
  }
};
const calibratedRes = ingress.ingest({ headers: validHeaders, payload: calibratedPayload });
assert.equal(calibratedRes.status, 202);
assert.equal(calibratedRes.body.gasPpm, 15.5);
assert.equal(calibratedRes.body.safety, 'safe');
assert.equal(pipelines['hardware-pilot'].engine.state.readings.length, 1, 'Calibrated telemetry enters Safety Engine');

console.log('esp32 pre-provisioning state integrity tests passed!');
