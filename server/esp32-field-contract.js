'use strict';

const SENSOR_ROLES = Object.freeze({
  PRIMARY_LPG_SENSOR: 'PRIMARY_LPG_SENSOR',
  AUXILIARY_CONTEXT_SENSOR: 'AUXILIARY_CONTEXT_SENSOR'
});

const NODE_STATES = Object.freeze([
  'UNPROVISIONED',
  'PROVISIONING',
  'CONNECTING_WIFI',
  'WIFI_CONNECTED',
  'CONNECTING_INGRESS',
  'READY',
  'CALIBRATION_REQUIRED',
  'OFFLINE',
  'CONFIG_ERROR'
]);

function createSensorDescriptor({ sensorId, sensorType, role, pin, adcAttenuation = 3, inputScale = 1.5, enabled = true }) {
  if (!enabled) throw new Error('Sensor channel disabled');
  if (pin < 32 || pin > 39) throw new Error(`Pin ${pin} is not a valid ESP32 ADC1 pin (32..39)`);
  if (inputScale <= 0) throw new Error('Input scale must be greater than 0');
  return Object.freeze({ sensorId, sensorType, role, pin, adcAttenuation, inputScale, enabled });
}

function processUncalibratedReading(descriptor, rawAdc) {
  if (rawAdc < 0 || rawAdc > 4095) throw new Error(`Raw ADC out of bounds: ${rawAdc}`);
  const sensorVoltage = (rawAdc / 4095.0) * 3.3;
  const inputAdjustedVoltage = sensorVoltage * descriptor.inputScale;
  
  return Object.freeze({
    sensorId: descriptor.sensorId,
    sensorType: descriptor.sensorType,
    role: descriptor.role,
    rawAdc,
    sensorVoltage: Number(sensorVoltage.toFixed(3)),
    inputAdjustedVoltage: Number(inputAdjustedVoltage.toFixed(3)),
    calibrationStatus: 'CALIBRATION_REQUIRED',
    // Rule: Uncalibrated sensor MUST NOT produce calibrated ppm or fake confidence
    calibratedPpm: null,
    confidence: null
  });
}

function formatTelemetryPayload({ deviceId, reading, bootId, sequence, timestamp }) {
  if (!deviceId || !reading || !bootId || sequence === undefined || !timestamp) {
    throw new Error('Missing required telemetry fields');
  }

  return Object.freeze({
    schemaVersion: 'gasguard.telemetry.v1.1',
    deviceId,
    sensorId: reading.sensorId,
    sensorType: reading.sensorType,
    bootId,
    sequence,
    timestamp,
    raw: {
      adc: reading.rawAdc,
      sensorVoltage: reading.sensorVoltage,
      inputAdjustedVoltage: reading.inputAdjustedVoltage,
      calibrationStatus: reading.calibrationStatus
    }
  });
}

function formatFieldDiagnostics(diag) {
  const redacted = { ...diag };
  if (redacted.wifiPassword) redacted.wifiPassword = '[REDACTED]';
  if (redacted.deviceKey) redacted.deviceKey = '[REDACTED]';
  if (redacted.secret) redacted.secret = '[REDACTED]';
  return Object.freeze(redacted);
}

module.exports = Object.freeze({
  SENSOR_ROLES,
  NODE_STATES,
  createSensorDescriptor,
  processUncalibratedReading,
  formatTelemetryPayload,
  formatFieldDiagnostics
});
