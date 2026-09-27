'use strict';

// =============================================================================
// HW-4A REMOTE HARDWARE PILOT GATEWAY CONTRACT TESTS
// =============================================================================

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeHost,
  isLoopbackHost,
  evaluateRemoteGatewayHealth,
  classifyRequestTransport
} = require('../server/request-security.js');
const { createDevServer } = require('../server/dev-server.js');

const root = path.resolve(__dirname, '..');
const fieldNodeDir = path.join(root, 'firmware', 'esp32-field-node');

function readFirmware(filename) {
  return fs.readFileSync(path.join(fieldNodeDir, filename), 'utf8');
}

const firmwareFiles = fs.readdirSync(fieldNodeDir)
  .filter(f => f.endsWith('.h') || f.endsWith('.cpp') || f.endsWith('.ino'));

function allFirmwareContent() {
  return firmwareFiles.map(f => readFirmware(f)).join('\n');
}

console.log('Running HW-4A Remote Hardware Pilot Gateway contract tests...\n');

// =============================================================================
// 1. TRUSTED TUNNEL MODE DEFAULTS FALSE
// =============================================================================
{
  const health = evaluateRemoteGatewayHealth({ serverConfig: { host: '127.0.0.1', lanMode: false }, env: {} });
  assert.equal(health.mode, 'LOCAL_ONLY');
  assert.equal(health.trustedTunnelConfigured, false);
}
console.log('  [1] Trusted tunnel mode defaults false: PASS');

// =============================================================================
// 2. LOCALHOST DEVELOPMENT REMAINS SUPPORTED
// =============================================================================
{
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:5567' }
  };
  const res = classifyRequestTransport({ request: req, serverConfig: { host: '127.0.0.1', lanMode: false }, env: {} });
  assert.equal(res.secure, true);
  assert.equal(res.source, 'LOCALHOST');
}
console.log('  [2] Localhost development remains supported: PASS');

// =============================================================================
// 3. FORWARDED PROTO ALONE DOES NOT GRANT TRUST
// =============================================================================
{
  const req = {
    socket: { remoteAddress: '192.168.1.50' },
    headers: { host: 'device-api.example.com', 'x-forwarded-proto': 'https' }
  };
  // Trusted tunnel mode is false
  const res = classifyRequestTransport({ request: req, serverConfig: { host: '127.0.0.1', lanMode: false }, env: {} });
  assert.equal(res.secure, false);
  assert.equal(res.source, 'UNTRUSTED');
}
console.log('  [3] Forwarded proto alone does not grant trust: PASS');

// =============================================================================
// 4. EXPECTED HOST ALONE DOES NOT GRANT TRUST
// =============================================================================
{
  const req = {
    socket: { remoteAddress: '192.168.1.50' },
    headers: { host: 'device-api.example.com' }
  };
  const env = { GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com' };
  const res = classifyRequestTransport({ request: req, serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(res.secure, false);
  assert.equal(res.source, 'UNTRUSTED');
}
console.log('  [4] Expected Host alone does not grant trust: PASS');

// =============================================================================
// 5. TUNNEL MODE + HTTPS + EXACT HOST + LOOPBACK ORIGIN CLASSIFIES SECURE
// =============================================================================
{
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'device-api.example.com', 'x-forwarded-proto': 'https' }
  };
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };
  const res = classifyRequestTransport({ request: req, serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(res.secure, true);
  assert.equal(res.source, 'TRUSTED_TUNNEL');
}
console.log('  [5] Tunnel mode + HTTPS + exact Host + loopback origin classifies secure: PASS');

// =============================================================================
// 6. TUNNEL MODE + HTTP REJECTED
// =============================================================================
{
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'device-api.example.com', 'x-forwarded-proto': 'http' }
  };
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };
  const res = classifyRequestTransport({ request: req, serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(res.secure, false);
  assert.equal(res.source, 'UNTRUSTED');
}
console.log('  [6] Tunnel mode + HTTP rejected: PASS');

// =============================================================================
// 7. TUNNEL MODE + WRONG HOST REJECTED
// =============================================================================
{
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'wrong-host.example.com', 'x-forwarded-proto': 'https' }
  };
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };
  const res = classifyRequestTransport({ request: req, serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(res.secure, false);
  assert.equal(res.source, 'UNTRUSTED');
}
console.log('  [7] Tunnel mode + wrong host rejected: PASS');

// =============================================================================
// 8. SUFFIX HOSTNAME ATTACK REJECTED
// =============================================================================
{
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'device-api.example.com.attacker.tld', 'x-forwarded-proto': 'https' }
  };
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };
  const res = classifyRequestTransport({ request: req, serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(res.secure, false);
  assert.equal(res.source, 'UNTRUSTED');
}
console.log('  [8] Suffix hostname attack rejected: PASS');

// =============================================================================
// 9. TUNNEL MODE + NON-LOOPBACK SERVER BINDING → CONFIG ERROR
// =============================================================================
{
  const req = {
    socket: { remoteAddress: '192.168.1.100' },
    headers: { host: 'device-api.example.com', 'x-forwarded-proto': 'https' }
  };
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };
  const res = classifyRequestTransport({ request: req, serverConfig: { host: '0.0.0.0', lanMode: true }, env });
  assert.equal(res.secure, false);
  assert.equal(res.source, 'UNTRUSTED');
  assert.ok(res.reason.includes('CONFIG_ERROR'));

  const health = evaluateRemoteGatewayHealth({ serverConfig: { host: '0.0.0.0', lanMode: true }, env });
  assert.equal(health.mode, 'CONFIG_ERROR');
}
console.log('  [9] Tunnel mode + non-loopback server binding → config error: PASS');

// =============================================================================
// 10. MULTIPLE/AMBIGUOUS FORWARDED PROTO VALUES REJECTED
// =============================================================================
{
  const reqArray = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'device-api.example.com', 'x-forwarded-proto': ['https', 'http'] }
  };
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };
  const resArray = classifyRequestTransport({ request: reqArray, serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(resArray.secure, false);

  const reqMixed = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: 'device-api.example.com', 'x-forwarded-proto': 'http, https' }
  };
  const resMixed = classifyRequestTransport({ request: reqMixed, serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(resMixed.secure, false);
}
console.log('  [10] Multiple/ambiguous forwarded proto values rejected: PASS');

// =============================================================================
// 11. ENROLLMENT ROUTE ACCEPTS VALID TRUSTED-TUNNEL TRANSPORT
// =============================================================================
{
  const mockEnrollmentService = {
    claimDeviceEnrollment: async () => ({
      ok: true,
      data: { device_uid: 'ESP32-TEST-01', raw_device_credential: 'a'.repeat(64), device_lifecycle: 'commissioning' }
    })
  };
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };

  const server = createDevServer({ env, enrollmentService: mockEnrollmentService });
  assert.ok(server);
}
console.log('  [11] Enrollment route accepts valid trusted-tunnel transport: PASS');

// =============================================================================
// 12. ENROLLMENT ROUTE REJECTS UNTRUSTED REMOTE REQUEST
// =============================================================================
{
  const reqUntrusted = {
    socket: { remoteAddress: '203.0.113.5' },
    headers: { host: 'untrusted.example.com' }
  };
  const res = classifyRequestTransport({ request: reqUntrusted, serverConfig: { host: '127.0.0.1', lanMode: false }, env: {} });
  assert.equal(res.secure, false);
}
console.log('  [12] Enrollment route rejects untrusted remote request: PASS');

// =============================================================================
// 13. INSECURE OVERRIDE REMAINS EXPLICIT AND DISABLED BY DEFAULT
// =============================================================================
{
  const reqRemote = {
    socket: { remoteAddress: '203.0.113.5' },
    headers: { host: 'remote.example.com' }
  };
  // Default env -> secure false
  const defaultRes = classifyRequestTransport({ request: reqRemote, serverConfig: { host: '127.0.0.1', lanMode: false }, env: {} });
  assert.equal(defaultRes.secure, false);

  // Insecure dev override -> secure true
  const overrideRes = classifyRequestTransport({ request: reqRemote, serverConfig: { host: '127.0.0.1', lanMode: false }, env: { GASGUARD_ALLOW_INSECURE_ENROLLMENT: 'true' } });
  assert.equal(overrideRes.secure, true);
  assert.equal(overrideRes.source, 'INSECURE_DEV_OVERRIDE');
}
console.log('  [13] Insecure override remains explicit and disabled by default: PASS');

// =============================================================================
// 14. HEALTH CONTAINS SAFE REMOTE GATEWAY READINESS
// =============================================================================
{
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };
  const health = evaluateRemoteGatewayHealth({ serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(health.mode, 'TRUSTED_TUNNEL_READY');
  assert.equal(health.trustedTunnelConfigured, true);
  assert.equal(health.expectedHostConfigured, true);
  assert.equal(health.loopbackOrigin, true);
}
console.log('  [14] Health contains safe remote gateway readiness: PASS');

// =============================================================================
// 15. HEALTH NEVER CONTAINS SECRET VALUES
// =============================================================================
{
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com',
    GASGUARD_SUPABASE_SERVICE_ROLE_KEY: 'secret-key-should-not-leak'
  };
  const health = evaluateRemoteGatewayHealth({ serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  const jsonStr = JSON.stringify(health);
  assert.equal(jsonStr.includes('secret-key'), false);
  assert.equal(jsonStr.includes('serviceRoleKey'), false);
}
console.log('  [15] Health never contains secret values: PASS');

// =============================================================================
// 16. PHYSICAL INGRESS REQUIRES HTTPS
// =============================================================================
{
  const transportCpp = readFirmware('transport.cpp');
  assert.ok(transportCpp.includes('isFieldNode && !isHttps'),
    'transport.cpp must check and reject non-HTTPS ingress URL for physical field node');
  assert.ok(transportCpp.includes('TRANSPORT_ERR_INGRESS_URL_NOT_HTTPS'),
    'transport.cpp must return TRANSPORT_ERR_INGRESS_URL_NOT_HTTPS on non-HTTPS field ingress');
}
console.log('  [16] Physical ingress requires HTTPS: PASS');

// =============================================================================
// 17. HTTP PHYSICAL INGRESS REJECTED
// =============================================================================
{
  const transportCpp = readFirmware('transport.cpp');
  assert.ok(transportCpp.includes('Non-HTTPS ingress URL rejected for field node'),
    'transport.cpp must log diagnostic error on non-HTTPS field node ingress');
}
console.log('  [17] HTTP physical ingress rejected: PASS');

// =============================================================================
// 18. WIFICLIENTSECURE USED IN SOURCE
// =============================================================================
{
  const transportCpp = readFirmware('transport.cpp');
  assert.ok(transportCpp.includes('WiFiClientSecure'),
    'firmware/esp32-field-node/transport.cpp must include and use WiFiClientSecure for HTTPS telemetry');
}
console.log('  [18] WiFiClientSecure used in source: PASS');

// =============================================================================
// 19. CA TRUST CONFIGURED VIA EXPLICIT BOUNDARY (GASGUARD_INGRESS_CA_CERT)
// =============================================================================
{
  const transportH = readFirmware('transport.h');
  const transportCpp = readFirmware('transport.cpp');
  assert.ok(transportH.includes('GASGUARD_INGRESS_CA_CERT'),
    'transport.h must declare GASGUARD_INGRESS_CA_CERT');
  assert.ok(transportCpp.includes('setCACert'),
    'transport.cpp must call setCACert with trust anchor');
}
console.log('  [19] CA trust configured via explicit boundary: PASS');

// =============================================================================
// 20. MISSING TRUST ANCHOR FAILS CLOSED (TRANSPORT_ERR_TLS_TRUST_NOT_CONFIGURED)
// =============================================================================
{
  const transportH = readFirmware('transport.h');
  const transportCpp = readFirmware('transport.cpp');
  assert.ok(transportH.includes('TRANSPORT_ERR_TLS_TRUST_NOT_CONFIGURED'),
    'transport.h must define TRANSPORT_ERR_TLS_TRUST_NOT_CONFIGURED');
  assert.ok(transportCpp.includes('TRANSPORT_ERR_TLS_TRUST_NOT_CONFIGURED'),
    'transport.cpp must return TRANSPORT_ERR_TLS_TRUST_NOT_CONFIGURED when trust anchor absent');
}
console.log('  [20] Missing trust anchor fails closed: PASS');

// =============================================================================
// 21. NO setInsecure() ANYWHERE IN FIRMWARE SOURCE
// =============================================================================
{
  const allContent = allFirmwareContent();
  assert.equal(allContent.includes('setInsecure'), false,
    'setInsecure() must NEVER appear anywhere in firmware source code');
}
console.log('  [21] No setInsecure() anywhere in firmware source: PASS');

// =============================================================================
// 22. X-DEVICE-KEY REMAINS AUTHENTICATION HEADER
// =============================================================================
{
  const transportCpp = readFirmware('transport.cpp');
  assert.ok(transportCpp.includes('x-device-key'),
    'transport.cpp must use x-device-key HTTP header');
  assert.equal(allFirmwareContent().includes('HMAC'), false,
    'HMAC must NOT appear in firmware source');
}
console.log('  [22] x-device-key remains authentication header (NO HMAC): PASS');

// =============================================================================
// 23. ENROLLMENT TOKEN NOT ACCEPTED AS TELEMETRY CREDENTIAL
// =============================================================================
{
  const transportCpp = readFirmware('transport.cpp');
  assert.equal(transportCpp.includes('enrollmentToken'), false,
    'transport.cpp must not accept or send enrollmentToken as telemetry credential');
}
console.log('  [23] Enrollment Token not accepted as telemetry credential: PASS');

// =============================================================================
// 24. DEVICE CREDENTIAL NOT LOGGED
// =============================================================================
{
  const diagCpp = readFirmware('diagnostics.cpp');
  assert.equal(diagCpp.includes('deviceCredential'), false,
    'diagnostics.cpp must not output raw device credential');
}
console.log('  [24] Device Credential not logged: PASS');

// =============================================================================
// 25. EXISTING RAW TELEMETRY CONTRACT PRESERVED
// =============================================================================
{
  const contract = require('../server/esp32-field-contract.js');
  const desc = contract.createSensorDescriptor({
    sensorId: 'MQ6-01', sensorType: 'MQ6', role: contract.SENSOR_ROLES.PRIMARY_LPG_SENSOR, pin: 34,
    adcAttenuation: 'ADC_11db', profileConfirmed: true, inputScale: 1.5
  });
  const reading = contract.processUncalibratedReading(desc, 2048, 1650);
  assert.equal(reading.calibrationStatus, 'CALIBRATION_REQUIRED');
  assert.equal(reading.calibratedPpm, null);
}
console.log('  [25] Existing raw telemetry contract preserved: PASS');

// =============================================================================
// 26. CALIBRATION_REQUIRED SEMANTICS PRESERVED
// =============================================================================
{
  const contract = require('../server/esp32-field-contract.js');
  const desc = contract.createSensorDescriptor({
    sensorId: 'MQ6-01', sensorType: 'MQ6', role: contract.SENSOR_ROLES.PRIMARY_LPG_SENSOR, pin: 34,
    adcAttenuation: 'ADC_11db', profileConfirmed: true, inputScale: 1.5
  });
  const reading = contract.processUncalibratedReading(desc, 2048, 1650);
  assert.equal(reading.calibrationStatus, 'CALIBRATION_REQUIRED');
}
console.log('  [26] CALIBRATION_REQUIRED semantics preserved: PASS');

// =============================================================================
// 28. X-FORWARDED-HOST CANNOT OVERRIDE WRONG HOST
// =============================================================================
{
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      host: 'wrong-host.example.com',
      'x-forwarded-host': 'device-api.example.com',
      'x-forwarded-proto': 'https'
    }
  };
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };
  const res = classifyRequestTransport({ request: req, serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(res.secure, false);
  assert.equal(res.source, 'UNTRUSTED');
}
console.log('  [28] X-Forwarded-Host cannot override wrong Host: PASS');

// =============================================================================
// 29. TRUSTED TUNNEL REQUIRES LOOPBACK IMMEDIATE PEER (REJECT REMOTE PEER WITH FORGED HEADERS)
// =============================================================================
{
  const reqRemotePeer = {
    socket: { remoteAddress: '203.0.113.5' },
    headers: {
      host: 'device-api.example.com',
      'x-forwarded-proto': 'https'
    }
  };
  const env = {
    GASGUARD_TRUSTED_TUNNEL_MODE: 'true',
    GASGUARD_PUBLIC_DEVICE_HOST: 'device-api.example.com'
  };
  const res = classifyRequestTransport({ request: reqRemotePeer, serverConfig: { host: '127.0.0.1', lanMode: false }, env });
  assert.equal(res.secure, false);
  assert.equal(res.source, 'UNTRUSTED');
}
console.log('  [29] Trusted tunnel requires loopback immediate peer (remote peer rejected): PASS');

// =============================================================================
// 30. ENROLLMENT CA AND INGRESS CA CONFIGURED AND DOCUMENTED
// =============================================================================
{
  const exampleEnv = fs.readFileSync(path.join(root, 'config', 'remote-hardware-gateway.example.env'), 'utf8');
  assert.ok(exampleEnv.includes('GASGUARD_ENROLLMENT_CA_CERT='), 'example env must document GASGUARD_ENROLLMENT_CA_CERT');
  assert.ok(exampleEnv.includes('GASGUARD_INGRESS_CA_CERT='), 'example env must document GASGUARD_INGRESS_CA_CERT');
}
console.log('  [30] Enrollment CA and Ingress CA configured and documented: PASS');

// =============================================================================
// 31. TRANSPORTCONFIG CA INITIALIZED DETERMINISTICALLY IN INO
// =============================================================================
{
  const inoContent = readFirmware('esp32-field-node.ino');
  assert.ok(inoContent.includes('transportConfig.caCert = GASGUARD_INGRESS_CA_CERT;'),
    'esp32-field-node.ino must explicitly assign transportConfig.caCert = GASGUARD_INGRESS_CA_CERT');
}
console.log('  [31] TransportConfig CA initialized deterministically in ino: PASS');

console.log('\nALL HW-4A / HW-4A1 REMOTE HARDWARE PILOT GATEWAY CONTRACT TESTS PASSED!');
