'use strict';

/**
 * =============================================================================
 * GASGUARD REMOTE HARDWARE GATEWAY SMOKE TEST TOOL
 *
 * Verifies safe remote gateway health readiness and public HTTPS endpoint
 * reachability for HW-4 Remote Hardware Pilot deployments.
 *
 * Usage:
 *   node tools/remote-hardware-smoke.js [target-public-url]
 * Example:
 *   node tools/remote-hardware-smoke.js https://device-api.example.com
 * =============================================================================
 */

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

async function performHttpRequest(targetUrl, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = client.request(reqOptions, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data || '{}') });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runRemoteHardwareSmoke(targetBaseUrl) {
  if (!targetBaseUrl || typeof targetBaseUrl !== 'string') {
    throw new Error('Target base URL required. Usage: node tools/remote-hardware-smoke.js <https://target-url>');
  }

  const normalizedUrl = targetBaseUrl.trim().replace(/\/+$/, '');
  if (!normalizedUrl.startsWith('https://') && !normalizedUrl.startsWith('http://127.0.0.1') && !normalizedUrl.startsWith('http://localhost')) {
    throw new Error('HTTPS URL required for remote hardware gateway smoke test');
  }

  console.log(`[GasGuard Smoke] Target Gateway: ${normalizedUrl}`);

  // 1. Check GET /api/v1/health
  const healthUrl = `${normalizedUrl}/api/v1/health`;
  console.log(`[GasGuard Smoke] Querying health status: ${healthUrl}`);
  const healthRes = await performHttpRequest(healthUrl);

  if (healthRes.status !== 200 || !healthRes.body || !healthRes.body.ok) {
    console.error(`[GasGuard Smoke] Health query failed with HTTP ${healthRes.status}`);
    return { ok: false, error: 'HEALTH_QUERY_FAILED', status: healthRes.status };
  }

  const remoteGateway = healthRes.body.readiness?.remoteGateway || {};
  console.log(`[GasGuard Smoke] Remote Gateway Mode: ${remoteGateway.mode || 'UNKNOWN'}`);
  console.log(`[GasGuard Smoke] Trusted Tunnel Configured: ${Boolean(remoteGateway.trustedTunnelConfigured)}`);
  console.log(`[GasGuard Smoke] Expected Host Configured: ${Boolean(remoteGateway.expectedHostConfigured)}`);
  console.log(`[GasGuard Smoke] Loopback Origin: ${Boolean(remoteGateway.loopbackOrigin)}`);

  // 2. Safe unauthenticated telemetry rejection smoke test
  const telemetryUrl = `${normalizedUrl}/api/v1/device/telemetry`;
  console.log(`[GasGuard Smoke] Testing unauthenticated telemetry endpoint rejection: ${telemetryUrl}`);
  const telemetryRes = await performHttpRequest(telemetryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { deviceId: 'SMOKE-TEST-01', measurements: [] });

  console.log(`[GasGuard Smoke] Telemetry endpoint returned HTTP ${telemetryRes.status} (expected 401/403)`);

  const ok = healthRes.status === 200 && (telemetryRes.status === 401 || telemetryRes.status === 403);
  return {
    ok,
    healthStatus: healthRes.status,
    remoteGatewayMode: remoteGateway.mode,
    unauthenticatedTelemetryStatus: telemetryRes.status
  };
}

if (require.main === module) {
  const target = process.argv[2] || 'http://127.0.0.1:5567';
  runRemoteHardwareSmoke(target)
    .then(res => {
      console.log(`\n[GasGuard Smoke Result] ${res.ok ? 'SUCCESS' : 'FAILED'}`);
      process.exit(res.ok ? 0 : 1);
    })
    .catch(err => {
      console.error(`\n[GasGuard Smoke Error] ${err.message}`);
      process.exit(1);
    });
}

module.exports = { runRemoteHardwareSmoke };
