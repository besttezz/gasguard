'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const contract = require('../server/esp32-field-contract.js');
const registry = require('../server/device-registry.js');
const { createDeviceIngress } = require('../server/device-ingress.js');
const { createPipeline } = require('../server/pipeline-runtime.js');

const root = path.resolve(__dirname, '..');
const fieldNodeDir = path.join(root, 'firmware', 'esp32-field-node');

// 1. Verify firmware directory structure and files exist
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'README.md')), 'README.md must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'board_config.h')), 'board_config.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'sensor_config.h')), 'sensor_config.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'sensor_config.cpp')), 'sensor_config.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'measurement.h')), 'measurement.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'measurement.cpp')), 'measurement.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'telemetry.h')), 'telemetry.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'telemetry.cpp')), 'telemetry.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'network_provisioning.h')), 'network_provisioning.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'network_provisioning.cpp')), 'network_provisioning.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'provisioning_config.h')), 'provisioning_config.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'provisioning_secrets.example.h')), 'provisioning_secrets.example.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'transport.h')), 'transport.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'transport.cpp')), 'transport.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'diagnostics.h')), 'diagnostics.h must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'diagnostics.cpp')), 'diagnostics.cpp must exist');
assert.ok(fs.existsSync(path.join(fieldNodeDir, 'esp32-field-node.ino')), 'esp32-field-node.ino must exist');

// 2. Documentation files exist
assert.ok(fs.existsSync(path.join(root, 'docs', 'ESP32_PROVISIONING.md')), 'ESP32_PROVISIONING.md must exist');
assert.ok(fs.existsSync(path.join(root, 'docs', 'ESP32_FIELD_INTEGRATION.md')), 'ESP32_FIELD_INTEGRATION.md must exist');
assert.ok(fs.existsSync(path.join(root, 'docs', 'ESP32_FIRST_CONNECTION_CHECKLIST.md')), 'ESP32_FIRST_CONNECTION_CHECKLIST.md must exist');

// 3. HW-2B Provisioning Contract & Validation Tests

// Test 1 & 3: Security 0 rejected, Security 1 required
const sec0Res = contract.validateProvisioningConfig({ securityMode: 0, proofOfPossession: 'secure-pop-1234567' });
assert.equal(sec0Res.ok, false, 'Security 0 must be rejected');
assert.equal(sec0Res.code, 'SECURITY_0_FORBIDDEN');

// Test 2: Missing PoP rejected
const missingPopRes = contract.validateProvisioningConfig({ securityMode: 1, proofOfPossession: '' });
assert.equal(missingPopRes.ok, false, 'Missing PoP must be rejected');
assert.equal(missingPopRes.code, 'MISSING_POP');

// Test 6: Short or forbidden default PoPs rejected
const shortPopRes = contract.validateProvisioningConfig({ securityMode: 1, proofOfPossession: 'short-pop' });
assert.equal(shortPopRes.ok, false, 'Short PoP (<12 chars) must be rejected');
assert.equal(shortPopRes.code, 'SHORT_POP');

const forbiddenPops = ['abcd1234', '12345678', 'password', 'gasguard123', 'default', 'admin', '00000000', '1234', '123456789012'];
for (const defaultPop of forbiddenPops) {
  const res = contract.validateProvisioningConfig({ securityMode: 1, proofOfPossession: defaultPop });
  assert.equal(res.ok, false, `Default PoP '${defaultPop}' must be rejected`);
}

// Valid high-entropy device-specific PoP passes
const validConfigRes = contract.validateProvisioningConfig({ securityMode: 1, proofOfPossession: 'k9#mP$9xL2qR7vW9' });
assert.equal(validConfigRes.ok, true, 'Valid Security 1 + device PoP passes');

// Test 8: Service name generation is deterministic and non-secret
const serviceName1 = contract.generateProvisioningServiceName('ESP32-KITCHEN-01');
assert.equal(serviceName1, 'PROV_GG_CHEN01', 'Service name must be deterministic prefix + suffix');
const serviceName2 = contract.generateProvisioningServiceName('A1B2C3');
assert.equal(serviceName2, 'PROV_GG_A1B2C3');

// Test 11, 14, 15, 16: State Transitions
assert.equal(contract.processProvisioningEvent('UNPROVISIONED', 'START'), 'PROVISIONING');
assert.equal(contract.processProvisioningEvent('PROVISIONING', 'CREDENTIAL_SUCCESS'), 'CONNECTING_WIFI');
assert.equal(contract.processProvisioningEvent('PROVISIONING', 'CREDENTIAL_FAILURE'), 'PROVISIONING_FAILED');

const enrollmentReqState = contract.processProvisioningEvent('CONNECTING_WIFI', 'WIFI_GOT_IP', { hasDeviceCredential: false });
assert.equal(enrollmentReqState, 'DEVICE_ENROLLMENT_REQUIRED', 'Wi-Fi got IP without device credential leads to DEVICE_ENROLLMENT_REQUIRED');
assert.notEqual(enrollmentReqState, 'READY', 'Provisioned Wi-Fi does NOT imply READY');

const ingressState = contract.processProvisioningEvent('CONNECTING_WIFI', 'WIFI_GOT_IP', { hasDeviceCredential: true });
assert.equal(ingressState, 'CONNECTING_INGRESS');

// Reset action clears Wi-Fi provisioning intent only without full NVS wipe
const resetRes = contract.requestWiFiProvisioningReset();
assert.equal(resetRes.state, 'UNPROVISIONED');
assert.equal(resetRes.wifiProvisioned, false);
assert.deepEqual(resetRes.clearedCredentials, ['WIFI_STA_SSID', 'WIFI_STA_PASSWORD']);
assert.ok(resetRes.preservedData.includes('DEVICE_CREDENTIAL'), 'Device credential preserved across Wi-Fi reset');

// Secrets never enter diagnostics
const rawDiag = {
  deviceId: 'ESP32-KITCHEN-01',
  wifiPassword: 'super-secret-wifi-pass',
  deviceKey: 'secret-device-key-value',
  proofOfPossession: 'secret-pop-value-1234',
  serviceKey: 'secret-softap-key',
  currentState: 'READY'
};
const formattedDiag = contract.formatFieldDiagnostics(rawDiag);
assert.equal(formattedDiag.wifiPassword, '[REDACTED]');
assert.equal(formattedDiag.deviceKey, '[REDACTED]');
assert.equal(formattedDiag.proofOfPossession, '[REDACTED]');
assert.equal(formattedDiag.serviceKey, '[REDACTED]');

// 4. Source Code Audit Checks for HW-2B
const cppContent = fs.readFileSync(path.join(fieldNodeDir, 'network_provisioning.cpp'), 'utf8');
assert.ok(cppContent.includes('wifi_prov_mgr_start_provisioning'), 'Active provisioning start code exists and is not commented');
assert.equal(cppContent.includes('// WiFiProv.beginProvision'), false, 'Dangling commented start call removed');
assert.equal(cppContent.includes('nvs_flash_erase'), false, 'nvs_flash_erase must NOT be called');

const inoContent = fs.readFileSync(path.join(fieldNodeDir, 'esp32-field-node.ino'), 'utf8');
assert.ok(inoContent.includes('#include "provisioning_config.h"'), 'Uses provisioning_config.h instead of directly including example header');
assert.equal(inoContent.includes('printQR('), false, 'printQR must not be called in normal field runtime');

const provConfigContent = fs.readFileSync(path.join(fieldNodeDir, 'provisioning_config.h'), 'utf8');
assert.ok(provConfigContent.includes('GASGUARD_HAS_PROVISIONING_SECRETS'), 'provisioning_config.h contains conditional local secret check');

// Test 7 & 18: Verify no hardcoded Wi-Fi passwords or static PoPs committed in firmware source files
const firmwareFiles = fs.readdirSync(fieldNodeDir).filter(f => f.endsWith('.h') || f.endsWith('.cpp') || f.endsWith('.ino'));
for (const file of firmwareFiles) {
  const content = fs.readFileSync(path.join(fieldNodeDir, file), 'utf8');
  assert.equal(/abcd1234|12345678|gasguard123/.test(content), false, `Firmware file ${file} must not contain static default PoPs`);
  assert.equal(/GASGUARD_(WIFI_PASS|DEVICE_SECRET|SERVICE_ROLE)/.test(content), false, `Firmware file ${file} must not contain real secret placeholders`);
}

// 5. HW-1D Raw sensor behavior remains unchanged
const mq6Desc = contract.createSensorDescriptor({
  sensorId: 'MQ6-01',
  sensorType: 'MQ6',
  role: contract.SENSOR_ROLES.PRIMARY_LPG_SENSOR,
  pin: 34,
  adcAttenuation: 'ADC_11db',
  profileConfirmed: true,
  inputScale: 1.5
});
const readingWithMv = contract.processUncalibratedReading(mq6Desc, 2048, 1650);
assert.equal(readingWithMv.calibrationStatus, 'CALIBRATION_REQUIRED');
assert.equal(readingWithMv.calibratedPpm, null);
assert.equal(readingWithMv.sensorVoltage, 1.650);

const keys = { 'ESP32-KITCHEN-01': 'test-secret-key' };
const pipelines = { 'hardware-pilot': createPipeline(root) };
const ingress = createDeviceIngress({ registry, credentials: keys, pipelines });
const validHeaders = { 'x-device-key': 'test-secret-key' };

const validRawPayload = contract.formatRawMeasurementPayload({
  deviceId: 'ESP32-KITCHEN-01',
  reading: readingWithMv,
  bootId: 'boot-xyz-123',
  sequence: 42,
  timestamp: new Date().toISOString()
});
const ingressRes = ingress.ingest({ headers: validHeaders, payload: validRawPayload });
assert.equal(ingressRes.status, 202);
assert.equal(ingressRes.body.code, 'CALIBRATION_REQUIRED');
assert.equal(ingressRes.body.gasPpm, null);
assert.equal(ingressRes.body.safety, 'UNKNOWN');

console.log('esp32 HW-2B provisioning activation & secret safety tests passed!');
