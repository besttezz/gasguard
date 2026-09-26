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

// Confirmed profile with missing/zero inputScale rejects
const invalidScaleProfileRes = contract.validateBoardProfile({
  profileConfirmed: true,
  boardVariant: 'ESP32_WROOM32_BENCH_V1',
  sensors: { mq6: { enabled: true, pin: 34, inputScale: 0.0 } }
});
assert.equal(invalidScaleProfileRes.ok, false, 'Confirmed profile with zero inputScale must reject startup');

// Board profile validation is not only numeric GPIO range (rejects unknown board variant)
const unknownBoardRes = contract.validateBoardProfile({
  profileConfirmed: true,
  boardVariant: 'ESP32_UNKNOWN_MODEL',
  sensors: { mq6: { enabled: true, pin: 34, inputScale: 1.5 } }
});
assert.equal(unknownBoardRes.ok, false, 'Board profile validation must reject unknown board variant');

// Valid confirmed profile passes
const validProfileRes = contract.validateBoardProfile({
  profileConfirmed: true,
  boardVariant: 'ESP32_WROOM32_BENCH_V1',
  sensors: {
    mq6: { enabled: true, pin: 34, inputScale: 1.5 },
    mq3: { enabled: true, pin: 35, inputScale: 1.5 }
  }
});
assert.equal(validProfileRes.ok, true, 'Valid confirmed profile passes validation');

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

// 5. Raw-only produces CALIBRATION_REQUIRED and no invented ppm
const reading6 = contract.processUncalibratedReading(mq6Desc, 2048, 1650);
assert.equal(reading6.calibrationStatus, 'CALIBRATION_REQUIRED');
assert.equal(reading6.calibratedPpm, null, 'Uncalibrated reading must not invent ppm value');
assert.equal(reading6.confidence, null, 'Uncalibrated reading must not invent confidence score');
assert.equal(reading6.sensorVoltage, 1.650, 'Calibrated millivolts separate from raw ADC');
assert.equal(reading6.inputAdjustedVoltage, 2.475, 'Voltage divider scale applied');

// 6. Setup pipeline & ingress instance
const keys = { 'ESP32-KITCHEN-01': 'test-secret-key' };
const pipelines = { 'hardware-pilot': createPipeline(root) };
const ingress = createDeviceIngress({ registry, credentials: keys, pipelines });

// 7. Device Ingress behavior for Raw-Only Authenticated Packet
const rawPayloadMQ6 = contract.formatRawMeasurementPayload({
  deviceId: 'ESP32-KITCHEN-01',
  reading: reading6,
  bootId: 'boot-xyz-123',
  sequence: 42,
  timestamp: new Date().toISOString()
});

const validHeaders = {
  'x-device-key': 'test-secret-key'
};

const ingressRes = ingress.ingest({ headers: validHeaders, payload: rawPayloadMQ6 });
assert.equal(ingressRes.status, 202, 'Raw-only authenticated device packet must return HTTP 202');
assert.equal(ingressRes.body.ok, true);
assert.equal(ingressRes.body.code, 'CALIBRATION_REQUIRED');
assert.equal(ingressRes.body.gasPpm, null, 'Raw-only packet must set gasPpm to null');
assert.equal(ingressRes.body.safety, 'UNKNOWN', 'Raw-only packet must set safety to UNKNOWN');
assert.equal(ingressRes.body.workspaceId, 'hardware-pilot');

// Verify Raw-only packet did NOT pollute Safety Engine readings
assert.equal(pipelines['hardware-pilot'].engine.state.readings.length, 0, 'Safety Engine receives zero raw-only readings');

// 8. Latest raw measurement state is available from device status per sensor
const statusResMQ6 = ingress.status('hardware-pilot');
assert.ok(statusResMQ6.latestMeasurement, 'latestMeasurement available in status');
assert.equal(statusResMQ6.latestMeasurement.sensorId, 'MQ6-01');
assert.equal(statusResMQ6.latestMeasurement.rawAdc, 2048);
assert.equal(statusResMQ6.latestMeasurement.sensorVoltage, 1.65);

// Ingest MQ-3 payload independently
const reading3 = contract.processUncalibratedReading(mq3Desc, 1024, 825);
const rawPayloadMQ3 = contract.formatRawMeasurementPayload({
  deviceId: 'ESP32-KITCHEN-01',
  reading: reading3,
  bootId: 'boot-xyz-123',
  sequence: 12,
  timestamp: new Date().toISOString()
});
ingress.ingest({ headers: validHeaders, payload: rawPayloadMQ3 });

const statusResBoth = ingress.status('hardware-pilot');
assert.ok(statusResBoth.latestMeasurementsBySensor['MQ6-01'], 'MQ-6 raw state retained');
assert.ok(statusResBoth.latestMeasurementsBySensor['MQ3-01'], 'MQ-3 raw state retained independently');
assert.equal(statusResBoth.latestMeasurementsBySensor['MQ3-01'].rawAdc, 1024);

// 9. No secrets enter device status
const statusString = JSON.stringify(statusResBoth);
assert.equal(statusString.includes('test-secret-key'), false, 'no secrets enter device status');

// 10. Check firmware source code for correctness requirements
const inoContent = fs.readFileSync(path.join(fieldNodeDir, 'esp32-field-node.ino'), 'utf8');
assert.ok(inoContent.includes('validateBoardProfile()'), 'validateBoardProfile exists in firmware');
assert.ok(inoContent.includes('nextIngressAttemptAtMs'), 'Real retry gate exists in firmware');
assert.ok(inoContent.includes('calculateNextBackoffMs'), 'Failed transport advances next attempt time');
assert.ok(inoContent.includes('resetBackoff'), 'Successful transport resets backoff');
assert.ok(inoContent.includes('mq6Sequence') && inoContent.includes('mq3Sequence'), 'MQ-6 and MQ-3 sequence counters remain independent');

const sensorConfigContent = fs.readFileSync(path.join(fieldNodeDir, 'sensor_config.cpp'), 'utf8');
assert.ok(sensorConfigContent.includes('analogSetPinAttenuation'), 'Firmware applies per-pin attenuation');
assert.ok(sensorConfigContent.includes('analogReadResolution'), 'Firmware sets ADC resolution');

const measurementContent = fs.readFileSync(path.join(fieldNodeDir, 'measurement.cpp'), 'utf8');
assert.ok(measurementContent.includes('analogRead(') && measurementContent.includes('analogReadMilliVolts('), 'Raw ADC and calibrated millivolt reads remain separate');

// 11. Canonical Telemetry V1.1 still requires real ppm path
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

// 12. Documentation checks: ADC_11db measurable range clarification
const fieldIntegrationDoc = fs.readFileSync(path.join(root, 'docs', 'ESP32_FIELD_INTEGRATION.md'), 'utf8');
assert.ok(fieldIntegrationDoc.includes('150 mV to 3100 mV') || fieldIntegrationDoc.includes('150mV'), 'Docs no longer describe ADC_11db as universally 0-3.3V full scale');

console.log('esp32 field readiness final correctness tests passed!');
