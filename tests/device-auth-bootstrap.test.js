'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const authModule = require('../server/device-auth.js');
const { createSupabaseDeviceAdapter, parseRpcError, EnrollmentRpcError } = require('../server/supabase-device-adapter.js');
const { publicAuthConfig } = require('../tools/build-static.js');
const { createDevServer } = require('../server/dev-server.js');
const { createDeviceIngress } = require('../server/device-ingress.js');
const registry = require('../server/device-registry.js');
const { createPipeline } = require('../server/pipeline-runtime.js');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260926223000_device_credential_verification.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration file 20260926223000_device_credential_verification.sql must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');

// Static SQL contract checks
assert.ok(/create\s+or\s+replace\s+function\s+public\.verify_device_credential/i.test(sql));
assert.ok(/security\s+definer/i.test(sql));
assert.ok(/set\s+search_path\s*=\s*''/i.test(sql));
assert.ok(/revoke\s+execute\s+on\s+function\s+public\.verify_device_credential[\s\S]*?from\s+public,\s*anon,\s*authenticated/i.test(sql));
assert.ok(/grant\s+execute\s+on\s+function\s+public\.verify_device_credential[\s\S]*?to\s+service_role/i.test(sql));
assert.ok(sql.includes("p_credential_hash !~ '^[0-9a-f]{64}$'"), 'Exact lowercase 64-hex regex match');

// 1. Supabase adapter refuses missing service-role key
assert.throws(
  () => createSupabaseDeviceAdapter({ supabaseUrl: 'https://test.supabase.co' }),
  /Supabase URL and service-role key required/
);

// 2. Supabase adapter never reads anon key
assert.throws(
  () => createSupabaseDeviceAdapter({
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: null,
    env: { GASGUARD_SUPABASE_ANON_KEY: 'anon-key-should-be-ignored' }
  }),
  /Supabase URL and service-role key required/
);

// 3. Explicit injected service-role key works
const validAdapter = createSupabaseDeviceAdapter({
  supabaseUrl: 'https://test.supabase.co',
  serviceRoleKey: 'test-service-role-key-fixture'
});
assert.ok(validAdapter, 'Adapter constructed cleanly with explicit service-role key');

// 4. createDevServer explicit env does not leak global env config
const isolatedEnv = Object.freeze({ GASGUARD_HOST: '127.0.0.1', GASGUARD_PORT: 5599 });
const isolatedServer = createDevServer({ env: isolatedEnv });

(async () => {
  // 5. No hardcoded test device key & missing test key fails closed
  const authNoTestKey = authModule.createDeviceAuthManager({});
  const testResFail = await authNoTestKey.authenticateIngressRequest({
    deviceUid: 'SIM-ESP32-KITCHEN-01',
    xDeviceKey: 'simulated-esp32-test-key-001'
  });
  assert.equal(testResFail.authenticated, false);
  assert.equal(testResFail.code, 'TEST_CREDENTIAL_NOT_CONFIGURED');

  // 6. Explicit test device key works
  const authWithTestKey = authModule.createDeviceAuthManager({ testDeviceKey: 'explicit-test-key' });
  const testResPass = await authWithTestKey.authenticateIngressRequest({
    deviceUid: 'SIM-ESP32-KITCHEN-01',
    xDeviceKey: 'explicit-test-key'
  });
  assert.equal(testResPass.authenticated, true);
  assert.equal(testResPass.workspaceId, 'device-test');

  // 7. No hardcoded legacy real key & missing legacy real key fails closed
  const authNoLegacyKey = authModule.createDeviceAuthManager({});
  const legacyResFail = await authNoLegacyKey.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    xDeviceKey: 'hardcoded-legacy-fallback'
  });
  assert.equal(legacyResFail.authenticated, false);
  assert.equal(legacyResFail.code, 'INVALID_DEVICE_CREDENTIAL');

  // 8. Explicit legacy real key works
  const authWithLegacyKey = authModule.createDeviceAuthManager({ legacyRealDeviceKey: 'explicit-legacy-key' });
  const legacyResPass = await authWithLegacyKey.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    xDeviceKey: 'explicit-legacy-key'
  });
  assert.equal(legacyResPass.authenticated, true);
  assert.equal(legacyResPass.source, 'LEGACY_REAL_DEVICE');

  // 9. DB Auth takes precedence over legacy real fallback
  const validRawCred = '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
  const hashedCred = authModule.hashDeviceCredential(validRawCred);
  const fakeDbVerify = async ({ deviceUid, credentialHash }) => {
    if (deviceUid === 'ESP32-KITCHEN-01' && credentialHash === hashedCred) {
      return { valid: true, device_id: 'dev-db-01', device_uid: 'ESP32-KITCHEN-01', site_id: 'site-01', zone_id: 'zone-01', device_type: 'gateway', lifecycle_status: 'active' };
    }
    return { valid: false, code: 'INVALID_DEVICE_CREDENTIAL' };
  };

  const dbAuth = authModule.createDatabaseDeviceAuthenticator({ verifyCredential: fakeDbVerify });
  const authWithDbAndLegacy = authModule.createDeviceAuthManager({
    dbAuthenticator: dbAuth,
    legacyRealDeviceKey: 'legacy-key-fixture'
  });

  const dbPrecedenceRes = await authWithDbAndLegacy.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    xDeviceKey: validRawCred
  });
  assert.equal(dbPrecedenceRes.authenticated, true);
  assert.equal(dbPrecedenceRes.source, 'REAL_DEVICE', 'DB auth must take precedence over legacy real fallback');

  // 10. Enrollment token CANNOT authenticate telemetry
  const fakeEnrollmentToken = '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
  const enrollmentTokenAuthRes = await authWithTestKey.authenticateIngressRequest({
    deviceUid: 'SIM-ESP32-KITCHEN-01',
    xDeviceKey: null,
    xEnrollmentToken: fakeEnrollmentToken
  });
  assert.equal(enrollmentTokenAuthRes.authenticated, false, 'Enrollment token must NOT authenticate telemetry ingress');
  assert.equal(enrollmentTokenAuthRes.code, 'CREDENTIAL_REQUIRED');

  // 11. Test key cannot authenticate Real Device
  const testKeyRealDeviceRes = await authWithTestKey.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    xDeviceKey: 'explicit-test-key'
  });
  assert.equal(testKeyRealDeviceRes.authenticated, false);

  // 12. Real legacy key cannot authenticate Test Device
  const realKeyTestDeviceRes = await authWithLegacyKey.authenticateIngressRequest({
    deviceUid: 'SIM-ESP32-KITCHEN-01',
    xDeviceKey: 'explicit-legacy-key'
  });
  assert.equal(realKeyTestDeviceRes.authenticated, false);

  // 13. DB real auth maps hardware-pilot only
  assert.equal(dbPrecedenceRes.workspaceId, 'hardware-pilot');

  // 14. Payload workspace override remains ignored
  const testPipelines = { 'hardware-pilot': createPipeline(root), 'device-test': createPipeline(root) };
  const ingress = createDeviceIngress({ registry, pipelines: testPipelines, authManager: authWithTestKey });

  const rawPayload = { deviceId: 'SIM-ESP32-KITCHEN-01', workspaceId: 'hardware-pilot', sensorId: 'MQ6-01', sensorType: 'MQ6', bootId: 'boot-a', sequence: 0, timestamp: '2026-09-24T00:00:00.000Z', raw: { adc: 1800, sensorVoltage: 1.45 }, upstreamPpm: 120, environment: { temperature: 30, humidity: 64 } };
  const overrideRes = await ingress.ingest({ headers: { 'x-device-key': 'explicit-test-key' }, payload: rawPayload });
  assert.equal(overrideRes.status, 202);
  assert.equal(overrideRes.body.workspaceId, 'device-test', 'Payload workspace choice must be ignored');

  // 15. Payload identity mismatch remains rejected
  const mismatchRes = await authWithDbAndLegacy.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    payloadDeviceId: 'MISMATCHED-UID',
    xDeviceKey: validRawCred
  });
  assert.equal(mismatchRes.authenticated, false);
  assert.equal(mismatchRes.code, 'DEVICE_IDENTITY_MISMATCH');

  // RPC Error Parser Tests
  const parsed1 = parseRpcError({ code: 'P0001', message: 'ENROLLMENT_EXPIRED: Token has expired' }, 400);
  assert.equal(parsed1.code, 'ENROLLMENT_EXPIRED');
  assert.equal(parsed1.message, 'ENROLLMENT_EXPIRED: Token has expired');

  const parsed2 = parseRpcError({ message: 'ENROLLMENT_REVOKED: Token has been revoked' }, 400);
  assert.equal(parsed2.code, 'ENROLLMENT_REVOKED');

  const parsed3 = parseRpcError({ message: 'ENROLLMENT_ALREADY_CLAIMED: Token already claimed' }, 400);
  assert.equal(parsed3.code, 'ENROLLMENT_ALREADY_CLAIMED');

  const parsed4 = parseRpcError({ message: 'DEVICE_IDENTITY_MISMATCH: Target device mismatch' }, 400);
  assert.equal(parsed4.code, 'DEVICE_IDENTITY_MISMATCH');

  const parsedUnknown = parseRpcError({ message: 'internal postgres error' }, 500);
  assert.equal(parsedUnknown.code, 'INTERNAL_ENROLLMENT_ERROR');
  assert.equal(parsedUnknown.message, 'Internal Supabase RPC error');

  // HTTP Enrollment & Health Readiness Tests
  const devServerNoServiceKey = createDevServer({ env: { GASGUARD_HOST: '127.0.0.1', GASGUARD_PORT: 0 } });
  await new Promise(resolve => devServerNoServiceKey.listen(0, '127.0.0.1', resolve));

  try {
    const port = devServerNoServiceKey.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Missing service key returns 503
    const enroll503 = await fetch(`${baseUrl}/api/v1/device/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollmentToken: 'a'.repeat(64), deviceUid: 'DEV-01' })
    });
    assert.equal(enroll503.status, 503);
    const body503 = await enroll503.json();
    assert.equal(body503.code, 'ENROLLMENT_BACKEND_UNAVAILABLE');

    // Health readiness returns truthful config flags
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.readiness.deviceAuth.databaseRealAuthConfigured, false);
    assert.equal(healthBody.readiness.deviceAuth.legacyRealAuthConfigured, false);
    assert.equal(healthBody.readiness.deviceAuth.testAuthConfigured, false);
  } finally {
    await new Promise(resolve => devServerNoServiceKey.close(resolve));
  }

  // Static secret guard test
  assert.throws(
    () => publicAuthConfig({ GASGUARD_SUPABASE_URL: 'https://test.supabase.co', GASGUARD_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature' }),
    /Refusing to publish a Supabase secret/
  );

  console.log('ALL HW-3C1B SERVER CREDENTIAL BOUNDARY HARDENING TESTS PASSED!');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
