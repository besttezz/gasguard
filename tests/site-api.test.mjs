import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../cloud/site-api.mjs';

console.log('Running SITE-1 site / LINE / summary / admin API tests...\n');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = 'sb_secret_test_service_key_0123456789';
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: SERVICE };
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const req = (url, init = {}) => new Request(`https://app.test${url}`, init);

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, handler] of routes) if (String(url).includes(match)) return handler(String(url), init);
    return jsonRes(404, {});
  };
  fn.calls = calls;
  return fn;
}

// [1] Config never leaks secrets, reports what is set up
let r = api.handleConfig({ ...env, LINE_CHANNEL_ACCESS_TOKEN: 't', LINE_CHANNEL_SECRET: 's', LINE_ADD_FRIEND_URL: 'https://lin.ee/abc', GEMINI_API_KEY: 'g' });
let body = await r.json();
assert.deepStrictEqual(body, { line: { configured: true, addFriendUrl: 'https://lin.ee/abc' }, ai: { configured: true } });
body = await api.handleConfig({ LINE_ADD_FRIEND_URL: 'javascript:alert(1)' }).json();
assert.deepStrictEqual(body, { line: { configured: false, addFriendUrl: null }, ai: { configured: false } });
console.log('  [1] Config reports LINE/AI availability without exposing secrets: PASS');

// [2] Invitation sign-up: validates input, creates a confirmed general account, claims the invite
const token = crypto.randomBytes(32).toString('hex');
let created = null;
let f = fakeFetch([
  ['/rpc/invitation_info', () => jsonRes(200, { valid: true, site_name: 'บ้าน A' })],
  ['/auth/v1/admin/users', (u, init) => { created = JSON.parse(init.body); return jsonRes(200, { id: '11111111-1111-1111-1111-111111111111' }); }],
  ['/rpc/claim_site_invitation_for', () => jsonRes(200, { ok: true, site_id: 's' })],
  ['/rest/v1/profiles', () => jsonRes(204, null)]
]);
r = await api.handleInviteSignup(req('/api/v1/invite/signup', { method: 'POST', body: JSON.stringify({ token, email: 'Mom@Example.com', password: 'longenough', displayName: 'แม่' }) }), env, f);
assert.strictEqual(r.status, 201);
assert.strictEqual(created.email, 'mom@example.com');
assert.strictEqual(created.email_confirm, true);
assert.deepStrictEqual(created.app_metadata, { role: 'general' }, 'invited people never get a privileged role');
const infoCall = f.calls.find(c => c.url.includes('invitation_info'));
assert.strictEqual(JSON.parse(infoCall.init.body).p_token_hash, crypto.createHash('sha256').update(token).digest('hex'), 'only the token hash reaches the database');
r = await api.handleInviteSignup(req('/x', { method: 'POST', body: JSON.stringify({ token, email: 'a@b.co', password: 'short' }) }), env, f);
assert.strictEqual((await r.json()).code, 'PASSWORD_TOO_SHORT');
r = await api.handleInviteSignup(req('/x', { method: 'POST', body: JSON.stringify({ token: 'nope', email: 'a@b.co', password: 'longenough' }) }), env, f);
assert.strictEqual((await r.json()).code, 'INVITATION_INVALID');
f = fakeFetch([['/rpc/invitation_info', () => jsonRes(200, { valid: false, status: 'claimed' })]]);
r = await api.handleInviteSignup(req('/x', { method: 'POST', body: JSON.stringify({ token, email: 'a@b.co', password: 'longenough' }) }), env, f);
assert.strictEqual(r.status, 410);
f = fakeFetch([['/rpc/invitation_info', () => jsonRes(200, { valid: true })], ['/auth/v1/admin/users', () => jsonRes(422, { msg: 'User already registered' })]]);
r = await api.handleInviteSignup(req('/x', { method: 'POST', body: JSON.stringify({ token, email: 'a@b.co', password: 'longenough' }) }), env, f);
assert.strictEqual((await r.json()).code, 'EMAIL_EXISTS');
console.log('  [2] Invite sign-up validates input, sends only the token hash, creates a general account: PASS');

// [3] LINE webhook: rejects bad signatures, links an account with a 6-digit code and replies
const lineEnv = { ...env, LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_CHANNEL_SECRET: 'sec' };
const event = { events: [{ type: 'message', replyToken: 'r1', source: { userId: `U${'a'.repeat(32)}` }, message: { type: 'text', text: '123456' } }] };
const raw = JSON.stringify(event);
const sig = crypto.createHmac('sha256', 'sec').update(raw).digest('base64');
f = fakeFetch([['/rpc/consume_line_link_code', () => jsonRes(200, { ok: true })], ['api.line.me', () => jsonRes(200, {})]]);
r = await api.handleLineWebhook(req('/w', { method: 'POST', body: raw, headers: { 'x-line-signature': 'bad' } }), lineEnv, f);
assert.strictEqual(r.status, 401);
r = await api.handleLineWebhook(req('/w', { method: 'POST', body: raw, headers: { 'x-line-signature': sig } }), lineEnv, f);
assert.strictEqual(r.status, 200);
const consume = f.calls.find(c => c.url.includes('consume_line_link_code'));
assert.deepStrictEqual(JSON.parse(consume.init.body), { p_code: '123456', p_line_user_id: `U${'a'.repeat(32)}` });
const reply = f.calls.find(c => c.url.includes('/message/reply'));
assert.match(JSON.parse(reply.init.body).messages[0].text, /เชื่อมต่อสำเร็จ/);
assert.strictEqual((await api.handleLineWebhook(req('/w', { method: 'POST', body: raw }), env, f)).status, 503, 'webhook is off until LINE is configured');
console.log('  [3] LINE webhook checks the signature, links with a code and replies: PASS');

// [4] Alert evaluation pushes LINE messages only to linked members in range
assert.match(api.alertMessage({ event: 'raised', level: 'danger', ppm: 4200, site_name: 'ร้าน A' }), /ระดับอันตราย \(4,200 ppm\)[\s\S]*199/);
assert.match(api.alertMessage({ event: 'resolved', site_name: 'ร้าน A' }), /กลับสู่ระดับปกติ/);
f = fakeFetch([['/rpc/evaluate_site_alert', () => jsonRes(200, { event: 'raised', level: 'warning', ppm: 2000, site_name: 'บ้าน', line_recipients: [`U${'b'.repeat(32)}`, 'not-a-line-id'] })], ['api.line.me', () => jsonRes(200, {})]]);
await api.evaluateAndNotify(lineEnv, f, 'ESP32-KITCHEN-01');
const push = f.calls.find(c => c.url.includes('/message/multicast'));
assert.deepStrictEqual(JSON.parse(push.init.body).to, [`U${'b'.repeat(32)}`]);
f = fakeFetch([['/rpc/evaluate_site_alert', () => jsonRes(200, { event: null })]]);
await api.evaluateAndNotify(lineEnv, f, 'ESP32-KITCHEN-01');
assert.ok(!f.calls.some(c => c.url.includes('api.line.me')), 'no change, no message');
console.log('  [4] Level changes push LINE messages to linked members only: PASS');

// [5] Weekly summary: facts from hourly data, template fallback, Gemini when configured, RLS-checked
const hourly = [
  { hour: '2026-10-14T10:00:00Z', max_gas_ppm: 150, reading_count: 360 },
  { hour: '2026-10-15T18:00:00Z', max_gas_ppm: 1250, reading_count: 360 }
];
const facts = api.summaryFacts(hourly, [{ peak_level: 'watch', peak_ppm: 1250, started_at: '2026-10-15T18:40:00Z', ended_at: '2026-10-15T18:46:00Z' }]);
assert.strictEqual(facts.max_ppm, 1250);
assert.strictEqual(facts.hours_above_watch, 1);
assert.strictEqual(facts.alert_episodes[0].minutes, 6);
assert.match(api.templateSummary(facts), /ระดับเฝ้าระวัง[\s\S]*ตรวจสายแก๊ส/);
assert.match(api.templateSummary({ hours_with_data: 0 }), /ยังไม่มีข้อมูล/);
const SITE = '22222222-2222-2222-2222-222222222222';
let stored = null;
const summaryRoutes = gemini => fakeFetch([
  ['/rest/v1/sites?', () => jsonRes(200, [{ id: SITE }])],
  ['/rest/v1/ai_summaries?', () => jsonRes(200, [])],
  ['/rest/v1/telemetry_hourly', () => jsonRes(200, hourly)],
  ['/rest/v1/alert_episodes', () => jsonRes(200, [])],
  ['/rest/v1/ai_summaries', (u, init) => { stored = JSON.parse(init.body); return jsonRes(201, null); }],
  ['generativelanguage.googleapis.com', () => (gemini ? jsonRes(200, { candidates: [{ content: { parts: [{ text: 'สัปดาห์นี้ปลอดภัยดี' }] } }] }) : jsonRes(500, {}))]
]);
r = await api.handleSummary(req('/s', { method: 'POST', body: JSON.stringify({ siteId: SITE }), headers: { authorization: 'Bearer user' } }), env, summaryRoutes(true));
body = await r.json();
assert.strictEqual(body.source, 'template', 'no API key, no Gemini call');
r = await api.handleSummary(req('/s', { method: 'POST', body: JSON.stringify({ siteId: SITE }), headers: { authorization: 'Bearer user' } }), { ...env, GEMINI_API_KEY: 'k' }, summaryRoutes(true));
body = await r.json();
assert.strictEqual(body.source, 'gemini');
assert.strictEqual(body.summary, 'สัปดาห์นี้ปลอดภัยดี');
assert.strictEqual(stored.source, 'gemini');
r = await api.handleSummary(req('/s', { method: 'POST', body: JSON.stringify({ siteId: SITE }), headers: { authorization: 'Bearer user' } }), { ...env, GEMINI_API_KEY: 'k' }, summaryRoutes(false));
assert.strictEqual((await r.json()).source, 'template', 'Gemini failure falls back to the template');
f = fakeFetch([['/rest/v1/sites?', () => jsonRes(200, [])]]);
r = await api.handleSummary(req('/s', { method: 'POST', body: JSON.stringify({ siteId: SITE }), headers: { authorization: 'Bearer user' } }), env, f);
assert.strictEqual(r.status, 403, 'a site the caller cannot see is refused');
console.log('  [5] Weekly summary uses Gemini when configured, template otherwise, and respects RLS: PASS');

// [6] Admin users: admin only, validates roles, creates accounts with a site membership
const asUser = role => fakeFetch([
  ['/auth/v1/user', () => jsonRes(200, { id: '33333333-3333-3333-3333-333333333333', app_metadata: { role } })],
  ['/auth/v1/admin/users?', () => jsonRes(200, { users: [{ id: 'u1', email: 'a@b.co', app_metadata: { role: 'technician' } }] })],
  ['/auth/v1/admin/users', () => jsonRes(200, { id: '44444444-4444-4444-4444-444444444444' })],
  ['/rest/v1/profiles', () => jsonRes(204, null)],
  ['/rest/v1/site_memberships', () => jsonRes(201, null)]
]);
r = await api.handleAdminUsers(req('/a', { headers: { authorization: 'Bearer t' } }), env, asUser('general'));
assert.strictEqual(r.status, 403);
r = await api.handleAdminUsers(req('/a', { headers: { authorization: 'Bearer t' } }), env, asUser('admin'));
assert.deepStrictEqual((await r.json()).users.map(u => u.role), ['technician']);
f = asUser('admin');
r = await api.handleAdminUsers(req('/a', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ email: 'tech@x.co', password: 'longenough', role: 'technician', siteId: SITE, membershipType: 'member' }) }), env, f);
assert.strictEqual(r.status, 201);
assert.ok(f.calls.some(c => c.url.includes('/rest/v1/site_memberships')));
r = await api.handleAdminUsers(req('/a', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ email: 'x@x.co', password: 'longenough', role: 'superuser' }) }), env, asUser('admin'));
assert.strictEqual((await r.json()).code, 'BAD_ROLE');
r = await api.handleAdminUsers(req('/a', { method: 'PATCH', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ userId: '33333333-3333-3333-3333-333333333333', role: 'general' }) }), env, asUser('admin'));
assert.strictEqual((await r.json()).code, 'CANNOT_DEMOTE_SELF');
console.log('  [6] Admin user API is admin-only, validates roles, adds memberships: PASS');

// [7] Routes and migration
for (const route of ['config', 'invite/signup', 'line/webhook', 'site/summary', 'admin/users']) assert.ok(fs.existsSync(path.join(root, `functions/api/v1/${route}.js`)), route);
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261021000000_members_alerts_line_tech_admin.sql'), 'utf8');
for (const t of ['alert_episodes', 'alert_acks', 'user_line_links', 'site_settings', 'ai_summaries', 'sensor_calibrations']) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `${t} has RLS`);
assert.match(sql, /when p_ppm >= 3600 then 'danger'\s+when p_ppm >= 1800 then 'warning'\s+when p_ppm >= 900 then 'watch'/, 'server thresholds match the app');
assert.match(sql, /grant execute on function public\.claim_site_invitation_for\(text, uuid\), public\.evaluate_site_alert\(text\),\s+public\.consume_line_link_code\(text, text\) to service_role/);
assert.match(sql, /create table private\.site_invitations/);
assert.match(sql, /if not public\.is_admin\(\) then raise exception 'NOT_ALLOWED'/, 'only admins issue device keys');
console.log('  [7] Routes exist; migration has RLS on new tables and matching thresholds: PASS');

console.log('\nALL SITE-1 SITE API TESTS PASSED!');
