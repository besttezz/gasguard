'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const logic = require('../js/safety-logic.js');
const alarmApi = require('../js/alarm.js');

console.log('Running OWNER-1 owner app tests...\n');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// [1] The page loads only the new app: auth, safety logic, floor plan, alarm, owner app. Old UI is gone.
const html = read('index.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
assert.deepStrictEqual(scripts.filter(s => s.startsWith('js/')), ['js/auth-config.js', 'js/auth.js', 'js/safety-logic.js', 'js/floor-plan.js', 'js/alarm.js', 'js/owner-app.js']);
assert.match(html, /<link rel="stylesheet" href="css\/owner\.css">/);
for (const tab of ['home', 'plan', 'history', 'mine']) assert.match(html, new RegExp(`href="#${tab}" data-tab="${tab}"`), `tab ${tab}`);
assert.match(html, /id="login-form"/);
assert.match(html, /id="alarm"/);
for (const gone of ['js/app.js', 'js/device-dashboard.js', 'js/safety-console.js', 'js/navigation.js', 'css/app.css', 'css/public-landing.css']) {
  assert.ok(!fs.existsSync(path.join(root, gone)), `${gone} removed`);
}
console.log('  [1] Page loads only the owner app, four tabs, sign-in and alarm screen; old UI removed: PASS');

// [2] App wiring: polls the status API with the user token, reads plans/hourly/members through RLS
const app = read('js/owner-app.js');
assert.match(app, /\/api\/v1\/device\/status\?workspace=/);
assert.match(app, /authorization: `Bearer \$\{token\}`/);
assert.match(app, /from\('floor_plans'\)/);
assert.match(app, /from\('telemetry_hourly'\)/);
assert.match(app, /rpc\('site_members'/);
assert.match(app, /rpc\('can_edit_site'/);
assert.match(app, /neq\('data_classification', 'SYNTHETIC_HANDSHAKE'\)/, 'handshake test packets never show up in history');
assert.match(app, /readOnly: !S\.canEdit/, 'only owners and admins can change the plan');
assert.match(app, /href="tel:199"/);
assert.ok(!/innerHTML = [^;]*\$\{(?!esc\()[a-z]+\.(email|display_name|name)\}/i.test(app), 'user-provided names are escaped');
console.log('  [2] Owner app polls status with the session token and reads plan, history, members via RLS: PASS');

// [3] Alarm: chime for yellow, repeating alarm for orange/red until acknowledged, re-arms after dropping
const store = new Map();
const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
const alarm = alarmApi.create(storage);
const L = logic.LEVELS;
alarm.update(L.safe); assert.strictEqual(alarm.alarming(), false);
alarm.update(L.watch); assert.strictEqual(alarm.alarming(), false, 'yellow chimes once, no repeating alarm');
alarm.update(L.danger); assert.strictEqual(alarm.alarming(), true);
alarm.acknowledge(); assert.strictEqual(alarm.alarming(), false);
alarm.update(L.danger); assert.strictEqual(alarm.alarming(), false, 'acknowledged level stays quiet');
alarm.update(L.safe); alarm.update(L.warning); assert.strictEqual(alarm.alarming(), true, 'a new rise arms the alarm again');
alarm.stop();
assert.strictEqual(alarm.wantsSound(), false);
alarm.disable(); assert.strictEqual(store.get('gasguard.alarm.sound'), 'off');
console.log('  [3] Alarm repeats for orange/red until acknowledged and re-arms on a new rise: PASS');

// [4] Database: shared floor plans and member list, written only by owners/admins
const sql = read('supabase/migrations/20261020000000_owner_app_floor_plans_and_members.sql');
assert.match(sql, /create table public\.floor_plans/);
assert.match(sql, /alter table public\.floor_plans enable row level security/);
assert.match(sql, /for select to authenticated\s+using \(public\.can_view_site\(site_id\)\)/);
assert.match(sql, /for insert to authenticated\s+with check \(public\.can_edit_site\(site_id\) and updated_by = auth\.uid\(\)\)/);
assert.match(sql, /membership_type = 'owner'/);
assert.match(sql, /revoke all on table public\.floor_plans from anon/);
assert.match(sql, /create or replace function public\.site_members\(p_site_id uuid\)[\s\S]*security definer[\s\S]*can_edit_site\(p_site_id\) or sm\.user_id = auth\.uid\(\)/);
console.log('  [4] floor_plans RLS: members read, owners/admins write; site_members limited to owners: PASS');

console.log('\nALL OWNER-1 OWNER APP TESTS PASSED!');
