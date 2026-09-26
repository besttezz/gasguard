'use strict';

const https = require('node:https');
const http = require('node:http');

function createSupabaseDeviceAdapter({ supabaseUrl, serviceRoleKey, fetchClient = null }) {
  const url = (supabaseUrl || process.env.GASGUARD_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = serviceRoleKey || process.env.GASGUARD_SUPABASE_SERVICE_ROLE_KEY || process.env.GASGUARD_SUPABASE_ANON_KEY || '';

  async function callRpc(rpcName, payload) {
    if (!url || !key) {
      throw new Error('Supabase URL or key not configured for server device adapter');
    }

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
        throw new Error(`RPC ${rpcName} failed (${res.status}): ${text}`);
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
            return reject(new Error(`RPC ${rpcName} failed (${res.statusCode}): ${resData}`));
          }
          try {
            resolve(JSON.parse(resData));
          } catch (e) {
            reject(new Error(`Invalid JSON response from RPC ${rpcName}`));
          }
        });
      });

      req.on('error', reject);
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
  createSupabaseDeviceAdapter
});
