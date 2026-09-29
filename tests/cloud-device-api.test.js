'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

console.log('Running CLOUD-1 Pages Functions device API tests...\n');

const root = path.join(__dirname, '..');
const KEY = 'a'.repeat(63) + 'B';
const HASH = crypto.createHash('sha256').update(KEY.toLowerCase()).digest('hex');
const env = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_ANON_KEY: 'sb_publishable_x', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' };
const packet = { deviceId: 'ESP32-KITCHEN-01', sensorId: 'MQ6-01', sensorType: 'MQ6', bootId: 'esp32-abc', sequence: 3, timestamp: '2026-09-28T10:00:00Z', raw: { adc: 1800, sensorVoltage: 1.45, calibrationStatus: 'CALIBRATION_REQUIRED' } };

function fakeStore({ valid = true, deviceUid = 'ESP32-KITCHEN-01', duplicate = false, failIngest = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    assert.strictEqual(init.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY, 'device RPCs use the service key');
    if (url.endsWith('/rpc/verify_device_credential')) {
      return new Response(JSON.stringify(valid && body.p_credential_hash === HASH ? { valid: true, device_uid: deviceUid } : { valid: false }), { status: 200 });
    }
    if (url.endsWith('/rpc/ingest_telemetry')) {
      return failIngest ? new Response('boom', { status: 500 }) : new Response(JSON.stringify({ accepted: !duplicate, duplicate }), { status: 200 });
    }
    throw new Error('unexpected url ' + url);
  };
  return { calls, fetchImpl };
}

const post = (body, headers = { 'x-device-key': KEY }) => new Request('https://gasguard-bu.pages.dev/api/v1/device/telemetry', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

(async () => {
  const api = await import('../cloud/device-api.mjs');
  const read = async response => ({ status: response.status, body: response.status === 405 ? null : await response.json() });

  // [1] Configuration guard: publishable key must never be accepted as the service key
  let r = await read(await api.handleTelemetry(post(packet), { ...env, SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_x' }, fakeStore().fetchImpl));
  assert.deepStrictEqual([r.status, r.body.code], [503, 'INGRESS_NOT_CONFIGURED']);
  console.log('  [1] Ingress refuses to run without a real service-role key: PASS');

  // [2] Payload validation before any database call
  let store = fakeStore();
  r = await read(await api.handleTelemetry(post('{not json'), env, store.fetchImpl));
  assert.strictEqual(r.status, 400);
  r = await read(await api.handleTelemetry(post({ ...packet, raw: { adc: 9999 } }), env, store.fetchImpl));
  assert.strictEqual(r.status, 422);
  r = await read(await api.handleTelemetry(post({ ...packet, sensorType: 'MQ9' }), env, store.fetchImpl));
  assert.strictEqual(r.status, 422);
  r = await read(await api.handleTelemetry(post('x'.repeat(9000)), env, store.fetchImpl));
  assert.strictEqual(r.status, 413);
  assert.strictEqual(store.calls.length, 0, 'invalid packets never reach Supabase');
  console.log('  [2] Bad JSON, out-of-range ADC, unknown sensor and oversized bodies rejected locally: PASS');

  // [3] Credential checks
  store = fakeStore();
  r = await read(await api.handleTelemetry(post(packet, {}), env, store.fetchImpl));
  assert.deepStrictEqual([r.status, r.body.code], [401, 'INVALID_DEVICE_CREDENTIAL']);
  r = await read(await api.handleTelemetry(post(packet, { 'x-device-key': 'short' }), env, store.fetchImpl));
  assert.strictEqual(r.status, 401);
  assert.strictEqual(store.calls.length, 0, 'malformed keys are rejected without a database round-trip');
  r = await read(await api.handleTelemetry(post(packet, { 'x-device-key': 'b'.repeat(64) }), env, store.fetchImpl));
  assert.deepStrictEqual([r.status, r.body.code], [401, 'INVALID_DEVICE_CREDENTIAL']);
  assert.ok(!JSON.stringify(store.calls).includes('b'.repeat(64)), 'raw key is never sent, only its hash');
  r = await read(await api.handleTelemetry(post(packet, { authorization: `Bearer ${KEY}` }), env, fakeStore({ deviceUid: 'OTHER-DEVICE' }).fetchImpl));
  assert.deepStrictEqual([r.status, r.body.code], [403, 'DEVICE_IDENTITY_MISMATCH']);
  console.log('  [3] Missing/malformed/wrong keys → 401, key for another device → 403, only hashes leave the edge: PASS');

  // [4] Real raw-only packet stored without an invented ppm
  store = fakeStore();
  r = await read(await api.handleTelemetry(post(packet), env, store.fetchImpl));
  assert.deepStrictEqual([r.status, r.body.code, r.body.dataClassification], [202, 'INGESTED', 'DEVICE_DATA']);
  const ingest = store.calls.find(c => c.url.endsWith('/rpc/ingest_telemetry')).body;
  assert.strictEqual(ingest.p_device_uid, 'ESP32-KITCHEN-01');
  assert.deepStrictEqual({ adc: ingest.p_reading.raw.adc, cal: ingest.p_reading.raw.calibrationStatus, ppm: ingest.p_reading.gasPpm }, { adc: 1800, cal: 'CALIBRATION_REQUIRED', ppm: null });
  console.log('  [4] Raw MQ-6 packet stored as DEVICE_DATA with CALIBRATION_REQUIRED and no ppm: PASS');

  // [5] Synthetic handshake keeps its label and test ppm; duplicates acknowledged so devices advance
  store = fakeStore({ duplicate: true });
  r = await read(await api.handleTelemetry(post({ ...packet, raw: {}, upstreamPpm: 120 }, { 'x-device-key': KEY, 'x-gasguard-data-classification': 'synthetic_handshake' }), env, store.fetchImpl));
  assert.deepStrictEqual([r.status, r.body.code, r.body.dataClassification], [202, 'DUPLICATE', 'SYNTHETIC_HANDSHAKE']);
  assert.strictEqual(store.calls.find(c => c.url.endsWith('/rpc/ingest_telemetry')).body.p_reading.gasPpm, 120);
  console.log('  [5] Synthetic handshake labelled and duplicate packets return 202 DUPLICATE: PASS');

  // [6] Storage outage surfaces as 502 (device retries), not a silent success
  r = await read(await api.handleTelemetry(post(packet), env, fakeStore({ failIngest: true }).fetchImpl));
  assert.deepStrictEqual([r.status, r.body.code], [502, 'STORE_UNAVAILABLE']);
  console.log('  [6] Supabase failure returns 502 STORE_UNAVAILABLE: PASS');

  // [7] Status endpoint: sign-in required, uses the caller token (RLS), maps state for the dashboard
  const statusReq = (headers = { authorization: 'Bearer user-token' }, ws = 'hardware-pilot') => new Request(`https://gasguard-bu.pages.dev/api/v1/device/status?workspace=${ws}`, { headers });
  r = await read(await api.handleStatus(statusReq({}), env, async () => { throw new Error('no call'); }));
  assert.deepStrictEqual([r.status, r.body.code], [401, 'SIGN_IN_REQUIRED']);
  r = await read(await api.handleStatus(statusReq(undefined, 'nope'), env, async () => { throw new Error('no call'); }));
  assert.strictEqual(r.status, 404);

  const now = Date.parse('2026-09-28T10:00:20Z');
  const statusFetch = (lastSeen, rows) => async (url, init) => {
    assert.strictEqual(init.headers.authorization, 'Bearer user-token', 'status queries run as the signed-in user');
    assert.strictEqual(init.headers.apikey, env.SUPABASE_ANON_KEY, 'status never uses the service key');
    if (url.includes('/rest/v1/devices?')) return new Response(JSON.stringify(lastSeen ? [{ id: 'dev-1', device_uid: 'ESP32-KITCHEN-01', device_status: { last_seen_at: lastSeen, data_classification: 'DEVICE_DATA', calibration_status: 'CALIBRATION_REQUIRED', safety: null, gas_ppm: null } }] : []), { status: 200 });
    if (url.includes('/rest/v1/telemetry_readings?')) return new Response(JSON.stringify(rows), { status: 200 });
    throw new Error('unexpected ' + url);
  };
  r = await read(await api.handleStatus(statusReq(), env, statusFetch(null, []), () => now));
  assert.deepStrictEqual([r.status, r.body.status, r.body.connection], [200, 'WAITING_FOR_DEVICE', 'WAITING_FOR_DEVICE']);

  const rows = [{ sensor_uid: 'MQ6-01', sensor_type: 'MQ6', raw_adc: 1800, sensor_voltage: 1.45, input_adjusted_voltage: null, calibration_status: 'CALIBRATION_REQUIRED', gas_ppm: null, received_at: '2026-09-28T10:00:10Z' }];
  r = await read(await api.handleStatus(statusReq(), env, statusFetch('2026-09-28T10:00:10Z', rows), () => now));
  assert.deepStrictEqual({ s: r.body.status, c: r.body.connection, t: r.body.telemetry, p: r.body.packetStatus, sensors: r.body.sensors, adc: r.body.latestMeasurement.rawAdc }, { s: 'DEVICE_DATA', c: 'ONLINE', t: 'CALIBRATION_REQUIRED', p: 'CALIBRATION REQUIRED', sensors: ['MQ6-01'], adc: 1800 });

  r = await read(await api.handleStatus(statusReq(), env, statusFetch('2026-09-28T09:58:00Z', rows), () => now));
  assert.deepStrictEqual({ s: r.body.status, c: r.body.connection, safety: r.body.safety, latest: r.body.latestMeasurement }, { s: 'OFFLINE', c: 'OFFLINE', safety: 'UNKNOWN', latest: null });
  assert.deepStrictEqual({ history: r.body.history.map(h => [h.sensorId, h.rawAdc]), kept: r.body.sensorLatest['MQ6-01'].rawAdc }, { history: [['MQ6-01', 1800]], kept: 1800 }, 'history and last-known values survive going offline');
  console.log('  [7] Status requires sign-in, queries with the user token, reports ONLINE/OFFLINE/WAITING: PASS');

  // [8] Routes, config and firmware wiring
  const route = fs.readFileSync(path.join(root, 'functions/api/v1/device/telemetry.js'), 'utf8');
  assert.match(route, /onRequestPost/);
  const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
  assert.match(toml, /pages_build_output_dir = "\.\/dist"/);
  assert.ok(!/SERVICE_ROLE_KEY\s*=/.test(toml) && !/sb_secret_/.test(toml), 'wrangler.toml must not contain the service key');
  const firmware = fs.readFileSync(path.join(root, 'firmware/esp32-handshake/esp32-handshake.ino'), 'utf8');
  assert.match(firmware, /setCACert\(GASGUARD_ROOT_CA_BUNDLE\)/);
  assert.ok(!/setInsecure/.test(firmware), 'firmware must verify TLS certificates');
  const ca = fs.readFileSync(path.join(root, 'firmware/esp32-handshake/root_ca.h'), 'utf8');
  assert.strictEqual((ca.match(/BEGIN CERTIFICATE/g) || []).length, 4, 'root CA bundle holds ISRG X1/X2 and GTS R1/R4');
  console.log('  [8] Pages routes, public-only wrangler.toml, verified-TLS firmware and CA bundle present: PASS');

  // [9] MQ-2 support end to end: ingress, firmware option, database constraint and auto-registration
  store = fakeStore();
  r = await read(await api.handleTelemetry(post({ ...packet, sensorId: 'MQ2-01', sensorType: 'mq2', raw: { adc: 1520, sensorVoltage: 1.22 } }), env, store.fetchImpl));
  assert.deepStrictEqual([r.status, r.body.code], [202, 'INGESTED']);
  const mq2 = store.calls.find(c => c.url.endsWith('/rpc/ingest_telemetry')).body.p_reading;
  assert.deepStrictEqual({ id: mq2.sensorId, type: mq2.sensorType, ppm: mq2.gasPpm }, { id: 'MQ2-01', type: 'MQ2', ppm: null });
  assert.match(firmware, /sendRawSensor\("MQ2-01", "MQ2", GASGUARD_MQ2_ADC_PIN/);
  assert.match(fs.readFileSync(path.join(root, 'firmware/esp32-handshake/secrets.example.h'), 'utf8'), /\/\/ #define GASGUARD_MQ2_ADC_PIN 35/);
  const mq2Migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260929000000_add_mq2_sensor_type.sql'), 'utf8');
  assert.match(mq2Migration, /check \(sensor_type in \('mq2', 'mq3', 'mq6'\)\)/);
  assert.match(mq2Migration, /v_sensor_type in \('mq2', 'mq3', 'mq6'\)/);
  assert.match(mq2Migration, /grant execute on function public\.ingest_telemetry\(text, jsonb\) to service_role;/);
  console.log('  [9] MQ-2 accepted by ingress, wired in firmware, allowed and auto-registered by the database: PASS');

  console.log('\nALL CLOUD-1 DEVICE API TESTS PASSED!');
})().catch(error => { console.error(error); process.exit(1); });
