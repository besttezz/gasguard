'use strict';

const crypto = require('node:crypto');

function validateRawCredentialFormat(rawCredential) {
  if (typeof rawCredential !== 'string') return false;
  return /^[0-9a-fA-F]{64}$/.test(rawCredential.trim());
}

function hashDeviceCredential(rawCredential) {
  if (!validateRawCredentialFormat(rawCredential)) {
    throw new Error('INVALID_CREDENTIAL_FORMAT: Raw credential must be 64 hex characters');
  }
  return crypto.createHash('sha256').update(rawCredential.trim().toLowerCase()).digest('hex');
}

function timingSafeEqualSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createDatabaseDeviceAuthenticator({ verifyCredential }) {
  if (typeof verifyCredential !== 'function') {
    throw new Error('verifyCredential function required for database device authenticator');
  }

  return Object.freeze({
    async authenticateDevice({ deviceUid, rawCredential }) {
      if (!deviceUid || typeof deviceUid !== 'string' || !deviceUid.trim()) {
        return Object.freeze({ authenticated: false, code: 'INVALID_DEVICE_UID' });
      }

      if (!validateRawCredentialFormat(rawCredential)) {
        return Object.freeze({ authenticated: false, code: 'INVALID_CREDENTIAL_FORMAT' });
      }

      const credentialHash = hashDeviceCredential(rawCredential);

      try {
        // Pass HASH ONLY to database adapter
        const res = await verifyCredential({ deviceUid: deviceUid.trim(), credentialHash });

        if (!res || !res.valid) {
          return Object.freeze({ authenticated: false, code: res?.code || 'INVALID_DEVICE_CREDENTIAL' });
        }

        return Object.freeze({
          authenticated: true,
          databaseDeviceId: res.device_id,
          deviceId: res.device_uid,
          deviceUid: res.device_uid,
          siteId: res.site_id,
          zoneId: res.zone_id,
          deviceType: res.device_type,
          lifecycleStatus: res.lifecycle_status,
          source: 'REAL_DEVICE',
          workspaceId: 'hardware-pilot'
        });
      } catch (err) {
        return Object.freeze({ authenticated: false, code: 'INTERNAL_AUTH_ERROR' });
      }
    }
  });
}

function createDeviceAuthManager({ dbAuthenticator = null, testDeviceKey = null, legacyRealDeviceKey = null, allowLegacyRealAuth = false }) {
  return Object.freeze({
    async authenticateIngressRequest({ deviceUid, payloadDeviceId, xDeviceKey }) {
      const canonicalUid = (deviceUid || payloadDeviceId || '').trim();
      const rawKey = (xDeviceKey || '').trim();

      if (!canonicalUid || !rawKey) {
        return Object.freeze({ authenticated: false, code: 'CREDENTIAL_REQUIRED' });
      }

      // 1. Virtual/Test Device Path (ISOLATED TEST WORKSPACE)
      if (canonicalUid === 'SIM-ESP32-KITCHEN-01') {
        const expectedTestKey = testDeviceKey || null;
        if (!expectedTestKey) {
          return Object.freeze({ authenticated: false, code: 'TEST_CREDENTIAL_NOT_CONFIGURED' });
        }
        if (timingSafeEqualSecret(rawKey, expectedTestKey)) {
          return Object.freeze({
            authenticated: true,
            databaseDeviceId: 'dev-sim-kitchen-01',
            deviceId: 'SIM-ESP32-KITCHEN-01',
            deviceUid: 'SIM-ESP32-KITCHEN-01',
            siteId: 'site-demo-01',
            zoneId: 'zone-kitchen-01',
            deviceType: 'gateway',
            lifecycleStatus: 'active',
            source: 'TEST_DEVICE',
            workspaceId: 'device-test'
          });
        }
        return Object.freeze({ authenticated: false, code: 'INVALID_TEST_CREDENTIAL' });
      }

      // 2. Database-backed Real Device Path
      const isDbConfigured = Boolean(dbAuthenticator && typeof dbAuthenticator.authenticateDevice === 'function');
      if (isDbConfigured) {
        const dbResult = await dbAuthenticator.authenticateDevice({ deviceUid: canonicalUid, rawCredential: rawKey });
        if (dbResult.authenticated) {
          // Verify payload device UID mismatch protection (MUST match physical deviceUid)
          if (payloadDeviceId && payloadDeviceId !== dbResult.deviceUid) {
            return Object.freeze({ authenticated: false, code: 'DEVICE_IDENTITY_MISMATCH' });
          }
          return dbResult;
        }

        // DB authentication is authoritative when configured.
        // DO NOT fall through to legacy auth unless explicit opt-in compatibility flag is enabled.
        if (!allowLegacyRealAuth) {
          return dbResult;
        }
      }

      // 3. Legacy Static Real Device Fallback (Hardware Pilot Fallback)
      if (canonicalUid === 'ESP32-KITCHEN-01') {
        const expectedRealKey = legacyRealDeviceKey || null;
        if (expectedRealKey && timingSafeEqualSecret(rawKey, expectedRealKey)) {
          return Object.freeze({
            authenticated: true,
            databaseDeviceId: 'dev-pilot-kitchen-01',
            deviceId: 'ESP32-KITCHEN-01',
            deviceUid: 'ESP32-KITCHEN-01',
            siteId: 'site-pilot-01',
            zoneId: 'zone-kitchen-01',
            deviceType: 'gateway',
            lifecycleStatus: 'commissioning',
            source: 'LEGACY_REAL_DEVICE',
            workspaceId: 'hardware-pilot'
          });
        }
      }

      return Object.freeze({ authenticated: false, code: 'INVALID_DEVICE_CREDENTIAL' });
    }
  });
}

module.exports = Object.freeze({
  validateRawCredentialFormat,
  hashDeviceCredential,
  createDatabaseDeviceAuthenticator,
  createDeviceAuthManager,
  timingSafeEqualSecret
});
