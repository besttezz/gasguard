'use strict';

const crypto = require('node:crypto');

const KNOWN_ERROR_CODES = new Set([
  'UNAUTHORIZED',
  'INVALID_EXPIRATION',
  'DEVICE_NOT_FOUND',
  'DEVICE_NOT_ELIGIBLE',
  'JOB_NOT_FOUND',
  'JOB_NOT_ELIGIBLE',
  'SITE_MISMATCH',
  'INVALID_TOKEN_FORMAT',
  'ENROLLMENT_NOT_FOUND',
  'ENROLLMENT_NOT_AVAILABLE',
  'ENROLLMENT_ALREADY_CLAIMED',
  'ENROLLMENT_EXPIRED',
  'ENROLLMENT_REVOKED',
  'DEVICE_IDENTITY_MISMATCH',
  'ACTIVE_CREDENTIAL_EXISTS'
]);

const SECRET_KEYS = new Set([
  'raw_enrollment_token',
  'rawEnrollmentToken',
  'raw_device_credential',
  'rawDeviceCredential',
  'token_hash',
  'tokenHash',
  'credential_hash',
  'credentialHash'
]);

function validateRawTokenFormat(rawToken) {
  if (typeof rawToken !== 'string') return false;
  return /^[0-9a-fA-F]{64}$/.test(rawToken.trim());
}

function hashToken(rawToken) {
  if (!validateRawTokenFormat(rawToken)) {
    throw new Error('INVALID_TOKEN_FORMAT: Raw enrollment token must be 64 hex characters');
  }
  return crypto.createHash('sha256').update(rawToken.trim().toLowerCase()).digest('hex');
}

function redactEnrollmentSecrets(val) {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'object') return val;

  if (Array.isArray(val)) {
    return Object.freeze(val.map((item) => redactEnrollmentSecrets(item)));
  }

  const redacted = {};
  for (const [key, value] of Object.entries(val)) {
    if (SECRET_KEYS.has(key)) {
      redacted[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object') {
      redacted[key] = redactEnrollmentSecrets(value);
    } else {
      redacted[key] = value;
    }
  }
  return Object.freeze(redacted);
}

function normalizeEnrollmentError(err) {
  if (!err) {
    return { code: 'INTERNAL_ENROLLMENT_ERROR', error: 'An internal enrollment error occurred' };
  }

  const rawMessage = typeof err === 'string' ? err : err.message || '';
  const match = rawMessage.match(/^([A-Z_]+):\s*(.*)$/);

  if (match && KNOWN_ERROR_CODES.has(match[1])) {
    return {
      code: match[1],
      error: match[2].trim() || match[1]
    };
  }

  if (err.code && KNOWN_ERROR_CODES.has(err.code)) {
    return {
      code: err.code,
      error: rawMessage.replace(/^[A-Z_]+:\s*/, '').trim() || err.code
    };
  }

  return {
    code: 'INTERNAL_ENROLLMENT_ERROR',
    error: 'An internal enrollment error occurred'
  };
}

function createDeviceEnrollmentService(rpcAdapter = {}) {
  return Object.freeze({
    async issueEnrollmentToken({ deviceId, installationJobId, expiresInMinutes = 15 }) {
      if (!deviceId || !installationJobId) {
        return Object.freeze({ ok: false, code: 'INVALID_INPUT', error: 'deviceId and installationJobId required' });
      }
      if (typeof rpcAdapter.issueToken !== 'function') {
        throw new Error('rpcAdapter.issueToken function missing');
      }

      try {
        const res = await rpcAdapter.issueToken({ deviceId, installationJobId, expiresInMinutes });
        return Object.freeze({ ok: true, data: res });
      } catch (err) {
        const normalized = normalizeEnrollmentError(err);
        return Object.freeze({ ok: false, code: normalized.code, error: normalized.error });
      }
    },

    async claimDeviceEnrollment({ rawEnrollmentToken, expectedDeviceUid = null }) {
      if (!validateRawTokenFormat(rawEnrollmentToken)) {
        return Object.freeze({ ok: false, code: 'INVALID_TOKEN_FORMAT', error: 'Raw enrollment token must be 64 hex characters' });
      }
      if (typeof rpcAdapter.claimEnrollment !== 'function') {
        throw new Error('rpcAdapter.claimEnrollment function missing');
      }

      try {
        const res = await rpcAdapter.claimEnrollment({ rawEnrollmentToken, expectedDeviceUid });
        return Object.freeze({ ok: true, data: res });
      } catch (err) {
        const normalized = normalizeEnrollmentError(err);
        return Object.freeze({ ok: false, code: normalized.code, error: normalized.error });
      }
    }
  });
}

module.exports = Object.freeze({
  validateRawTokenFormat,
  hashToken,
  redactEnrollmentSecrets,
  normalizeEnrollmentError,
  createDeviceEnrollmentService
});
