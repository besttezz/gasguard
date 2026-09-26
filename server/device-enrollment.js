'use strict';

const crypto = require('node:crypto');

function validateRawTokenFormat(rawToken) {
  if (typeof rawToken !== 'string') return false;
  return /^[0-9a-f]{64}$/i.test(rawToken.trim());
}

function hashToken(rawToken) {
  if (!validateRawTokenFormat(rawToken)) {
    throw new Error('INVALID_TOKEN_FORMAT: Raw token must be 64 hex characters');
  }
  return crypto.createHash('sha256').update(rawToken.trim().toLowerCase()).digest('hex');
}

function redactEnrollmentSecrets(data) {
  if (!data || typeof data !== 'object') return data;
  const redacted = { ...data };
  if (redacted.raw_enrollment_token) redacted.raw_enrollment_token = '[REDACTED]';
  if (redacted.raw_device_credential) redacted.raw_device_credential = '[REDACTED]';
  if (redacted.token_hash) redacted.token_hash = '[REDACTED]';
  if (redacted.credential_hash) redacted.credential_hash = '[REDACTED]';
  return Object.freeze(redacted);
}

function createDeviceEnrollmentService(rpcAdapter = {}) {
  return Object.freeze({
    async issueEnrollmentToken({ deviceId, installationJobId, expiresInMinutes = 15 }) {
      if (!deviceId || !installationJobId) {
        return { ok: false, code: 'INVALID_INPUT', error: 'deviceId and installationJobId required' };
      }
      if (typeof rpcAdapter.issueToken !== 'function') {
        throw new Error('rpcAdapter.issueToken function missing');
      }

      try {
        const res = await rpcAdapter.issueToken({ deviceId, installationJobId, expiresInMinutes });
        return Object.freeze({ ok: true, data: res });
      } catch (err) {
        return Object.freeze({ ok: false, code: err.code || 'ISSUANCE_FAILED', error: err.message });
      }
    },

    async claimDeviceEnrollment({ rawEnrollmentToken, expectedDeviceUid = null }) {
      if (!validateRawTokenFormat(rawEnrollmentToken)) {
        return { ok: false, code: 'INVALID_TOKEN_FORMAT', error: 'Raw enrollment token must be 64 hex characters' };
      }
      if (typeof rpcAdapter.claimEnrollment !== 'function') {
        throw new Error('rpcAdapter.claimEnrollment function missing');
      }

      try {
        const res = await rpcAdapter.claimEnrollment({ rawEnrollmentToken, expectedDeviceUid });
        return Object.freeze({ ok: true, data: res });
      } catch (err) {
        return Object.freeze({ ok: false, code: err.code || 'CLAIM_FAILED', error: err.message });
      }
    }
  });
}

module.exports = Object.freeze({
  validateRawTokenFormat,
  hashToken,
  redactEnrollmentSecrets,
  createDeviceEnrollmentService
});
