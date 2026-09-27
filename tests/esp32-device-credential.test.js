'use strict';

// =============================================================================
// HW-3C2A ESP32 DEVICE CREDENTIAL HANDOFF CONTRACT TESTS
//
// Validates firmware source contracts for:
// - Enrollment Token memory policy (RAM only, never persisted)
// - Device Credential persistence (NVS only after successful enrollment)
// - Custom provisioning endpoint security
// - HTTPS enrollment client safety
// - Credential reset separation
// - Diagnostics secret redaction
// - Hard-coded credential/token absence
// - Telemetry identity from persisted UID
// =============================================================================

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../server/esp32-field-contract.js');
const { validateRawTokenFormat } = require('../server/device-enrollment.js');
const { validateRawCredentialFormat } = require('../server/device-auth.js');

const root = path.resolve(__dirname, '..');
const fieldNodeDir = path.join(root, 'firmware', 'esp32-field-node');

// Helper: read firmware source file
function readFirmware(filename) {
  return fs.readFileSync(path.join(fieldNodeDir, filename), 'utf8');
}

// Collect all firmware source files
const firmwareFiles = fs.readdirSync(fieldNodeDir)
  .filter(f => f.endsWith('.h') || f.endsWith('.cpp') || f.endsWith('.ino'));

function allFirmwareContent() {
  return firmwareFiles.map(f => readFirmware(f)).join('\n');
}

// =============================================================================
// 1. ENROLLMENT TOKEN IS NEVER PERSISTED IN PREFERENCES
// =============================================================================
{
  const credCpp = readFirmware('device_credentials.cpp');
  const credH = readFirmware('device_credentials.h');

  // Enrollment Token key must NOT appear in the credential store
  assert.equal(credCpp.includes('enrollmentToken'), false,
    'device_credentials.cpp must not mention enrollmentToken');
  assert.equal(credCpp.includes('enrollment_token'), false,
    'device_credentials.cpp must not persist enrollment_token key');
  assert.equal(credH.includes('enrollmentToken'), false,
    'device_credentials.h must not mention enrollmentToken');

  // The provisioning module stores token only in static RAM variable
  const provCpp = readFirmware('network_provisioning.cpp');
  assert.ok(provCpp.includes('g_enrollmentToken'),
    'Enrollment token must be stored in static RAM variable');
  assert.ok(provCpp.includes('RAM only') || provCpp.includes('RAM ONLY') || provCpp.includes('RAM-ONLY'),
    'Enrollment token storage must be documented as RAM only');
}
console.log('  [1] Enrollment Token never persisted in Preferences: PASS');

// =============================================================================
// 2. DEVICE CREDENTIAL PERSISTED ONLY AFTER SUCCESSFUL SERVER ENROLLMENT
// =============================================================================
{
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  assert.ok(enrollCpp.includes('saveDeviceCredentials'),
    'Enrollment client must call saveDeviceCredentials');
  // saveDeviceCredentials is called only after successful 201 response parsing
  const saveIdx = enrollCpp.indexOf('saveDeviceCredentials');
  const http201Idx = enrollCpp.indexOf('httpCode == 201');
  assert.ok(http201Idx >= 0, 'Enrollment must check for HTTP 201');
  assert.ok(saveIdx > http201Idx,
    'saveDeviceCredentials must be called after HTTP 201 verification');
}
console.log('  [2] Device Credential persisted only after successful enrollment: PASS');

// =============================================================================
// 3. DEVICE UID PERSISTED WITH CREDENTIAL
// =============================================================================
{
  const credCpp = readFirmware('device_credentials.cpp');
  assert.ok(credCpp.includes('KEY_DEVICE_UID') && credCpp.includes('KEY_DEVICE_CRED'),
    'Credential store must persist both UID and credential');
  // Verify both are written in save function
  assert.ok(credCpp.includes('putString(KEY_DEVICE_UID'),
    'UID must be written to NVS');
  assert.ok(credCpp.includes('putString(KEY_DEVICE_CRED'),
    'Credential must be written to NVS');
}
console.log('  [3] deviceUid persisted with credential: PASS');

// =============================================================================
// 4. MALFORMED DEVICE CREDENTIAL REJECTED
// =============================================================================
{
  assert.equal(validateRawCredentialFormat('not-hex-at-all'), false);
  assert.equal(validateRawCredentialFormat('abc123'), false);
  assert.equal(validateRawCredentialFormat('a'.repeat(63)), false);
  assert.equal(validateRawCredentialFormat('g'.repeat(64)), false);
  assert.equal(validateRawCredentialFormat('a'.repeat(64)), true);
  assert.equal(validateRawCredentialFormat('A'.repeat(64)), true);
}
console.log('  [4] Malformed Device Credential rejected: PASS');

// =============================================================================
// 5. MALFORMED ENROLLMENT TOKEN REJECTED
// =============================================================================
{
  assert.equal(validateRawTokenFormat('short'), false);
  assert.equal(validateRawTokenFormat('x'.repeat(64)), false);
  assert.equal(validateRawTokenFormat('a'.repeat(63)), false);
  assert.equal(validateRawTokenFormat('f'.repeat(64)), true);
  assert.equal(validateRawTokenFormat('0123456789abcdef'.repeat(4)), true);
}
console.log('  [5] Malformed Enrollment Token rejected: PASS');

// =============================================================================
// 6. MISSING BOOTSTRAP TOKEN → DEVICE_ENROLLMENT_REQUIRED
// =============================================================================
{
  const state = contract.processProvisioningEvent('CONNECTING_WIFI', 'WIFI_GOT_IP', {
    hasDeviceCredential: false,
    hasEnrollmentToken: false
  });
  assert.equal(state, 'DEVICE_ENROLLMENT_REQUIRED');
}
console.log('  [6] Missing bootstrap token → DEVICE_ENROLLMENT_REQUIRED: PASS');

// =============================================================================
// 7. SUCCESSFUL LOAD AFTER REBOOT SIMULATION
// =============================================================================
{
  const inoContent = readFirmware('esp32-field-node.ino');
  assert.ok(inoContent.includes('loadDeviceCredentials'),
    'setup() must load persisted credentials on boot');
  assert.ok(inoContent.includes('stored.valid'),
    'Must check credential validity after loading');
  assert.ok(inoContent.includes('transportConfig.deviceKey'),
    'Must assign loaded credential to transport config');
}
console.log('  [7] Successful load after reboot simulation: PASS');

// =============================================================================
// 8. CORRUPT STORED CREDENTIAL FAILS CLOSED
// =============================================================================
{
  const inoContent = readFirmware('esp32-field-node.ino');
  assert.ok(inoContent.includes('CRED_STORE_INVALID_FORMAT'),
    'Must handle CRED_STORE_INVALID_FORMAT');
  assert.ok(inoContent.includes('NODE_STATE_CREDENTIAL_STORAGE_ERROR'),
    'Corrupt credential must transition to CREDENTIAL_STORAGE_ERROR');
}
console.log('  [8] Corrupt stored credential fails closed: PASS');

// =============================================================================
// 9. TARGETED CREDENTIAL RESET DOES NOT ERASE WI-FI
// =============================================================================
{
  const credCpp = readFirmware('device_credentials.cpp');
  // clearDeviceCredentials removes only credential keys
  assert.ok(credCpp.includes('clearDeviceCredentials'),
    'clearDeviceCredentials function must exist');
  assert.ok(credCpp.includes('prefs.remove(KEY_DEVICE_UID)'),
    'Must remove UID key specifically');
  assert.ok(credCpp.includes('prefs.remove(KEY_DEVICE_CRED)'),
    'Must remove credential key specifically');
  // Must NOT call nvs_flash_erase
  assert.equal(credCpp.includes('nvs_flash_erase'), false,
    'clearDeviceCredentials must NOT call nvs_flash_erase');

  // Wi-Fi reset preserves device credential
  const resetRes = contract.requestWiFiProvisioningReset();
  assert.ok(resetRes.preservedData.includes('DEVICE_CREDENTIAL'),
    'Wi-Fi reset must preserve device credential');
}
console.log('  [9] Targeted credential reset does not erase Wi-Fi: PASS');

// =============================================================================
// 10. TELEMETRY USES PERSISTED DEVICE UID
// =============================================================================
{
  const inoContent = readFirmware('esp32-field-node.ino');
  assert.ok(inoContent.includes('getRuntimeDeviceId()'),
    'Telemetry must use getRuntimeDeviceId() not hard-coded ID');
  assert.ok(inoContent.includes('g_runtimeDeviceUid'),
    'Runtime device UID must be loaded from persisted storage');
  // buildRawMeasurementPayload must use dynamic device ID
  const payloadCalls = inoContent.match(/buildRawMeasurementPayload\(([^)]+)\)/g) || [];
  for (const call of payloadCalls) {
    assert.ok(call.includes('getRuntimeDeviceId()'),
      'buildRawMeasurementPayload must use getRuntimeDeviceId(), not static ID');
    assert.equal(call.includes('DEVICE_ID'), false,
      'buildRawMeasurementPayload must NOT use hard-coded DEVICE_ID');
  }
}
console.log('  [10] Telemetry uses persisted Device UID: PASS');

// =============================================================================
// 11. TELEMETRY USES PERSISTED DEVICE CREDENTIAL
// =============================================================================
{
  const inoContent = readFirmware('esp32-field-node.ino');
  // transportConfig.deviceKey must be set from loaded credential, not compile-time
  assert.ok(inoContent.includes('g_deviceCredentialRuntime'),
    'Runtime credential must come from persisted store');
  assert.ok(inoContent.includes('transportConfig.deviceKey = g_deviceCredentialRuntime'),
    'Transport deviceKey must be set from runtime credential');
}
console.log('  [11] Telemetry uses persisted Device Credential: PASS');

// =============================================================================
// 12. NO HARD-CODED DEVICE CREDENTIAL
// =============================================================================
{
  const allContent = allFirmwareContent();
  // No 64-hex literal that could be a credential
  const hexLiteralMatch = allContent.match(/"[0-9a-fA-F]{64}"/g) || [];
  // Filter out known non-credential patterns (test format checking strings, etc.)
  assert.equal(hexLiteralMatch.length, 0,
    'No 64-hex string literal should appear in firmware source (would be a hardcoded credential)');
}
console.log('  [12] No hard-coded Device Credential: PASS');

// =============================================================================
// 13. NO HARD-CODED ENROLLMENT TOKEN
// =============================================================================
{
  const allContent = allFirmwareContent();
  // Enrollment token placeholder patterns should not appear
  assert.equal(allContent.includes('HARDCODED_ENROLLMENT'), false);
  assert.equal(allContent.includes('STATIC_TOKEN'), false);
  // No enrollment token in provisioning_config
  const provConfig = readFirmware('provisioning_config.h');
  assert.equal(provConfig.includes('ENROLLMENT_TOKEN'), false,
    'provisioning_config.h must NOT contain enrollment token define');
}
console.log('  [13] No hard-coded Enrollment Token: PASS');

// =============================================================================
// 14. NO SUPABASE KEY IN FIRMWARE
// =============================================================================
{
  const allContent = allFirmwareContent();
  assert.equal(allContent.includes('SUPABASE'), false,
    'Firmware must not contain any SUPABASE references');
  assert.equal(allContent.includes('service_role'), false,
    'Firmware must not contain service_role key');
  assert.equal(allContent.includes('sb_secret'), false,
    'Firmware must not contain Supabase secret prefix');
}
console.log('  [14] No Supabase key in firmware: PASS');

// =============================================================================
// 15. DIAGNOSTICS CONTAIN NO SECRETS
// =============================================================================
{
  const diagCpp = readFirmware('diagnostics.cpp');
  // Diagnostics must not print any secret-like fields
  assert.equal(diagCpp.includes('enrollmentToken'), false,
    'Diagnostics must not output enrollment token');
  assert.equal(diagCpp.includes('deviceCredential'), false,
    'Diagnostics must not output device credential');
  assert.ok(diagCpp.includes('credentialsRedacted'),
    'Diagnostics JSON must confirm credentials redacted');

  // Contract-level diagnostic redaction
  const formattedDiag = contract.formatFieldDiagnostics({
    deviceId: 'TEST-01',
    enrollmentToken: 'secret-token-value',
    deviceCredential: 'secret-cred-value',
    credentialHash: 'secret-hash-value',
    wifiPassword: 'secret-wifi',
    deviceKey: 'secret-key',
    proofOfPossession: 'secret-pop',
    serviceKey: 'secret-ap-key'
  });
  assert.equal(formattedDiag.enrollmentToken, '[REDACTED]');
  assert.equal(formattedDiag.deviceCredential, '[REDACTED]');
  assert.equal(formattedDiag.credentialHash, '[REDACTED]');
  assert.equal(formattedDiag.wifiPassword, '[REDACTED]');
  assert.equal(formattedDiag.deviceKey, '[REDACTED]');
  assert.equal(formattedDiag.proofOfPossession, '[REDACTED]');
}
console.log('  [15] Diagnostics contain no secrets: PASS');

// =============================================================================
// 16. HTTP ENROLLMENT URL REJECTED
// =============================================================================
{
  const enrollH = readFirmware('device_enrollment_client.h');
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  assert.ok(enrollCpp.includes('startsWith("https://")'),
    'Must validate HTTPS scheme');
  assert.ok(enrollCpp.includes('ENROLL_URL_NOT_HTTPS') || enrollH.includes('ENROLL_URL_NOT_HTTPS'),
    'Must define ENROLL_URL_NOT_HTTPS error code');
}
console.log('  [16] HTTP enrollment URL rejected: PASS');

// =============================================================================
// 17. HTTPS ENROLLMENT WITH NO TRUST ANCHOR FAILS CLOSED
// =============================================================================
{
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  assert.ok(enrollCpp.includes('isTlsTrustConfigured'),
    'Must check TLS trust configuration');
  assert.ok(enrollCpp.includes('ENROLL_TLS_TRUST_NOT_CONFIGURED'),
    'Must fail with TLS_TRUST_NOT_CONFIGURED when no CA cert');
  assert.ok(enrollCpp.includes('GASGUARD_ENROLLMENT_CA_CERT'),
    'Must reference CA cert configuration');
}
console.log('  [17] HTTPS enrollment with no trust anchor fails closed: PASS');

// =============================================================================
// 18. NO setInsecure() CALL
// =============================================================================
{
  const allContent = allFirmwareContent();
  assert.equal(allContent.includes('setInsecure'), false,
    'setInsecure() must NEVER appear in firmware source');
}
console.log('  [18] No setInsecure() call: PASS');

// =============================================================================
// 19. RESPONSE DEVICE UID MISMATCH REJECTED
// =============================================================================
{
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  assert.ok(enrollCpp.includes('ENROLL_RESPONSE_DEVICE_UID_MISMATCH'),
    'Must check and reject deviceUid mismatch in response');
  assert.ok(enrollCpp.includes('responseDeviceUid != deviceUid'),
    'Must compare response deviceUid with expected');
}
console.log('  [19] Response deviceUid mismatch rejected: PASS');

// =============================================================================
// 20. RESPONSE CREDENTIAL EXACT 64 HEX REQUIRED
// =============================================================================
{
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  assert.ok(enrollCpp.includes('isValidHex64'),
    'Must validate credential is exactly 64 hex');
  assert.ok(enrollCpp.includes('ENROLL_RESPONSE_CREDENTIAL_INVALID'),
    'Must reject invalid credential format');
}
console.log('  [20] Response credential exact 64 hex required: PASS');

// =============================================================================
// 21. RESPONSE-LOSS / AMBIGUOUS RESULT DOES NOT BLINDLY RETRY
// =============================================================================
{
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  assert.ok(enrollCpp.includes('ENROLL_RESULT_UNKNOWN'),
    'Must define ENROLL_RESULT_UNKNOWN for ambiguous results');
  // State machine must not re-enter ENROLLING from FAILED
  const inoContent = readFirmware('esp32-field-node.ino');
  assert.ok(inoContent.includes('ENROLLMENT_RESULT_UNKNOWN'),
    'Main loop must handle ENROLLMENT_RESULT_UNKNOWN');
  assert.ok(inoContent.includes('Technician recovery required'),
    'Must indicate technician recovery for ambiguous results');

  // Contract-level
  const failedState = contract.processProvisioningEvent('ENROLLING_DEVICE', 'ENROLLMENT_RESULT_UNKNOWN');
  assert.equal(failedState, 'DEVICE_ENROLLMENT_FAILED');
}
console.log('  [21] Response-loss / ambiguous result does not blindly retry: PASS');

// =============================================================================
// 22. ENROLLMENT HTTP 409 TERMINAL RESPONSE CODES DO NOT RETRY
// =============================================================================
{
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  assert.ok(enrollCpp.includes('ENROLL_ALREADY_CLAIMED'), 'Must define ENROLL_ALREADY_CLAIMED');
  assert.ok(enrollCpp.includes('ENROLL_TOKEN_EXPIRED'), 'Must define ENROLL_TOKEN_EXPIRED');
  assert.ok(enrollCpp.includes('ENROLL_TOKEN_REVOKED'), 'Must define ENROLL_TOKEN_REVOKED');
  assert.ok(enrollCpp.includes('ENROLL_NOT_AVAILABLE'), 'Must define ENROLL_NOT_AVAILABLE');
  assert.ok(enrollCpp.includes('httpCode == 409'), 'HTTP 409 must be checked');
  assert.ok(enrollCpp.includes('ENROLLMENT_EXPIRED'), 'Must check ENROLLMENT_EXPIRED code');
  assert.ok(enrollCpp.includes('ENROLLMENT_REVOKED'), 'Must check ENROLLMENT_REVOKED code');
  assert.ok(enrollCpp.includes('ENROLLMENT_NOT_AVAILABLE'), 'Must check ENROLLMENT_NOT_AVAILABLE code');

  // Contract-level
  assert.equal(contract.processProvisioningEvent('ENROLLING_DEVICE', 'ENROLLMENT_ALREADY_CLAIMED'), 'DEVICE_ENROLLMENT_FAILED');
}
console.log('  [22] Enrollment HTTP 409 terminal response codes do not retry: PASS');

// =============================================================================
// 23. PROVISIONING POP NOT REUSED AS TOKEN
// =============================================================================
{
  const allContent = allFirmwareContent();
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  assert.equal(enrollCpp.includes('GASGUARD_PROV_POP'), false,
    'Enrollment client must not reference PoP');
  assert.equal(enrollCpp.includes('proofOfPossession'), false,
    'Enrollment client must not reference proofOfPossession');
}
console.log('  [23] Provisioning PoP not reused as token: PASS');

// =============================================================================
// 24. HW-3C2A1 HARDENING REQUIREMENTS (SECRET CLEARING, ENDPOINT FAILURES, RE-ENROLLMENT GAP, TELEMETRY X-DEVICE-KEY)
// =============================================================================
{
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  const provCpp = readFirmware('network_provisioning.cpp');
  const inoContent = readFirmware('esp32-field-node.ino');
  const allContent = allFirmwareContent();

  // 1. responseBody is best-effort cleared after parsing
  assert.ok(enrollCpp.includes('bestEffortClearSecret(responseBody)'),
    'responseBody must be cleared after parsing');

  // 2. responseBody is cleared on error/malformed branches
  const responseBodyClearMatches = enrollCpp.match(/bestEffortClearSecret\(responseBody\)/g) || [];
  assert.ok(responseBodyClearMatches.length >= 3,
    'responseBody must be cleared on multiple response branches');

  // 3. raw credential does not remain in diagnostic/result objects
  const enrollH = readFirmware('device_enrollment_client.h');
  assert.ok(enrollH.includes('Device Credential is NEVER stored in this struct'),
    'Result struct documentation must state credential is not stored');
  const diagH = readFirmware('diagnostics.h');
  assert.equal(diagH.includes('deviceCredential'), false,
    'FieldDiagnostics struct must not contain deviceCredential');

  // 4. endpoint create failure is checked
  assert.ok(provCpp.includes('ENROLLMENT_ENDPOINT_CREATE_FAILED'),
    'Endpoint create failure must produce ENROLLMENT_ENDPOINT_CREATE_FAILED');

  // 5. endpoint register failure is checked
  assert.ok(provCpp.includes('ENROLLMENT_ENDPOINT_REGISTER_FAILED'),
    'Endpoint register failure must produce ENROLLMENT_ENDPOINT_REGISTER_FAILED');

  // 6. provisioning does not report normal success when custom endpoint setup failed
  assert.ok(provCpp.includes('NODE_STATE_PROVISIONING_FAILED'),
    'Endpoint failure must set state to NODE_STATE_PROVISIONING_FAILED');

  // 7. official endpoint ordering remains: init → create → start → register
  const initIdx = provCpp.indexOf('network_prov_mgr_init');
  const createIdx = provCpp.indexOf('createEnrollmentEndpoint()');
  const startIdx = provCpp.indexOf('network_prov_mgr_start_provisioning');
  const regIdx = provCpp.indexOf('registerEnrollmentEndpointHandler()');
  assert.ok(initIdx < createIdx && createIdx < startIdx && startIdx < regIdx,
    'Official ordering (init -> create -> start -> register) must be maintained');

  // 8. Wi-Fi-provisioned + credential-missing case is explicitly represented
  assert.ok(provCpp.includes('NODE_STATE_ENROLLMENT_BOOTSTRAP_CHANNEL_REQUIRED'),
    'Must define NODE_STATE_ENROLLMENT_BOOTSTRAP_CHANNEL_REQUIRED');
  assert.ok(inoContent.includes('NODE_STATE_ENROLLMENT_BOOTSTRAP_CHANNEL_REQUIRED'),
    'esp32-field-node.ino must set ENROLLMENT_BOOTSTRAP_CHANNEL_REQUIRED when credential absent and no token');

  // 9. targeted Device Credential reset does not erase Wi-Fi
  const credCpp = readFirmware('device_credentials.cpp');
  assert.ok(credCpp.includes('clearDeviceCredentials'),
    'clearDeviceCredentials must exist');
  assert.equal(credCpp.includes('nvs_flash_erase'), false,
    'clearDeviceCredentials must not call nvs_flash_erase');

  // 10. re-enrollment bootstrap requires explicit protected provisioning entry
  assert.ok(provCpp.includes('requestDeviceEnrollmentProvisioning'),
    'Must define requestDeviceEnrollmentProvisioning entry point boundary');

  // 11. no Serial secret entry
  assert.equal(allContent.includes('Serial.readString'), false,
    'No Serial secret entry permitted');

  // 12. no Enrollment Token persistence
  assert.equal(credCpp.includes('enrollmentToken'), false,
    'No enrollment token in NVS store');

  // 13-16. HTTP 409 responses handled & distinguished without retry
  assert.ok(enrollCpp.includes('ENROLL_TOKEN_EXPIRED') && enrollCpp.includes('ENROLL_TOKEN_REVOKED') && enrollCpp.includes('ENROLL_NOT_AVAILABLE'),
    '409 error codes mapped correctly');

  // 17. telemetry still uses x-device-key
  const transportCpp = readFirmware('transport.cpp');
  assert.ok(transportCpp.includes('x-device-key'),
    'Telemetry transport must use x-device-key header');

  // 18. no HMAC implementation introduced
  assert.equal(allContent.includes('mbedtls_md_hmac'), false,
    'No HMAC implementation in firmware source');
  assert.equal(allContent.includes('HMAC'), false,
    'No HMAC terminology in firmware source');

  // 19. no setInsecure
  assert.equal(allContent.includes('setInsecure'), false,
    'No setInsecure permitted');
}
console.log('  [24] HW-3C2A1 hardening requirements (secret clearing, endpoint failures, re-enrollment gap, telemetry x-device-key): PASS');

// =============================================================================
// 24. CUSTOM ENDPOINT RESPONSE NEVER ECHOES TOKEN
// =============================================================================
{
  const provCpp = readFirmware('network_provisioning.cpp');
  // The custom endpoint handler response
  assert.ok(provCpp.includes('ENROLLMENT_BOOTSTRAP_ACCEPTED'),
    'Custom endpoint must return safe acknowledgment');
  // Response must not contain token echo
  const handlerSection = provCpp.substring(
    provCpp.indexOf('enrollmentEndpointHandler'),
    provCpp.indexOf('createEnrollmentEndpoint')
  );
  // okResponse must not include enrollmentToken or deviceCredential
  assert.ok(!handlerSection.includes('"enrollmentToken"') ||
    handlerSection.indexOf('"enrollmentToken"') < handlerSection.indexOf('extractValue'),
    'Custom endpoint response must not echo token');
  // Verify the actual response string is safe
  assert.ok(provCpp.includes('\\"ok\\":true,\\"code\\":\\"ENROLLMENT_BOOTSTRAP_ACCEPTED\\"'),
    'Response must be only ok+code');
}
console.log('  [24] Custom endpoint response never echoes token: PASS');

// =============================================================================
// 25. EXISTING WI-FI PROVISIONING TESTS REMAIN PASS
// =============================================================================
{
  // Existing provisioning contract tests
  const sec0Res = contract.validateProvisioningConfig({ securityMode: 0, proofOfPossession: 'secure-pop-1234567' });
  assert.equal(sec0Res.ok, false, 'Security 0 must still be rejected');

  const validRes = contract.validateProvisioningConfig({ securityMode: 1, proofOfPossession: 'k9#mP$9xL2qR7vW9' });
  assert.equal(validRes.ok, true, 'Valid config must still pass');

  const serviceName = contract.generateProvisioningServiceName('A1B2C3');
  assert.equal(serviceName, 'PROV_GG_A1B2C3');

  const resetRes = contract.requestWiFiProvisioningReset();
  assert.equal(resetRes.state, 'UNPROVISIONED');
  assert.equal(resetRes.wifiProvisioned, false);
}
console.log('  [25] Existing Wi-Fi provisioning tests remain PASS: PASS');

// =============================================================================
// 26. EXISTING RAW MEASUREMENT TESTS REMAIN PASS
// =============================================================================
{
  const mq6Desc = contract.createSensorDescriptor({
    sensorId: 'MQ6-01', sensorType: 'MQ6',
    role: contract.SENSOR_ROLES.PRIMARY_LPG_SENSOR,
    pin: 34, adcAttenuation: 'ADC_11db', profileConfirmed: true, inputScale: 1.5
  });
  const reading = contract.processUncalibratedReading(mq6Desc, 2048, 1650);
  assert.equal(reading.calibrationStatus, 'CALIBRATION_REQUIRED');
  assert.equal(reading.calibratedPpm, null);
  assert.equal(reading.sensorVoltage, 1.650);
}
console.log('  [26] Existing raw measurement tests remain PASS: PASS');

// =============================================================================
// 27. BOARD PROFILE REMAINS UNCONFIRMED
// =============================================================================
{
  const boardConfig = readFirmware('board_config.h');
  assert.ok(boardConfig.includes('GASGUARD_HARDWARE_PROFILE_CONFIRMED false'),
    'Board profile must remain UNCONFIRMED');
  assert.ok(boardConfig.includes('ESP32_GENERIC_UNVERIFIED'),
    'Board variant must remain UNVERIFIED');
}
console.log('  [27] Board profile remains unconfirmed: PASS');

// =============================================================================
// ADDITIONAL CONTRACT VERIFICATION
// =============================================================================

// Verify new firmware files exist
{
  assert.ok(fs.existsSync(path.join(fieldNodeDir, 'device_credentials.h')),
    'device_credentials.h must exist');
  assert.ok(fs.existsSync(path.join(fieldNodeDir, 'device_credentials.cpp')),
    'device_credentials.cpp must exist');
  assert.ok(fs.existsSync(path.join(fieldNodeDir, 'device_enrollment_client.h')),
    'device_enrollment_client.h must exist');
  assert.ok(fs.existsSync(path.join(fieldNodeDir, 'device_enrollment_client.cpp')),
    'device_enrollment_client.cpp must exist');
}

// Verify documentation exists
{
  assert.ok(fs.existsSync(path.join(root, 'docs', 'ESP32_DEVICE_ENROLLMENT.md')),
    'ESP32_DEVICE_ENROLLMENT.md must exist');
}

// Verify NVS namespace/key length constraints
{
  const credCpp = readFirmware('device_credentials.cpp');
  // Extract namespace and key values
  assert.ok(credCpp.includes('"gg-auth"'), 'Namespace must be gg-auth');
  assert.ok(credCpp.includes('"dev-uid"'), 'UID key must be dev-uid');
  assert.ok(credCpp.includes('"dev-cred"'), 'Credential key must be dev-cred');
  // All must be <= 15 chars
  assert.ok('gg-auth'.length <= 15, 'Namespace must be <= 15 chars');
  assert.ok('dev-uid'.length <= 15, 'UID key must be <= 15 chars');
  assert.ok('dev-cred'.length <= 15, 'Credential key must be <= 15 chars');
}

// Verify constant-time comparison exists
{
  const credCpp = readFirmware('device_credentials.cpp');
  assert.ok(credCpp.includes('constantTimeCompare'),
    'Constant-time comparison must be implemented');
}

// Verify best-effort secret clearing
{
  const enrollCpp = readFirmware('device_enrollment_client.cpp');
  assert.ok(enrollCpp.includes('bestEffortClearSecret'),
    'Must implement best-effort secret clearing');
}

// Verify enrollment states in contract
{
  assert.ok(contract.NODE_STATES.includes('ENROLLING_DEVICE'));
  assert.ok(contract.NODE_STATES.includes('DEVICE_ENROLLMENT_FAILED'));
  assert.ok(contract.NODE_STATES.includes('CREDENTIAL_STORAGE_ERROR'));

  // Enrollment success transitions
  const enrollSuccess = contract.processProvisioningEvent('ENROLLING_DEVICE', 'ENROLLMENT_SUCCESS');
  assert.equal(enrollSuccess, 'CONNECTING_INGRESS');

  // With enrollment token → ENROLLING_DEVICE
  const enrollingState = contract.processProvisioningEvent('CONNECTING_WIFI', 'WIFI_GOT_IP', {
    hasDeviceCredential: false,
    hasEnrollmentToken: true
  });
  assert.equal(enrollingState, 'ENROLLING_DEVICE');

  // Storage error
  const storageErr = contract.processProvisioningEvent('ENROLLING_DEVICE', 'CREDENTIAL_STORAGE_ERROR');
  assert.equal(storageErr, 'CREDENTIAL_STORAGE_ERROR');
}

// Verify no static DEVICE_ID used in telemetry path
{
  const inoContent = readFirmware('esp32-field-node.ino');
  // The old static DEVICE_ID = "ESP32-KITCHEN-01" must not be used for telemetry
  assert.equal(inoContent.includes('"ESP32-KITCHEN-01"'), false,
    'Hard-coded ESP32-KITCHEN-01 must not appear in firmware');
}

// Verify GASGUARD_ENROLLMENT_URL and GASGUARD_INGRESS_URL are separate
{
  const enrollH = readFirmware('device_enrollment_client.h');
  assert.ok(enrollH.includes('GASGUARD_ENROLLMENT_URL'),
    'GASGUARD_ENROLLMENT_URL must be defined');
  const transportH = readFirmware('transport.h');
  assert.ok(transportH.includes('GASGUARD_INGRESS_URL'),
    'GASGUARD_INGRESS_URL must remain defined');
  // They must be separate defines
  assert.equal(enrollH.includes('GASGUARD_INGRESS_URL'), false,
    'Enrollment client must not assume ingress URL');
}

// Verify custom endpoint name
{
  const provCpp = readFirmware('network_provisioning.cpp');
  assert.ok(provCpp.includes('"gasguard-enroll"'),
    'Custom endpoint must use gasguard-enroll name');
}

// Verify endpoint ordering documentation
{
  const provCpp = readFirmware('network_provisioning.cpp');
  assert.ok(provCpp.includes('createEnrollmentEndpoint'),
    'Custom endpoint creation function must exist');
  assert.ok(provCpp.includes('registerEnrollmentEndpointHandler'),
    'Custom endpoint handler registration must exist');
  // Create before start, register after start
  const createIdx = provCpp.indexOf('createEnrollmentEndpoint()');
  const startIdx = provCpp.indexOf('network_prov_mgr_start_provisioning');
  const registerIdx = provCpp.indexOf('registerEnrollmentEndpointHandler()');
  if (createIdx > 0 && startIdx > 0 && registerIdx > 0) {
    // In the prepareWiFiProvisioning function, create should be before start
    // and register should be after start
    assert.ok(createIdx < startIdx,
      'Endpoint create must happen BEFORE provisioning start');
    assert.ok(registerIdx > startIdx,
      'Endpoint handler register must happen AFTER provisioning start');
  }
}

console.log('\nALL HW-3C2A ESP32 DEVICE CREDENTIAL HANDOFF CONTRACT TESTS PASSED!');
