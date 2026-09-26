'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const authModule = require('../server/device-auth.js');
const { createSupabaseDeviceAdapter, parseRpcError, EnrollmentRpcError, isValidServerSecret } = require('../server/supabase-device-adapter.js');
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

// Server secret fixtures
const validJwtServiceRole = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature';
const anonJwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature';
const validSbSecret = 'sb_secret_998877665544332211';
const sbPublishableKey = 'sb_publishable_1122334455667788';

// 1. Service role validation function tests
assert.equal(isValidServerSecret(validJwtServiceRole), true, 'Service role JWT must be accepted');
assert.equal(isValidServerSecret(validSbSecret), true, 'sb_secret_ key must be accepted');
assert.equal(isValidServerSecret(anonJwtToken), false, 'anon JWT must be rejected');
assert.equal(isValidServerSecret(sbPublishableKey), false, 'sb_publishable_ key must be rejected');
assert.equal(isValidServerSecret('malformed_secret_key'), false, 'malformed key must be rejected');
assert.equal(isValidServerSecret(''), false, 'empty key must be rejected');

// 2. Supabase adapter refuses invalid server secret / missing key
assert.throws(
  () => createSupabaseDeviceAdapter({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: anonJwtToken }),
  /Valid Supabase service-role key required/
);
assert.throws(
  () => createSupabaseDeviceAdapter({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: sbPublishableKey }),
  /Valid Supabase service-role key required/
);
assert.throws(
  () => createSupabaseDeviceAdapter({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: '' }),
  /Valid Supabase service-role key required/
);

// 3. Supabase adapter constructor does not fall back to global process.env when empty argument is given
const originalEnvKey = process.env.GASGUARD_SUPABASE_SERVICE_ROLE_KEY;
try {
  process.env.GASGUARD_SUPABASE_SERVICE_ROLE_KEY = validJwtServiceRole;
  assert.throws(
    () => createSupabaseDeviceAdapter({ supabaseUrl: 'https://test.supabase.co', serviceRoleKey: null }),
    /Valid Supabase service-role key required/
  );
} finally {
  process.env.GASGUARD_SUPABASE_SERVICE_ROLE_KEY = originalEnvKey;
}

// 4. Explicit injected valid service-role key works
const validAdapter = createSupabaseDeviceAdapter({
  supabaseUrl: 'https://test.supabase.co',
  serviceRoleKey: validJwtServiceRole
});
assert.ok(validAdapter, 'Adapter constructed cleanly with valid service-role key');

// 5. createDeviceAuthManager does NOT read global process.env
try {
  process.env.GASGUARD_TEST_DEVICE_KEY = 'global-env-test-key';
  process.env.GASGUARD_REAL_DEVICE_KEY = 'global-env-real-key';

  const authEnvIsolated = authModule.createDeviceAuthManager({});
  (async () => {
    const res1 = await authEnvIsolated.authenticateIngressRequest({ deviceUid: 'SIM-ESP32-KITCHEN-01', xDeviceKey: 'global-env-test-key' });
    assert.equal(res1.authenticated, false, 'createDeviceAuthManager must NOT read process.env.GASGUARD_TEST_DEVICE_KEY');

    const res2 = await authEnvIsolated.authenticateIngressRequest({ deviceUid: 'ESP32-KITCHEN-01', xDeviceKey: 'global-env-real-key' });
    assert.equal(res2.authenticated, false, 'createDeviceAuthManager must NOT read process.env.GASGUARD_REAL_DEVICE_KEY');
  })();
} finally {
  delete process.env.GASGUARD_TEST_DEVICE_KEY;
  delete process.env.GASGUARD_REAL_DEVICE_KEY;
}

(async () => {
  // 6. Test Key & Legacy Real Key explicit injection works
  const authWithTestKey = authModule.createDeviceAuthManager({ testDeviceKey: 'explicit-test-key' });
  const testResPass = await authWithTestKey.authenticateIngressRequest({
    deviceUid: 'SIM-ESP32-KITCHEN-01',
    xDeviceKey: 'explicit-test-key'
  });
  assert.equal(testResPass.authenticated, true);
  assert.equal(testResPass.workspaceId, 'device-test');
  assert.equal(testResPass.deviceId, 'SIM-ESP32-KITCHEN-01', 'Physical deviceUid is telemetry deviceId');
  assert.equal(testResPass.databaseDeviceId, 'dev-sim-kitchen-01', 'Database ID separated as databaseDeviceId');

  const authWithLegacyKey = authModule.createDeviceAuthManager({ legacyRealDeviceKey: 'explicit-legacy-key' });
  const legacyResPass = await authWithLegacyKey.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    xDeviceKey: 'explicit-legacy-key'
  });
  assert.equal(legacyResPass.authenticated, true);
  assert.equal(legacyResPass.source, 'LEGACY_REAL_DEVICE');
  assert.equal(legacyResPass.deviceId, 'ESP32-KITCHEN-01');
  assert.equal(legacyResPass.databaseDeviceId, 'dev-pilot-kitchen-01');

  // 7. DB Auth is AUTHORITATIVE (Prevent Auth Downgrade)
  const validRawCred = '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
  const hashedCred = authModule.hashDeviceCredential(validRawCred);

  // Mock DB authenticator where device exists and active credential matches
  const fakeDbVerifySuccess = async ({ deviceUid, credentialHash }) => {
    if (deviceUid === 'ESP32-KITCHEN-01' && credentialHash === hashedCred) {
      return { valid: true, device_id: 'db-uuid-1234-5678', device_uid: 'ESP32-KITCHEN-01', site_id: 'site-01', zone_id: 'zone-01', device_type: 'gateway', lifecycle_status: 'active' };
    }
    return { valid: false, code: 'INVALID_DEVICE_CREDENTIAL' };
  };
  const dbAuthSuccess = authModule.createDatabaseDeviceAuthenticator({ verifyCredential: fakeDbVerifySuccess });

  // Mock DB authenticator where credential is REVOKED
  const fakeDbVerifyRevoked = async ({ deviceUid }) => {
    if (deviceUid === 'ESP32-KITCHEN-01') {
      return { valid: false, code: 'INVALID_DEVICE_CREDENTIAL' };
    }
    return { valid: false, code: 'INVALID_DEVICE_CREDENTIAL' };
  };
  const dbAuthRevoked = authModule.createDatabaseDeviceAuthenticator({ verifyCredential: fakeDbVerifyRevoked });

  // A) Successful DB auth returns REAL_DEVICE and separates databaseDeviceId vs deviceId/deviceUid
  const authAuthoritative = authModule.createDeviceAuthManager({
    dbAuthenticator: dbAuthSuccess,
    legacyRealDeviceKey: 'explicit-legacy-key'
  });
  const dbPassRes = await authAuthoritative.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    xDeviceKey: validRawCred
  });
  assert.equal(dbPassRes.authenticated, true);
  assert.equal(dbPassRes.source, 'REAL_DEVICE');
  assert.equal(dbPassRes.deviceId, 'ESP32-KITCHEN-01', 'deviceId must be physical deviceUid');
  assert.equal(dbPassRes.databaseDeviceId, 'db-uuid-1234-5678', 'databaseDeviceId is internal database UUID');

  // B) Revoked/Invalid DB auth MUST NOT fall through to legacy auth (Prevents Auth Downgrade)
  const validHexLegacyKey = 'a'.repeat(64);
  const authRevokedDB = authModule.createDeviceAuthManager({
    dbAuthenticator: dbAuthRevoked,
    legacyRealDeviceKey: validHexLegacyKey // Legacy key matches supplied legacy key!
  });
  const dbRevokedRes = await authRevokedDB.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    xDeviceKey: validHexLegacyKey
  });
  assert.equal(dbRevokedRes.authenticated, false, 'When DB auth is configured, DB rejection MUST NOT fall back to legacy key');
  assert.equal(dbRevokedRes.code, 'INVALID_DEVICE_CREDENTIAL');

  // C) Revocation invariant: Revoking DB credential stops auth even if legacy key is supplied
  const dbRevocationBypassAttempt = await authRevokedDB.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    xDeviceKey: validRawCred
  });
  assert.equal(dbRevocationBypassAttempt.authenticated, false, 'Revoked DB credential cannot be bypassed with legacy key');

  // D) Explicit allowLegacyRealAuth flag enables opt-in compatibility fallback
  const authWithOptInFallback = authModule.createDeviceAuthManager({
    dbAuthenticator: dbAuthRevoked,
    legacyRealDeviceKey: 'explicit-legacy-key',
    allowLegacyRealAuth: true
  });
  const optInRes = await authWithOptInFallback.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    xDeviceKey: 'explicit-legacy-key'
  });
  assert.equal(optInRes.authenticated, true, 'Opt-in allowLegacyRealAuth permits fallback when DB fails');
  assert.equal(optInRes.source, 'LEGACY_REAL_DEVICE');

  // 8. Constant-time static credential comparison test
  assert.equal(authModule.timingSafeEqualSecret('secret-a', 'secret-a'), true);
  assert.equal(authModule.timingSafeEqualSecret('secret-a', 'secret-b'), false);
  assert.equal(authModule.timingSafeEqualSecret('short', 'much-longer-secret'), false);
  assert.equal(authModule.timingSafeEqualSecret(null, 'secret'), false);

  // 9. Protocol identity check: internal DB UUID cannot be used as telemetry deviceId
  const dbUuidMatchRes = await authAuthoritative.authenticateIngressRequest({
    deviceUid: 'ESP32-KITCHEN-01',
    payloadDeviceId: 'db-uuid-1234-5678', // Passing internal DB UUID instead of physical deviceUid!
    xDeviceKey: validRawCred
  });
  assert.equal(dbUuidMatchRes.authenticated, false, 'Payload device ID presented as DB UUID must fail');
  assert.equal(dbUuidMatchRes.code, 'DEVICE_IDENTITY_MISMATCH');

  // 10. Ingress Header Authentication (x-device-key vs Authorization: Bearer vs invalid schemes)
  const testPipelines = { 'hardware-pilot': createPipeline(root), 'device-test': createPipeline(root) };
  const ingress = createDeviceIngress({ registry, pipelines: testPipelines, authManager: authWithTestKey });
  const samplePayload = { deviceId: 'SIM-ESP32-KITCHEN-01', sensorId: 'MQ6-01', sensorType: 'MQ6', bootId: 'boot-a', sequence: 0, timestamp: '2026-09-24T00:00:00.000Z', raw: { adc: 1800, sensorVoltage: 1.45 }, upstreamPpm: 120, environment: { temperature: 30, humidity: 64 } };

  // A) x-device-key header succeeds
  const xKeyIngest = await ingress.ingest({ headers: { 'x-device-key': 'explicit-test-key' }, payload: { ...samplePayload, sequence: 1 } });
  assert.equal(xKeyIngest.status, 202);

  // B) Authorization: Bearer <key> header succeeds
  const bearerIngest = await ingress.ingest({ headers: { 'authorization': 'Bearer explicit-test-key' }, payload: { ...samplePayload, sequence: 2 } });
  assert.equal(bearerIngest.status, 202);

  // C) Authorization: Basic <key> fails (ignored/invalid scheme)
  const basicIngest = await ingress.ingest({ headers: { 'authorization': 'Basic explicit-test-key' }, payload: samplePayload });
  assert.equal(basicIngest.status, 401, 'Basic authorization scheme must be rejected');

  // D) Bare Authorization value fails
  const bareIngest = await ingress.ingest({ headers: { 'authorization': 'explicit-test-key' }, payload: samplePayload });
  assert.equal(bareIngest.status, 401, 'Bare authorization value without Bearer scheme must be rejected');

  // E) Enrollment token in Authorization header fails
  const fakeEnrollmentToken = '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
  const enrollIngest = await ingress.ingest({ headers: { 'authorization': `Bearer ${fakeEnrollmentToken}` }, payload: samplePayload });
  assert.equal(enrollIngest.status, 401, 'Enrollment token cannot authenticate telemetry');

  // 11. RPC Error Parser Tests
  const parsed1 = parseRpcError({ code: 'P0001', message: 'ENROLLMENT_EXPIRED: Token has expired' }, 400);
  assert.equal(parsed1.code, 'ENROLLMENT_EXPIRED');

  const parsedUnknown = parseRpcError({ message: 'internal postgres error' }, 500);
  assert.equal(parsedUnknown.code, 'INTERNAL_ENROLLMENT_ERROR');

  // 12. HTTP Enrollment & Health Readiness Truthfulness Tests
  // A) Server with invalid service role key (e.g. anon key string) returns health databaseRealAuthConfigured = false
  const devServerBadKey = createDevServer({
    env: { GASGUARD_HOST: '127.0.0.1', GASGUARD_PORT: 0, GASGUARD_SUPABASE_URL: 'https://demo.supabase.co', GASGUARD_SUPABASE_SERVICE_ROLE_KEY: anonJwtToken }
  });
  await new Promise(resolve => devServerBadKey.listen(0, '127.0.0.1', resolve));

  try {
    const port = devServerBadKey.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // Enrollment returns 503 since backend adapter could not be created with anon key
    const enroll503 = await fetch(`${baseUrl}/api/v1/device/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollmentToken: 'a'.repeat(64), deviceUid: 'DEV-01' })
    });
    assert.equal(enroll503.status, 503);
    const body503 = await enroll503.json();
    assert.equal(body503.code, 'ENROLLMENT_BACKEND_UNAVAILABLE');

    // Health readiness returns databaseRealAuthConfigured = false for random/anon key
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.readiness.deviceAuth.databaseRealAuthConfigured, false, 'Random/anon key must NOT make databaseRealAuthConfigured true');
  } finally {
    await new Promise(resolve => devServerBadKey.close(resolve));
  }

  // B) Server with valid service role key returns health databaseRealAuthConfigured = true
  const devServerGoodKey = createDevServer({
    env: { GASGUARD_HOST: '127.0.0.1', GASGUARD_PORT: 0, GASGUARD_SUPABASE_URL: 'https://demo.supabase.co', GASGUARD_SUPABASE_SERVICE_ROLE_KEY: validJwtServiceRole }
  });
  await new Promise(resolve => devServerGoodKey.listen(0, '127.0.0.1', resolve));

  try {
    const port = devServerGoodKey.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const healthRes = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.readiness.deviceAuth.databaseRealAuthConfigured, true, 'Valid service role key must make databaseRealAuthConfigured true');
  } finally {
    await new Promise(resolve => devServerGoodKey.close(resolve));
  }

  // 13. Static secret build guard test
  assert.throws(
    () => publicAuthConfig({ GASGUARD_SUPABASE_URL: 'https://test.supabase.co', GASGUARD_SUPABASE_ANON_KEY: validJwtServiceRole }),
    /Refusing to publish a Supabase secret/
  );

  console.log('ALL HW-3C1C AUTHORITATIVE DEVICE AUTH FINALIZATION TESTS PASSED!');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
