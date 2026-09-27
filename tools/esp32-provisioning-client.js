'use strict';

// =============================================================================
// GASGUARD TECHNICIAN PROVISIONING CLIENT CONTRACT HELPER
//
// Developer & technician contract helper for sending Device UID + Enrollment
// Token to custom SoftAP provisioning endpoint 'gasguard-enroll'.
//
// MATURITY:
// - Workflow & payload contract validation implemented
// - Secret redaction policy enforced
// - Wire-level Security 1 transport delegated to official Espressif provisioning tools
// =============================================================================

const { validateRawTokenFormat } = require('../server/device-enrollment.js');

function validateTechnicianEnrollmentPayload({ deviceUid, enrollmentToken }) {
  if (!deviceUid || typeof deviceUid !== 'string') {
    return { ok: false, error: 'INVALID_DEVICE_UID', details: 'Device UID must be a non-empty string' };
  }
  
  if (deviceUid.length > 128) {
    return { ok: false, error: 'INVALID_DEVICE_UID_LENGTH', details: 'Device UID must be <= 128 chars' };
  }

  // Reject control chars
  for (let i = 0; i < deviceUid.length; i++) {
    if (deviceUid.charCodeAt(i) < 0x20) {
      return { ok: false, error: 'INVALID_DEVICE_UID_CHARS', details: 'Control characters rejected' };
    }
  }

  if (!enrollmentToken || typeof enrollmentToken !== 'string') {
    return { ok: false, error: 'INVALID_ENROLLMENT_TOKEN', details: 'Enrollment Token must be a 64-hex string' };
  }

  const normalizedToken = enrollmentToken.trim().toLowerCase();
  if (!validateRawTokenFormat(normalizedToken)) {
    return { ok: false, error: 'INVALID_ENROLLMENT_TOKEN_FORMAT', details: 'Enrollment Token must be exactly 64 hexadecimal characters' };
  }

  return {
    ok: true,
    payload: {
      deviceUid: deviceUid.trim(),
      enrollmentToken: normalizedToken
    }
  };
}

function parseCustomEndpointResponse(responseRaw) {
  if (!responseRaw || typeof responseRaw !== 'object') {
    return { ok: false, error: 'INVALID_RESPONSE_FORMAT', details: 'Response must be a JSON object' };
  }

  if (responseRaw.ok === true && responseRaw.code === 'ENROLLMENT_BOOTSTRAP_ACCEPTED') {
    return { ok: true, code: 'ENROLLMENT_BOOTSTRAP_ACCEPTED' };
  }

  return {
    ok: false,
    error: responseRaw.code || 'BOOTSTRAP_REJECTED',
    details: responseRaw
  };
}

function formatSafeTechnicianLog(stepName, data = {}) {
  // Explicit safety checks
  if ('enrollmentToken' in data || 'deviceCredential' in data || 'proofOfPossession' in data || 'wifiPassword' in data) {
    throw new Error('SECURITY VIOLATION: Secret fields passed to log formatter');
  }

  const safeLog = {
    timestamp: new Date().toISOString(),
    step: stepName,
    serviceName: data.serviceName || null,
    deviceUid: data.deviceUid || null,
    status: data.status || null,
    code: data.code || null,
    error: data.error || null,
    // CONFIRMATION OF SECRET REDACTION
    secretsRedacted: true
  };

  return JSON.stringify(safeLog);
}

module.exports = {
  validateTechnicianEnrollmentPayload,
  parseCustomEndpointResponse,
  formatSafeTechnicianLog
};
