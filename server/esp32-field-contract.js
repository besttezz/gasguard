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
  if (!profile.boardVariant || profile.boardVariant === 'ESP32_GENERIC_UNVERIFIED') {
    return { ok: false, code: 'CONFIG_ERROR', reason: 'Unverified board variant specified' };
  }
  if (!profile.sensors || typeof profile.sensors !== 'object') {
    return { ok: false, code: 'CONFIG_ERROR', reason: 'Sensors configuration missing' };
  }

  const mq6 = profile.sensors.mq6;
  if (!mq6 || typeof mq6 !== 'object' || !mq6.enabled) {
    return { ok: false, code: 'CONFIG_ERROR', reason: 'MQ-6 sensor configuration missing or disabled' };
  }
  if (mq6.inputScale == null || mq6.inputScale <= 0) {
    return { ok: false, code: 'CONFIG_ERROR', reason: 'Confirmed profile requires positive inputScale' };
  }

  // Board profile pin boundary check (not merely numeric pin range)
  if (profile.boardVariant === 'ESP32_WROOM32_BENCH_V1') {
    const validPins = [32, 33, 34, 35, 36, 39];
    if (!validPins.includes(mq6.pin)) {
      return { ok: false, code: 'CONFIG_ERROR', reason: `Pin ${mq6.pin} is not valid for board ${profile.boardVariant}` };
    }
  } else {
    return { ok: false, code: 'CONFIG_ERROR', reason: `Unsupported board variant ${profile.boardVariant}` };
  }

  if (profile.sensors.mq3 && profile.sensors.mq3.enabled) {
    const mq3 = profile.sensors.mq3;
    if (mq3.pin == null || mq3.pin === mq6.pin || mq3.inputScale == null || mq3.inputScale <= 0) {
      return { ok: false, code: 'CONFIG_ERROR', reason: 'MQ-3 channel requires positive confirmed inputScale and distinct valid pin' };
    }
  }

  return { ok: true, code: 'VALID' };
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
  if (rawAdc < 0 || rawAdc > 4095) throw new Error(`Raw ADC out of bounds: ${rawAdc}`);
  
  const sensorVoltage = pinMilliVolts != null ? pinMilliVolts / 1000.0 : (rawAdc / 4095.0) * 3.3;
  const inputAdjustedVoltage = (descriptor.inputScale != null && descriptor.inputScale > 0)
    ? Number((sensorVoltage * descriptor.inputScale).toFixed(3))
    : null;

  return Object.freeze({
    sensorId: descriptor.sensorId,
    sensorType: descriptor.sensorType,
    role: descriptor.role,
    rawAdc,
    sensorVoltage: Number(sensorVoltage.toFixed(3)),
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
