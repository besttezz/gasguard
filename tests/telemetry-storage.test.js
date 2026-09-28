'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createDeviceIngress } = require('../server/device-ingress.js');

console.log('Running DB-1 Telemetry History & Safety Events storage tests...\n');

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260928000000_telemetry_and_safety_events.sql');
assert.ok(fs.existsSync(migrationPath), 'DB-1 migration must exist');
const sql = fs.readFileSync(migrationPath, 'utf8');

// [1] Exactly the three expected public tables
const tables = [...sql.matchAll(/create\s+table\s+public\.([a-z_]+)/gi)].map(m => m[1]).sort();
assert.deepStrictEqual(tables, ['device_status', 'safety_events', 'telemetry_readings']);
console.log('  [1] Creates exactly telemetry_readings, device_status, safety_events: PASS');

// [2] RLS enabled with select-only client policies
for (const t of tables) {
  assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`, 'i'), `${t} RLS`);
  assert.match(sql, new RegExp(`revoke insert, update, delete, truncate on table public\\.${t} from public, anon, authenticated`, 'i'), `${t} write revoke`);
}
const policies = [...sql.matchAll(/create policy "[^"]+" on public\.[a-z_]+\s+for\s+([a-z]+)/gi)].map(m => m[1].toLowerCase());
assert.ok(policies.length === 3 && policies.every(p => p === 'select'), 'Only SELECT policies allowed');
console.log('  [2] RLS enabled, clients read-only (SELECT policies, writes revoked): PASS');

// [3] Ingest and retention RPCs are service_role only
for (const fn of ['ingest_telemetry\\(text, jsonb\\)', 'purge_telemetry_before\\(timestamptz\\)']) {
  assert.match(sql, new RegExp(`revoke execute on function public\\.${fn} from public, anon, authenticated`, 'i'));
  assert.match(sql, new RegExp(`grant execute on function public\\.${fn} to service_role`, 'i'));
}
console.log('  [3] ingest_telemetry / purge_telemetry_before granted only to service_role: PASS');

// [4] Security definer functions pin search_path
const definerCount = (sql.match(/security definer/gi) || []).length;
const pinnedCount = (sql.match(/security definer\s+set search_path = ''/gi) || []).length;
assert.ok(definerCount > 0 && definerCount === pinnedCount, 'Every security definer function must set search_path');
console.log('  [4] Every SECURITY DEFINER function pins search_path: PASS');

// [5] Duplicate packet protection and reporting view respects RLS
assert.match(sql, /constraint uq_telemetry_packet unique \(device_id, sensor_uid, boot_id, sequence\)/i);
assert.match(sql, /on conflict on constraint uq_telemetry_packet do nothing/i);
assert.match(sql, /create view public\.telemetry_hourly\s+with \(security_invoker = true\)/i);
console.log('  [5] Duplicate packets ignored; telemetry_hourly is security_invoker: PASS');

// [6] Seed contains no secrets or users
const seed = fs.readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8');
assert.ok(!/auth\.users|password|service_role|sb_secret_|device_key/i.test(seed.replace(/--.*$/gm, '')), 'Seed must not create users or secrets');
console.log('  [6] Seed creates demo topology only (no users/secrets): PASS');

// Ingress persistence behaviour
const registry = { resolve: id => (id === 'SIM-ESP32-KITCHEN-01' ? { deviceId: id, workspaceId: 'device-test', source: 'TEST_DEVICE' } : null) };
const pipeline = {
  measurement: { ingest: () => ({ ok: true }), validateRaw: () => ({ ok: true }) },
  engine: { analysis: { safety: 'attention', risk: 55, anomaly: 21, current: { gas: { ppm: 140 } } } }
};
const payload = { deviceId: 'SIM-ESP32-KITCHEN-01', sensorId: 'MQ6-01', sensorType: 'MQ6', bootId: 'b1', sequence: 7, timestamp: '2026-09-28T00:00:00Z', raw: { adc: 1800, sensorVoltage: 1.45 } };
const headers = { 'x-device-key': 'test-key' };
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // [7] Accepted packet is forwarded to the store with engine output
  const calls = [];
  const ingress = createDeviceIngress({ registry, credentials: { 'SIM-ESP32-KITCHEN-01': 'test-key' }, pipelines: { 'device-test': pipeline }, telemetryStore: { ingestTelemetry: async arg => { calls.push(arg); return { accepted: true }; } } });
  const res = ingress.ingest({ headers, payload });
  assert.strictEqual(res.status, 202);
  await tick();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].deviceUid, 'SIM-ESP32-KITCHEN-01');
  assert.deepStrictEqual(
    { gasPpm: calls[0].reading.gasPpm, safety: calls[0].reading.safety, riskScore: calls[0].reading.riskScore, dataClassification: calls[0].reading.dataClassification, sequence: calls[0].reading.sequence },
    { gasPpm: 140, safety: 'attention', riskScore: 55, dataClassification: 'VIRTUAL_TEST_DATA', sequence: 7 }
  );
  assert.ok(!('x-device-key' in calls[0].reading) && !JSON.stringify(calls[0]).includes('test-key'), 'Device key must never reach the store');
  console.log('  [7] Accepted packet persisted with engine output and no device key: PASS');

  // [8] Store failure never rejects live telemetry
  const originalWarn = console.warn; const warnings = []; console.warn = msg => warnings.push(msg);
  const failing = createDeviceIngress({ registry, credentials: { 'SIM-ESP32-KITCHEN-01': 'test-key' }, pipelines: { 'device-test': pipeline }, telemetryStore: { ingestTelemetry: async () => { const e = new Error('down'); e.code = 'INTERNAL_ENROLLMENT_ERROR'; throw e; } } });
  const res2 = failing.ingest({ headers, payload });
  await tick(); await tick();
  console.warn = originalWarn;
  assert.strictEqual(res2.status, 202);
  assert.ok(warnings.some(w => w.includes('not persisted')), 'Failure should be logged');
  console.log('  [8] Database failure does not reject device telemetry: PASS');

  // [9] Rejected packet is not persisted; no store configured is a no-op
  const rejectCalls = [];
  const rejecting = createDeviceIngress({ registry, credentials: { 'SIM-ESP32-KITCHEN-01': 'test-key' }, pipelines: { 'device-test': pipeline }, telemetryStore: { ingestTelemetry: async arg => rejectCalls.push(arg) } });
  assert.strictEqual(rejecting.ingest({ headers: { 'x-device-key': 'wrong' }, payload }).status, 401);
  await tick();
  assert.strictEqual(rejectCalls.length, 0);
  const noStore = createDeviceIngress({ registry, credentials: { 'SIM-ESP32-KITCHEN-01': 'test-key' }, pipelines: { 'device-test': pipeline } });
  assert.strictEqual(noStore.ingest({ headers, payload }).status, 202);
  console.log('  [9] Rejected packets are never persisted; store is optional: PASS');

  console.log('\nALL DB-1 TELEMETRY STORAGE TESTS PASSED!');
})().catch(error => { console.error(error); process.exit(1); });
