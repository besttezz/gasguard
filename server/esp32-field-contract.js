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

function validateBoardProfile(profile = {}) {
  if (!profile || typeof profile !== 'object') {
    return { ok: false, code: 'CONFIG_ERROR', reason: 'Invalid board profile object' };
  }
  if (!profile.profileConfirmed) {
    return { ok: false, code: 'CONFIG_ERROR', reason: 'Hardware board profile is UNCONFIRMED' };
  }
  // Physical board model has not been confirmed on bench
  return { ok: false, code: 'CONFIG_ERROR', reason: 'Physical ESP32 board model and pinout have not been confirmed' };
}

function createSensorDescriptor({ sensorId, sensorType, role, pin, adcAttenuation = 'ADC_11db', inputScale = null, enabled = true, profileConfirmed = false }) {
  if (!enabled) throw new Error('Sensor channel disabled');
  if (!profileConfirmed) {
    throw new Error('CONFIG_ERROR: Hardware board profile is UNCONFIRMED. Physical GPIO and electrical scaling must be verified.');
  }
  if (pin < 32 || pin > 39) throw new Error(`Pin ${pin} is not a valid ESP32 ADC1 pin (32..39)`);
  if (inputScale == null || inputScale <= 0) {
    throw new Error('Confirmed hardware profile requires a positive input scale');
  }
  return Object.freeze({ sensorId, sensorType, role, pin, adcAttenuation, inputScale, enabled, profileConfirmed });
}

function processUncalibratedReading(descriptor, rawAdc, pinMilliVolts = null) {
  if (!Number.isInteger(rawAdc) || rawAdc < 0 || rawAdc > 4095) throw new Error(`Raw ADC out of bounds: ${rawAdc}`);
  
  // Rule: NEVER synthesize calibrated voltage from raw ADC. Explicit pinMilliVolts required.
  const sensorVoltage = (pinMilliVolts != null && Number.isFinite(pinMilliVolts) && pinMilliVolts >= 0)
    ? Number((pinMilliVolts / 1000.0).toFixed(3))
    : null;

  const inputAdjustedVoltage = (sensorVoltage != null && descriptor.inputScale != null && descriptor.inputScale > 0)
    ? Number((sensorVoltage * descriptor.inputScale).toFixed(3))
    : null;

  return Object.freeze({
    sensorId: descriptor.sensorId,
    sensorType: descriptor.sensorType,
    role: descriptor.role,
    rawAdc,
    sensorVoltage,
    inputAdjustedVoltage,
    calibrationStatus: 'CALIBRATION_REQUIRED',
    calibratedPpm: null,
    confidence: null
  });
}

function formatRawMeasurementPayload({ deviceId, reading, bootId, sequence, timestamp }) {
  if (!deviceId || !reading || !bootId || sequence === undefined || !timestamp) {
    throw new Error('Missing required raw measurement fields');
  }

  return Object.freeze({
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
  validateBoardProfile,
  createSensorDescriptor,
  processUncalibratedReading,
  formatRawMeasurementPayload,
  formatFieldDiagnostics
});
