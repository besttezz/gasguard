'use strict';

const SENSOR_ROLES = Object.freeze({
  PRIMARY_LPG_SENSOR: 'PRIMARY_LPG_SENSOR',
  AUXILIARY_CONTEXT_SENSOR: 'AUXILIARY_CONTEXT_SENSOR'
});

const NODE_STATES = Object.freeze([
  'UNPROVISIONED',
  'PROVISIONING',
  'PROVISIONING_CONFIG_REQUIRED',
  'PROVISIONING_FAILED',
  'CONNECTING_WIFI',
  'WIFI_CONNECTED',
  'CONNECTING_INGRESS',
  'READY',
  'DEVICE_ENROLLMENT_REQUIRED',
  'CALIBRATION_REQUIRED',
  'OFFLINE',
  'CONFIG_ERROR'
]);

const FORBIDDEN_DEFAULT_POPS = Object.freeze([
  'abcd1234',
  '12345678',
  'password',
  'gasguard123',
  'default',
  'admin',
  '1234',
  '00000000'
]);

function validateProvisioningConfig(config = {}) {
  if (!config || typeof config !== 'object') {
    return { ok: false, code: 'INVALID_PROVISIONING_CONFIG', reason: 'Config must be an object' };
  }
  if (config.securityMode === 0) {
    return { ok: false, code: 'SECURITY_0_FORBIDDEN', reason: 'Security 0 (plaintext provisioning) is strictly FORBIDDEN' };
  }
  if (config.securityMode !== 1) {
    return { ok: false, code: 'UNSUPPORTED_SECURITY_MODE', reason: 'Security 1 (X25519 + PoP + AES-CTR) required' };
  }
  if (!config.proofOfPossession || typeof config.proofOfPossession !== 'string' || !config.proofOfPossession.trim()) {
    return { ok: false, code: 'MISSING_POP', reason: 'Device-specific Proof of Possession (PoP) required' };
  }

  const popLower = config.proofOfPossession.trim().toLowerCase();
  if (FORBIDDEN_DEFAULT_POPS.includes(popLower)) {
    return { ok: false, code: 'FORBIDDEN_DEFAULT_POP', reason: 'Forbidden default static PoP value detected' };
  }

  return { ok: true, code: 'VALID_PROVISIONING_CONFIG' };
}

function generateProvisioningServiceName(macOrDeviceSuffix = '') {
  let suffix = String(macOrDeviceSuffix || '').trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (suffix.length > 6) {
    suffix = suffix.slice(-6);
  }
  if (!suffix) {
    suffix = '000000';
  }
  return `PROV_GG_${suffix}`;
}

function processProvisioningEvent(currentState, event, context = {}) {
  switch (event) {
    case 'START':
      return 'PROVISIONING';
    case 'CREDENTIAL_SUCCESS':
      return 'CONNECTING_WIFI';
    case 'CREDENTIAL_FAILURE':
      return 'PROVISIONING_FAILED';
    case 'WIFI_GOT_IP':
      if (context.hasDeviceCredential) {
        return 'CONNECTING_INGRESS';
      }
      return 'DEVICE_ENROLLMENT_REQUIRED';
    case 'WIFI_DISCONNECTED':
      return 'OFFLINE';
    default:
      return currentState;
  }
}

function requestWiFiProvisioningReset() {
  return Object.freeze({
    state: 'UNPROVISIONED',
    wifiProvisioned: false,
    clearedCredentials: ['WIFI_STA_SSID', 'WIFI_STA_PASSWORD'],
    preservedData: ['DEVICE_IDENTITY', 'DEVICE_CREDENTIAL', 'SENSOR_CALIBRATION', 'OWNER_INVITATION_TOKEN']
  });
}

function validateBoardProfile(profile = {}) {
  if (!profile || typeof profile !== 'object') {
    return { ok: false, code: 'CONFIG_ERROR', reason: 'Invalid board profile object' };
  }
  if (!profile.profileConfirmed) {
    return { ok: false, code: 'CONFIG_ERROR', reason: 'Hardware board profile is UNCONFIRMED' };
  }
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
  if (redacted.proofOfPossession) redacted.proofOfPossession = '[REDACTED]';
  if (redacted.pop) redacted.pop = '[REDACTED]';
  if (redacted.serviceKey) redacted.serviceKey = '[REDACTED]';
  return Object.freeze(redacted);
}

module.exports = Object.freeze({
  SENSOR_ROLES,
  NODE_STATES,
  validateProvisioningConfig,
  generateProvisioningServiceName,
  processProvisioningEvent,
  requestWiFiProvisioningReset,
  validateBoardProfile,
  createSensorDescriptor,
  processUncalibratedReading,
  formatRawMeasurementPayload,
  formatFieldDiagnostics
});
