'use strict';

const https = require('node:https');
const http = require('node:http');

class EnrollmentRpcError extends Error {
  constructor(code, message, upstreamStatus = 500) {
    super(message);
    this.name = 'EnrollmentRpcError';
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}

const TRUSTED_RPC_ERRORS = new Set([
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
  'ACTIVE_CREDENTIAL_EXISTS',
  'INVALID_DEVICE_CREDENTIAL',
  'INVALID_CREDENTIAL_FORMAT',
  'INVALID_DEVICE_UID'
]);

function parseRpcError(resData, status) {
  let parsed = null;
  if (typeof resData === 'string') {
    try { parsed = JSON.parse(resData); } catch (e) { parsed = null; }
  } else if (resData && typeof resData === 'object') {
    parsed = resData;
  }

  const rawMsg = parsed?.message || (typeof resData === 'string' ? resData : '');
  const match = typeof rawMsg === 'string' ? rawMsg.match(/^([A-Z_]+):\s*(.*)$/) : null;

  if (match && TRUSTED_RPC_ERRORS.has(match[1])) {
    return new EnrollmentRpcError(match[1], `${match[1]}: ${match[2].trim()}`, status);
  }

  if (parsed?.code && TRUSTED_RPC_ERRORS.has(parsed.code)) {
    return new EnrollmentRpcError(parsed.code, rawMsg || parsed.code, status);
  }

  return new EnrollmentRpcError('INTERNAL_ENROLLMENT_ERROR', 'Internal Supabase RPC error', status);
}

function createSupabaseDeviceAdapter({ supabaseUrl, serviceRoleKey, fetchClient = null }) {
  const url = (supabaseUrl || process.env.GASGUARD_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = serviceRoleKey || process.env.GASGUARD_SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !key) {
    throw new Error('Supabase URL and service-role key required for device adapter');
  }

  async function callRpc(rpcName, payload) {
    if (fetchClient) {
      const res = await fetchClient(`${url}/rest/v1/rpc/${rpcName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const text = await res.text();
        throw parseRpcError(text, res.status);
      }
      return await res.json();
    }

    // Default Node HTTP/HTTPS request
    const endpoint = new URL(`${url}/rest/v1/rpc/${rpcName}`);
    const transport = endpoint.protocol === 'https:' ? https : http;
    const bodyStr = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const req = transport.request(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          'apikey': key,
          'Authorization': `Bearer ${key}`
        }
      }, (res) => {
        let resData = '';
        res.on('data', chunk => resData += chunk);
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(parseRpcError(resData, res.statusCode));
          }
          try {
            resolve(JSON.parse(resData));
          } catch (e) {
            reject(new EnrollmentRpcError('INTERNAL_ENROLLMENT_ERROR', `Invalid JSON response from RPC ${rpcName}`, res.statusCode));
          }
        });
      });

      req.on('error', (err) => reject(new EnrollmentRpcError('INTERNAL_ENROLLMENT_ERROR', err.message)));
      req.write(bodyStr);
      req.end();
    });
  }

  return Object.freeze({
    async claimEnrollment({ rawEnrollmentToken, expectedDeviceUid = null }) {
      return await callRpc('claim_device_enrollment', {
        p_raw_enrollment_token: rawEnrollmentToken,
        p_expected_device_uid: expectedDeviceUid
      });
    },

    async verifyCredential({ deviceUid, credentialHash }) {
      return await callRpc('verify_device_credential', {
        p_device_uid: deviceUid,
        p_credential_hash: credentialHash
      });
    }
  });
}

module.exports = Object.freeze({
  createSupabaseDeviceAdapter,
  EnrollmentRpcError,
  parseRpcError
});
