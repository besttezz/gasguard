'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const authModule = require('../server/device-auth.js');
const { createSupabaseDeviceAdapter } = require('../server/supabase-device-adapter.js');
const { publicAuthConfig } = require('../tools/build-static.js');
const { createDevServer } = require('../server/dev-server.js');
const { createDeviceIngress } = require('../server/device-ingress.js');
const registry = require('../server/device-registry.js');
const { createPipeline } = require('../server/pipeline-runtime.js');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260926223000_device_credential_verification.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration file 20260926223000_device_credential_verification.sql must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');

// 1-7: Verify SQL migration static contract
assert.ok(/create\s+or\s+replace\s+function\s+public\.verify_device_credential/i.test(sql), 'verify_device_credential function must be defined');
assert.ok(/security\s+definer/i.test(sql), 'Function must be SECURITY DEFINER');
assert.ok(/set\s+search_path\s*=\s*''/i.test(sql), 'Function must set search_path = \'\'');
assert.ok(/revoke\s+execute\s+on\s+function\s+public\.verify_device_credential[\s\S]*?from\s+public,\s*anon,\s*authenticated/i.test(sql), 'EXECUTE revoked from public, anon, AND authenticated');
assert.ok(/grant\s+execute\s+on\s+function\s+public\.verify_device_credential[\s\S]*?to\s+service_role/i.test(sql), 'EXECUTE granted ONLY to service_role');
assert.ok(sql.includes("^[0-9a-f]{64}$"), 'Requires 64 hex character credential hash validation via regex');
assert.ok(sql.includes("lifecycle_status not in ('commissioning', 'active')"), 'Rejects registered and retired devices');

// 8-16: Hashing & Validation Unit Tests
const validRawCred = '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
assert.equal(authModule.validateRawCredentialFormat(validRawCred), true);
assert.equal(authModule.validateRawCredentialFormat('SHORT_KEY'), false);
assert.equal(authModule.validateRawCredentialFormat('z'.repeat(64)), false);

const hashedCred = authModule.hashDeviceCredential(validRawCred);
assert.equal(hashedCred.length, 64);
assert.equal(/^[0-9a-f]{64}$/.test(hashedCred), true);
assert.notEqual(hashedCred, validRawCred, 'hashDeviceCredential must never return raw credential');

// 17-18: DB Adapter receives HASH ONLY
let receivedArgs = null;
const fakeVerifyAdapter = async ({ deviceUid, credentialHash }) => {
  receivedArgs = { deviceUid, credentialHash };
  if (deviceUid === 'ESP32-KITCHEN-01' && credentialHash === hashedCred) {
    return { valid: true, device_id: 'dev-01', device_uid: 'ESP32-KITCHEN-01', site_id: 'site-01', zone_id: 'zone-01', device_type: 'gateway', lifecycle_status: 'active' };
  }
  return { valid: false, code: 'INVALID_DEVICE_CREDENTIAL' };
};

const dbAuth = authModule.createDatabaseDeviceAuthenticator({ verifyCredential: fakeVerifyAdapter });

(async () => {
  const authRes = await dbAuth.authenticateDevice({ deviceUid: 'ESP32-KITCHEN-01', rawCredential: validRawCred });
  assert.equal(receivedArgs.credentialHash, hashedCred, 'DB adapter must receive HASH ONLY');
  assert.notEqual(receivedArgs.credentialHash, validRawCred, 'DB adapter must NEVER receive raw credential');
  assert.equal(authRes.authenticated, true);
  assert.equal(authRes.workspaceId, 'hardware-pilot');
  assert.equal(authRes.source, 'REAL_DEVICE');

  // Diagnostic secret leak test
  const diagStr = JSON.stringify(authRes);
  assert.equal(diagStr.includes(validRawCred), false);
  assert.equal(diagStr.includes(hashedCred), false);

  // 19-22: Test vs Real Device Isolation & Ingress Provider
  const authManager = authModule.createDeviceAuthManager({ dbAuthenticator: dbAuth, testDeviceKey: 'test-virtual-key-fixture' });

  // Virtual Test device path
  const testAuth = await authManager.authenticateIngressRequest({ deviceUid: 'SIM-ESP32-KITCHEN-01', xDeviceKey: 'test-virtual-key-fixture' });
  assert.equal(testAuth.authenticated, true);
  assert.equal(testAuth.workspaceId, 'device-test');
  assert.equal(testAuth.source, 'TEST_DEVICE');

  // Real device path
  const realAuth = await authManager.authenticateIngressRequest({ deviceUid: 'ESP32-KITCHEN-01', xDeviceKey: validRawCred });
  assert.equal(realAuth.authenticated, true);
  assert.equal(realAuth.workspaceId, 'hardware-pilot');
  assert.equal(realAuth.source, 'REAL_DEVICE');

  // Payload device UID mismatch rejected
  const mismatchAuth = await authManager.authenticateIngressRequest({ deviceUid: 'ESP32-KITCHEN-01', payloadDeviceId: 'DIFFERENT-UID', xDeviceKey: validRawCred });
  assert.equal(mismatchAuth.authenticated, false);
  assert.equal(mismatchAuth.code, 'DEVICE_IDENTITY_MISMATCH');

  // Workspace boundary test: payload cannot choose its workspace (workspace comes from registry/auth)
  const testPipelines = { 'hardware-pilot': createPipeline(root), 'device-test': createPipeline(root) };
  const ingress = createDeviceIngress({ registry, pipelines: testPipelines, authManager });

  const rawPayload = { deviceId: 'SIM-ESP32-KITCHEN-01', workspaceId: 'hardware-pilot', sensorId: 'MQ6-01', sensorType: 'MQ6', bootId: 'boot-a', sequence: 0, timestamp: '2026-09-24T00:00:00.000Z', raw: { adc: 1800, sensorVoltage: 1.45 }, upstreamPpm: 120, environment: { temperature: 30, humidity: 64 } };
  const overrideRes = await ingress.ingest({ headers: { 'x-device-key': 'test-virtual-key-fixture' }, payload: rawPayload });
  assert.equal(overrideRes.status, 202, 'Payload workspace choice must be ignored');
  assert.equal(overrideRes.body.workspaceId, 'device-test', 'Incoming payload must never choose its own workspace');

  // 23-26: Enrollment HTTP Route & LAN Fail-Closed Tests
  const fakeEnrollService = {
    async claimDeviceEnrollment({ rawEnrollmentToken, expectedDeviceUid }) {
      if (!/^[0-9a-fA-F]{64}$/.test(rawEnrollmentToken)) {
        return { ok: false, code: 'INVALID_TOKEN_FORMAT', error: 'Raw token must be 64 hex characters' };
      }
      if (rawEnrollmentToken === '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff') {
        return { ok: true, data: { device_uid: expectedDeviceUid, raw_device_credential: 'a'.repeat(64), device_lifecycle: 'commissioning' } };
      }
      return { ok: false, code: 'ENROLLMENT_EXPIRED', error: 'Token has expired' };
    }
  };

  const devServer = createDevServer({ enrollmentService: fakeEnrollService });
  await new Promise(resolve => devServer.listen(0, '127.0.0.1', resolve));

  try {
    const port = devServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 23: Reject malformed token
    const malformedRes = await fetch(`${baseUrl}/api/v1/device/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollmentToken: 'short', deviceUid: 'DEV-01' })
    });
    assert.equal(malformedRes.status, 400);

    // 24: Localhost enrollment contract works
    const validRes = await fetch(`${baseUrl}/api/v1/device/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enrollmentToken: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff', deviceUid: 'DEV-01' })
    });
    assert.equal(validRes.status, 201);
    const validBody = await validRes.json();
    assert.equal(validBody.ok, true);
    assert.equal(validBody.deviceCredential, 'a'.repeat(64));
    assert.equal(validBody.lifecycle, 'commissioning');

    // Secret check on response: no hashes/secrets exposed
    assert.equal(JSON.stringify(validBody).includes('token_hash'), false);
    assert.equal(JSON.stringify(validBody).includes('credential_hash'), false);

    // 25-26: LAN transport security fail-closed default
    const lanServer = createDevServer({
      env: { ...process.env, GASGUARD_HOST: '0.0.0.0' },
      enrollmentService: fakeEnrollService
    });
    await new Promise(resolve => lanServer.listen(0, '127.0.0.1', resolve));

    try {
      const lanPort = lanServer.address().port;
      const lanRes = await fetch(`http://127.0.0.1:${lanPort}/api/v1/device/enroll`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'host': '192.168.1.100:5567' },
        body: JSON.stringify({ enrollmentToken: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff', deviceUid: 'DEV-01' })
      });
      assert.equal(lanRes.status, 403, 'LAN non-localhost enrollment must fail closed by default');
      const lanBody = await lanRes.json();
      assert.equal(lanBody.code, 'ENROLLMENT_INSECURE_TRANSPORT');
    } finally {
      await new Promise(resolve => lanServer.close(resolve));
    }
  } finally {
    await new Promise(resolve => devServer.close(resolve));
  }

  // 27: Static build secret guard
  assert.throws(
    () => publicAuthConfig({ GASGUARD_SUPABASE_URL: 'https://test.supabase.co', GASGUARD_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature' }),
    /Refusing to publish a Supabase secret/
  );

  console.log('HW-3C1 device auth bootstrap foundation tests passed!');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
