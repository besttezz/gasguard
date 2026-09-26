const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260926000000_core_platform_schema.sql');
assert.ok(fs.existsSync(migrationPath), 'Migration file must exist');

const sql = fs.readFileSync(migrationPath, 'utf8');

// 1. Table assertions
const createTableMatches = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_]+)/gi)];
const tableNames = createTableMatches.map(m => m[1]);

assert.equal(tableNames.length, 7, 'Exactly 7 public tables must be created');

const expectedTables = ['profiles', 'customers', 'sites', 'zones', 'site_memberships', 'devices', 'sensors'];
assert.deepEqual(tableNames.sort(), expectedTables.sort(), 'Table list must match approved 7 tables exactly');

// 2. Forbidden tables assertions
const forbiddenTables = [
  'site_plans', 'sensor_readings', 'derived_features', 'incidents',
  'incident_transitions', 'service_requests', 'service_reports',
  'telemetry', 'events', 'alerts', 'installation_jobs', 'commissioning', 'maintenance'
];
for (const forbidden of forbiddenTables) {
  assert.ok(!new RegExp(`create\\s+table[\\s\\S]*?public\\.${forbidden}\\b`, 'i').test(sql), `Forbidden table ${forbidden} must NOT be created`);
}

// 3. Forbidden measurement / telemetry / certification fields
const forbiddenTerms = [
  'calculated_ppm', 'corrected_ppm', 'confidence', 'valve_state',
  'lpg_leak_detected', 'certified', 'verified sensor measurements'
];
for (const term of forbiddenTerms) {
  assert.ok(!sql.toLowerCase().includes(term.toLowerCase()), `Forbidden term/concept "${term}" must not exist in migration`);
}

// 4. No hardcoded UUIDs
assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sql), 'No hardcoded UUIDs allowed');

// 5. RLS enabled on all 7 tables
for (const table of expectedTables) {
  const rlsRegex = new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i');
  assert.ok(rlsRegex.test(sql), `RLS must be enabled on public.${table}`);
}

// 6. No anonymous policies
assert.ok(!/to\s+anon\b/i.test(sql), 'No anon access policies allowed');

// 7. Developer and Technician must NOT have global business access in RLS
assert.ok(!/role['"]?\s*\)?\s*=\s*'developer'/i.test(sql), 'developer must not have blanket business access');
assert.ok(!/role['"]?\s*\)?\s*=\s*'technician'/i.test(sql), 'technician must not have blanket business access');

// 8. Business writes are DENY BY DEFAULT (No INSERT/UPDATE/DELETE on business tables)
const businessTables = ['customers', 'sites', 'zones', 'site_memberships', 'devices', 'sensors'];
for (const table of businessTables) {
  const writePolicyRegex = new RegExp(`create\\s+policy[\\s\\S]*?on\\s+public\\.${table}[\\s\\S]*?for\\s+(insert|update|delete|all)`, 'i');
  assert.ok(!writePolicyRegex.test(sql), `No business write policy allowed on public.${table}`);
}

// 9. Profile own update policy exists
assert.ok(/create\s+policy\s+"profiles_update_own"\s+on\s+public\.profiles\s+for\s+update/i.test(sql), 'Own profile update policy must exist');

// 10. Zones uniqueness for (site_id, id)
assert.ok(/unique\s*\(\s*site_id\s*,\s*id\s*\)/i.test(sql), 'zones must have unique constraint on (site_id, id)');

// 11. Devices composite foreign key (site_id, zone_id) -> zones(site_id, id)
assert.ok(/foreign\s+key\s*\(\s*site_id\s*,\s*zone_id\s*\)\s*references\s+public\.zones\s*\(\s*site_id\s*,\s*id\s*\)/i.test(sql), 'devices must have composite FK (site_id, zone_id) -> zones(site_id, id)');

// 12. Devices site_id NOT NULL and zone_id nullable
assert.ok(/site_id\s+uuid\s+not\s+null\s+references\s+public\.sites/i.test(sql), 'devices.site_id must be NOT NULL');
assert.ok(/zone_id\s+uuid\s+null\b/i.test(sql), 'devices.zone_id must remain nullable');

// 13. Trigger function hardening assertions
const handleUpdatedAtBlock = sql.substring(sql.indexOf('function public.handle_updated_at'), sql.indexOf('function public.handle_new_auth_user'));
assert.ok(!/security\s+definer/i.test(handleUpdatedAtBlock), 'handle_updated_at must NOT be SECURITY DEFINER');

const handleNewAuthUserBlock = sql.substring(sql.indexOf('function public.handle_new_auth_user'), sql.indexOf('CORE PUBLIC TABLES'));
assert.ok(/security\s+definer/i.test(handleNewAuthUserBlock), 'handle_new_auth_user MUST be SECURITY DEFINER');
assert.ok(/set\s+search_path\s*=\s*''/i.test(handleNewAuthUserBlock), 'handle_new_auth_user must set empty search_path');
assert.ok(/public\.profiles/i.test(handleNewAuthUserBlock), 'handle_new_auth_user must use fully-qualified public.profiles');

console.log('core schema tests passed');
