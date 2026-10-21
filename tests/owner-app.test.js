'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const logic = require('../js/safety-logic.js');
const alarmApi = require('../js/alarm.js');

console.log('Running OWNER-1 app tests...\n');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// [1] The page loads only the new app; every role's views exist; old UI is gone.
const html = read('index.html');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
assert.deepStrictEqual(scripts.filter(s => s.startsWith('js/')), ['js/auth-config.js', 'js/auth.js', 'js/trial.js', 'js/safety-logic.js', 'js/floor-plan.js', 'js/alarm.js', 'js/tech-views.js', 'js/admin-views.js', 'js/owner-app.js']);
assert.match(html, /<link rel="stylesheet" href="css\/owner\.css">/);
for (const view of ['home', 'plan', 'history', 'mine', 'jobs', 'install', 'overview', 'users', 'work', 'tools']) assert.match(html, new RegExp(`data-view="${view}"`), `view ${view}`);
for (const id of ['login-form', 'invite-panel', 'alarm', 'report', 'tabbar', 'site-switch']) assert.match(html, new RegExp(`id="${id}"`), id);
for (const gone of ['js/app.js', 'js/device-dashboard.js', 'js/safety-console.js', 'js/navigation.js', 'css/app.css', 'css/public-landing.css']) {
  assert.ok(!fs.existsSync(path.join(root, gone)), `${gone} removed`);
}
console.log('  [1] Page loads the app core plus technician/admin views; old UI removed: PASS');

// [2] Wiring: tabs per role, status polled per device with the session token, RLS reads and RPCs
const app = read('js/owner-app.js');
assert.match(app, /\/api\/v1\/device\/status\?device=/);
assert.match(app, /authorization: `Bearer \$\{token\}`/);
assert.match(app, /general: \['home', 'plan', 'history', 'mine'\]/);
assert.match(app, /technician: \['jobs', 'install', 'plan', 'mine'\]/);
assert.match(app, /admin: \['overview', 'users', 'work'/);
for (const call of ["from('floor_plans')", "from('telemetry_hourly')", "from('alert_episodes')", "from('site_settings')", "rpc('site_members'", "rpc('can_edit_site'",
  "rpc('create_site_invitation'", "rpc('claim_site_invitation'", "rpc('ack_alert'", "rpc('create_line_link_code')", "rpc('set_member_alert_level'", '/api/v1/site/summary', '/api/v1/invite/signup']) {
  assert.ok(app.includes(call), `app uses ${call}`);
}
assert.match(app, /neq\('data_classification', 'SYNTHETIC_HANDSHAKE'\)/, 'handshake test packets never show up in history');
assert.match(app, /readOnly: !S\.canEdit/, 'only owners, admins and the assigned technician can change the plan');
assert.match(app, /href="tel:199"/);
assert.match(app, /randomHex\(32\)[\s\S]*p_token_hash: await sha256Hex\(token\)/, 'invite links carry a random token; only its hash is stored');
for (const f of ['js/owner-app.js', 'js/tech-views.js', 'js/admin-views.js']) {
  assert.ok(!/db\(\)[^;\n]*\)\.catch\(/.test(read(f)), `${f}: Supabase builders go through q(), never .catch()`);
}
const tech = read('js/tech-views.js');
assert.match(tech, /from\('job_assignments'\)/);
assert.match(tech, /rpc\('set_job_progress'/);
assert.match(tech, /from\('sensor_calibrations'\)\.insert/);
const admin = read('js/admin-views.js');
assert.match(admin, /rpc\('admin_issue_device_credential', \{ p_device_id: deviceId, p_credential_hash: await sha256Hex\(key\) \}\)/, 'device keys are generated in the browser; only the hash is stored');
assert.match(admin, /\/api\/v1\/admin\/users/);
console.log('  [2] Role tabs, per-device status polling, RLS reads/RPCs, hashed invite and device keys: PASS');

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
assert.match(sql, /revoke all on table public\.floor_plans from anon/);
console.log('  [4] floor_plans RLS: members read, owners/admins write: PASS');

// [5] Who sees what: technical detail and the simulator are for the crew; home users get plain words.
assert.match(app, /developer: \['home', 'plan', 'history', 'tools', 'mine'\]/, 'developer has its own tools tab');
assert.match(app, /admin: \['overview', 'users', 'work', 'home', 'plan', 'history', 'tools', 'mine'\]/);
assert.ok(!/general: \[[^\]]*'tools'/.test(app), 'home users have no tools tab');
assert.match(app, /const seesTech = \(\) => S\.role === 'technician' \|\| S\.role === 'admin' \|\| S\.role === 'developer';/);
assert.match(app, /lockSensors: !seesTech\(\)/, 'home owners arrange rooms; sensor points stay where the technician put them');
const mine = app.slice(app.indexOf('function renderMine()'), app.indexOf('// ---- Tools (developer, admin)'));
assert.ok(mine.length > 0 && !mine.includes('demo-toggle') && !mine.includes('legendHtml('), 'my-home tab has no simulator and no ppm thresholds');
assert.match(app, /S\.episode && !S\.sim && S\.role !== 'admin'/, 'an admin viewing a home does not acknowledge for the household');
const fpSrc = read('js/floor-plan.js');
assert.match(fpSrc, /if \(lockSensors\) \$\('\[data-fp-tool="sensor"\]'\)\.hidden = true;/);
assert.match(fpSrc, /edit\.hidden = ui\.view === '3d' \|\| Boolean\(options\.readOnly\)/, 'switching back to 2D does not show the edit button to read-only users');
const allOwners = read('supabase/migrations/20261022000000_everyone_in_a_home_is_an_owner.sql');
assert.match(allOwners, /update public\.site_memberships set membership_type = 'owner'/);
assert.match(allOwners, /before insert or update of membership_type on public\.site_memberships/, 'new memberships are owners too, whatever the client sends');
assert.match(allOwners, /before insert or update of membership_type on private\.site_invitations/);
assert.ok(!app.includes('<option value="member">'), 'no member/owner choice in the invite form');
console.log('  [5] Role scope: tools tab for crew only, plain sensor words and locked sensor points for home users; everyone in a home is an owner: PASS');

// [6] Trial mode: off unless ?trial=, never touches Supabase, answers the API itself.
const vm = require('node:vm');
const trialSrc = read('js/trial.js');
assert.ok(!/supabase|createClient/i.test(trialSrc.replace(/\/\/.*$/gm, '')), 'trial mode never creates a Supabase client');
function runTrial(search) {
  const realAuth = { real: true };
  const body = { prepend() {}, classList: { add() {} } };
  const win = { GasGuardAuth: realAuth, fetch: async () => { throw new Error('network used in trial mode'); } };
  const ctx = { window: win, location: { search, href: `https://gasguard.test/${search}`, origin: 'https://gasguard.test' }, URLSearchParams, URL, Response, Promise,
    document: { readyState: 'complete', body, createElement: () => ({ setAttribute() {}, addEventListener() {}, set innerHTML(v) {} }) } };
  vm.runInNewContext(trialSrc, ctx);
  return win;
}
(async () => {
  const off = runTrial('');
  assert.deepStrictEqual(off.GasGuardAuth, { real: true }, 'without ?trial nothing changes');
  assert.ok(!off.GasGuardTrial);
  const on = runTrial('?trial');
  assert.strictEqual(on.GasGuardTrial, true);
  const session = await on.GasGuardAuth.initialize();
  assert.strictEqual(on.GasGuardAuth.roleFromUser(session.user), 'general', 'the trial is a plain home user, never admin');
  const status = await (await on.fetch('/api/v1/device/status?device=x')).json();
  assert.strictEqual(status.connection, 'ONLINE');
  assert.strictEqual(Object.keys(status.sensorLatest).length, 2);
  assert.match(app, /window\.GasGuardTrial \? \['home', 'plan', 'history'\]/, 'the trial shows only the gas-detection screens');
  console.log('  [6] Trial mode: inactive by default, fake data only, gas-detection screens only: PASS');
  console.log('\nALL OWNER-1 APP TESTS PASSED!');
})().catch(err => { console.error(err); process.exit(1); });
