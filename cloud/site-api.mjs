// GasGuard site/admin API (Cloudflare Pages Functions runtime, also importable from Node tests).
//
//   GET  /api/v1/config           Which optional services are configured (LINE, AI). Public, no secrets.
//   POST /api/v1/invite/signup    Create an account from an invitation link and join that home.
//   POST /api/v1/line/webhook     LINE Messaging API webhook: links a LINE account with a 6-digit code.
//   POST /api/v1/site/summary     Weekly summary of a site (Gemini when configured, else a template).
//   GET  /api/v1/admin/users      Admin: list accounts.        POST: create an account.   PATCH: change role.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (secret),
//      LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, LINE_ADD_FRIEND_URL (optional),
//      GEMINI_API_KEY (optional secret), GEMINI_MODEL (optional).

const ROLES = ['general', 'technician', 'admin', 'developer'];
const LEVELS = {
  watch: { label: 'เฝ้าระวัง', headline: 'เริ่มมีแก๊สสะสม ให้ระบายอากาศ', action: 'เปิดประตูและหน้าต่างให้อากาศถ่ายเท' },
  warning: { label: 'เตือน', headline: 'ห้ามเปิด-ปิดสวิตช์ไฟ ปิดวาล์วถังแก๊ส', action: 'ปิดวาล์วถังแก๊สทันที เปิดประตูหน้าต่างทุกบาน' },
  danger: { label: 'อันตราย', headline: 'รีบอพยพออกจากพื้นที่ทันที', action: 'ออกจากอาคาร ห้ามแตะสวิตช์ไฟ แล้วโทร 199' }
};
const APP_URL = 'https://gasguard-bu.pages.dev';
const SUMMARY_TTL_MS = 6 * 3600e3;

export const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

const clean = value => String(value || '').trim().replace(/^["']|["']$/g, '');
const base = env => clean(env.SUPABASE_URL).replace(/\/+$/, '');
const bearer = request => (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i)?.[1] || null;

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function serviceHeaders(env, extra = {}) {
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra };
}

async function service(env, fetchImpl, path, init = {}) {
  const response = await fetchImpl(`${base(env)}${path}`, { ...init, headers: serviceHeaders(env, init.headers) });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(`service ${path} ${response.status}`), { status: response.status, body });
  return body;
}

const rpc = (env, fetchImpl, name, args) => service(env, fetchImpl, `/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });

// The caller's account, checked by Supabase Auth with their own access token.
export async function getUser(env, fetchImpl, token) {
  if (!token) return null;
  const response = await fetchImpl(`${base(env)}/auth/v1/user`, { headers: { apikey: clean(env.SUPABASE_ANON_KEY), authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return response.json();
}

const configured = env => Boolean(env?.SUPABASE_URL && clean(env.SUPABASE_SERVICE_ROLE_KEY) && env?.SUPABASE_ANON_KEY);
const lineReady = env => Boolean(clean(env.LINE_CHANNEL_ACCESS_TOKEN) && clean(env.LINE_CHANNEL_SECRET));

// ---- Config -------------------------------------------------------------------------------------
export function handleConfig(env) {
  const add = clean(env?.LINE_ADD_FRIEND_URL);
  return json(200, {
    line: { configured: lineReady(env || {}), addFriendUrl: /^https:\/\/(line\.me|lin\.ee)\//.test(add) ? add : null },
    ai: { configured: Boolean(clean(env?.GEMINI_API_KEY)) }
  });
}

// ---- Invitation sign-up -------------------------------------------------------------------------
export async function handleInviteSignup(request, env, fetchImpl = fetch) {
  if (!configured(env)) return json(503, { ok: false, code: 'NOT_CONFIGURED' });
  const body = await request.json().catch(() => null);
  const token = String(body?.token || '');
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const displayName = String(body?.displayName || '').trim().slice(0, 60);
  if (!/^[0-9a-f]{64}$/.test(token)) return json(400, { ok: false, code: 'INVITATION_INVALID' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(400, { ok: false, code: 'EMAIL_INVALID' });
  if (password.length < 8 || password.length > 72) return json(400, { ok: false, code: 'PASSWORD_TOO_SHORT' });

  const tokenHash = await sha256Hex(token);
  try {
    const info = await rpc(env, fetchImpl, 'invitation_info', { p_token_hash: tokenHash });
    if (!info?.valid) return json(410, { ok: false, code: 'INVITATION_INVALID', status: info?.status || null });
    let user;
    try {
      user = await service(env, fetchImpl, '/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({
        email, password, email_confirm: true, app_metadata: { role: 'general' }, user_metadata: { display_name: displayName || null }
      }) });
    } catch (error) {
      if (error.status === 422 || error.status === 409 || /already/i.test(JSON.stringify(error.body || ''))) return json(409, { ok: false, code: 'EMAIL_EXISTS' });
      throw error;
    }
    const claim = await rpc(env, fetchImpl, 'claim_site_invitation_for', { p_token_hash: tokenHash, p_user_id: user.id });
    if (!claim?.ok) return json(410, { ok: false, code: 'INVITATION_INVALID' });
    if (displayName) {
      await service(env, fetchImpl, `/rest/v1/profiles?id=eq.${user.id}`, { method: 'PATCH', body: JSON.stringify({ display_name: displayName }) }).catch(() => null);
    }
    return json(201, { ok: true });
  } catch (error) {
    return json(502, { ok: false, code: 'STORE_UNAVAILABLE' });
  }
}

// ---- LINE ----------------------------------------------------------------------------------------
async function hmacBase64(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  let bin = '';
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function lineCall(env, fetchImpl, path, payload) {
  const response = await fetchImpl(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${clean(env.LINE_CHANNEL_ACCESS_TOKEN)}` },
    body: JSON.stringify(payload)
  });
  return response.ok;
}

export async function handleLineWebhook(request, env, fetchImpl = fetch) {
  if (!lineReady(env) || !configured(env)) return json(503, { ok: false, code: 'LINE_NOT_CONFIGURED' });
  const text = await request.text();
  const expected = await hmacBase64(clean(env.LINE_CHANNEL_SECRET), text);
  if (!timingSafeEqual(request.headers.get('x-line-signature') || '', expected)) return json(401, { ok: false, code: 'BAD_SIGNATURE' });
  let body;
  try { body = JSON.parse(text); } catch (_) { return json(400, { ok: false }); }
  for (const event of Array.isArray(body?.events) ? body.events : []) {
    const lineUserId = event?.source?.userId;
    if (!event.replyToken || !/^U[0-9a-f]{32}$/.test(lineUserId || '')) continue;
    let reply = null;
    if (event.type === 'follow') {
      reply = 'สวัสดีครับ นี่คือ GasGuard\nเปิดแอป > บ้านของฉัน > เชื่อม LINE แล้วส่งรหัส 6 หลักมาที่แชทนี้ เพื่อรับแจ้งเตือนแก๊ส';
    } else if (event.type === 'message' && event.message?.type === 'text') {
      const code = String(event.message.text || '').replace(/\s+/g, '');
      if (/^\d{6}$/.test(code)) {
        const result = await rpc(env, fetchImpl, 'consume_line_link_code', { p_code: code, p_line_user_id: lineUserId }).catch(() => null);
        reply = result?.ok ? 'เชื่อมต่อสำเร็จ จากนี้คุณจะได้รับแจ้งเตือนแก๊สของบ้านทาง LINE' : 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว ขอรหัสใหม่ในแอปแล้วส่งมาอีกครั้ง';
      } else {
        reply = 'ส่งรหัส 6 หลักจากแอป GasGuard (บ้านของฉัน > เชื่อม LINE) เพื่อเชื่อมบัญชี';
      }
    }
    if (reply) await lineCall(env, fetchImpl, 'reply', { replyToken: event.replyToken, messages: [{ type: 'text', text: reply }] }).catch(() => false);
  }
  return json(200, { ok: true });
}

export function alertMessage(result) {
  const site = result.site_name || 'บ้านของคุณ';
  if (result.event === 'resolved') return `GasGuard · ${site}\nค่าแก๊สกลับสู่ระดับปกติแล้ว\n${APP_URL}`;
  const lv = LEVELS[result.level];
  if (!lv) return null;
  const ppm = Number(result.ppm);
  return `GasGuard · ${site}\nระดับ${lv.label} (${Number.isFinite(ppm) ? Math.round(ppm).toLocaleString('en-US') : '?'} ppm)\n${lv.headline}\n${lv.action}\nดูในแอป: ${APP_URL}`;
}

// Called by the ingress after a stored reading: updates the site's alert episode and pushes LINE messages.
export async function evaluateAndNotify(env, fetchImpl, deviceUid) {
  if (!configured(env)) return null;
  const result = await rpc(env, fetchImpl, 'evaluate_site_alert', { p_device_uid: deviceUid });
  if (!result?.event || !lineReady(env)) return result;
  const to = (Array.isArray(result.line_recipients) ? result.line_recipients : []).filter(id => /^U[0-9a-f]{32}$/.test(id));
  const text = alertMessage(result);
  if (to.length && text) {
    for (let i = 0; i < to.length; i += 500) {
      await lineCall(env, fetchImpl, 'multicast', { to: to.slice(i, i + 500), messages: [{ type: 'text', text }] }).catch(() => false);
    }
  }
  return result;
}

// ---- Weekly summary ------------------------------------------------------------------------------
export function summaryFacts(hourly, episodes, now = Date.now()) {
  const days = new Map();
  let hotHours = 0, max = null, readings = 0;
  const hours = new Set();
  for (const r of hourly) {
    const ppm = r.max_gas_ppm == null ? null : Number(r.max_gas_ppm);
    readings += Number(r.reading_count) || 0;
    hours.add(r.hour);
    if (ppm == null) continue;
    max = max == null ? ppm : Math.max(max, ppm);
    const day = String(r.hour).slice(0, 10);
    days.set(day, Math.max(days.get(day) || 0, ppm));
  }
  const byHour = new Map();
  for (const r of hourly) if (r.max_gas_ppm != null) byHour.set(r.hour, Math.max(byHour.get(r.hour) || 0, Number(r.max_gas_ppm)));
  for (const v of byHour.values()) if (v >= 900) hotHours++;
  return {
    period_days: 7,
    max_ppm: max == null ? null : Math.round(max),
    hours_with_data: hours.size,
    hours_expected: 168,
    hours_above_watch: hotHours,
    readings,
    daily_max_ppm: Object.fromEntries([...days.entries()].sort().map(([d, v]) => [d, Math.round(v)])),
    alert_episodes: episodes.map(e => ({ peak_level: e.peak_level, peak_ppm: e.peak_ppm == null ? null : Math.round(Number(e.peak_ppm)),
      started_at: e.started_at, minutes: e.ended_at ? Math.max(1, Math.round((Date.parse(e.ended_at) - Date.parse(e.started_at)) / 60000)) : null }))
  };
}

const LEVEL_TH = { watch: 'เฝ้าระวัง', warning: 'เตือน', danger: 'อันตราย' };
export function templateSummary(f) {
  if (!f.hours_with_data) return 'สัปดาห์นี้ยังไม่มีข้อมูลจากบอร์ด ตรวจว่าบอร์ดเปิดอยู่และเชื่อมต่อ Wi-Fi แล้ว';
  const parts = [];
  if (!f.alert_episodes.length && f.hours_above_watch === 0) parts.push(`สัปดาห์นี้ค่าแก๊สอยู่ในระดับปกติตลอด ค่าสูงสุด ${f.max_ppm ?? '-'} ppm`);
  else {
    const worst = f.alert_episodes.reduce((a, e) => (!a || ['watch', 'warning', 'danger'].indexOf(e.peak_level) > ['watch', 'warning', 'danger'].indexOf(a.peak_level) ? e : a), null);
    parts.push(`สัปดาห์นี้มีช่วงที่ค่าแก๊สสูงกว่าปกติ ${f.alert_episodes.length || f.hours_above_watch} ครั้ง${worst ? ` สูงสุดถึงระดับ${LEVEL_TH[worst.peak_level]} (${worst.peak_ppm ?? f.max_ppm} ppm)` : ''}`);
    parts.push('แนะนำให้ตรวจสายแก๊ส ข้อต่อ และวาล์วที่ถัง');
  }
  const coverage = f.hours_with_data / f.hours_expected;
  if (coverage < 0.8) parts.push(`บอร์ดส่งข้อมูลได้ ${Math.round(coverage * 100)}% ของเวลา ควรตรวจไฟและ Wi-Fi ของบอร์ด`);
  return parts.join(' ');
}

async function geminiSummary(env, fetchImpl, facts) {
  const model = clean(env.GEMINI_MODEL) || 'gemini-flash-lite-latest';
  const prompt = `คุณเขียนสรุปความปลอดภัยแก๊ส LPG ประจำสัปดาห์ให้เจ้าของบ้าน
กติกา: ภาษาไทยง่าย ๆ 2-3 ประโยค ไม่เกิน 350 ตัวอักษร ใช้เฉพาะตัวเลขในข้อมูลนี้ ห้ามเดา ห้ามตัดสินว่าอันตรายหรือปลอดภัยเกินกว่าข้อมูล
ถ้ามีช่วงที่ค่าสูง ให้แนะนำตรวจสายแก๊สและข้อต่อ ถ้าบอร์ดส่งข้อมูลไม่ครบ ให้แนะนำตรวจไฟและ Wi-Fi
เกณฑ์: ต่ำกว่า 900 ppm ปกติ, 900 เฝ้าระวัง, 1,800 เตือน, 3,600 อันตราย
ข้อมูล: ${JSON.stringify(facts)}`;
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': clean(env.GEMINI_API_KEY) },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 300 } })
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const text = body?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
  return text ? { text: text.slice(0, 1200), model } : null;
}

export async function handleSummary(request, env, fetchImpl = fetch, now = Date.now) {
  if (!configured(env)) return json(503, { ok: false, code: 'NOT_CONFIGURED' });
  const token = bearer(request);
  if (!token) return json(401, { ok: false, code: 'SIGN_IN_REQUIRED' });
  const body = await request.json().catch(() => null);
  const siteId = String(body?.siteId || '');
  if (!/^[0-9a-f-]{36}$/.test(siteId)) return json(400, { ok: false, code: 'BAD_SITE' });
  // Visibility is decided by RLS with the caller's own token.
  const visible = await fetchImpl(`${base(env)}/rest/v1/sites?id=eq.${siteId}&select=id`, { headers: { apikey: clean(env.SUPABASE_ANON_KEY), authorization: `Bearer ${token}` } });
  const rows = visible.ok ? await visible.json() : [];
  if (!rows.length) return json(403, { ok: false, code: 'NOT_ALLOWED' });

  try {
    const cached = await service(env, fetchImpl, `/rest/v1/ai_summaries?site_id=eq.${siteId}&select=summary,source,model,created_at`);
    if (cached[0] && now() - Date.parse(cached[0].created_at) < SUMMARY_TTL_MS && !body?.refresh) return json(200, { ok: true, ...cached[0], cached: true });
    const since = new Date(now() - 7 * 86400e3).toISOString();
    const hourly = await service(env, fetchImpl, `/rest/v1/telemetry_hourly?site_id=eq.${siteId}&data_classification=neq.SYNTHETIC_HANDSHAKE&hour=gte.${encodeURIComponent(since)}&select=hour,max_gas_ppm,reading_count`);
    const episodes = await service(env, fetchImpl, `/rest/v1/alert_episodes?site_id=eq.${siteId}&started_at=gte.${encodeURIComponent(since)}&select=peak_level,peak_ppm,started_at,ended_at&order=started_at.asc`);
    const facts = summaryFacts(hourly, episodes, now());
    const ai = clean(env.GEMINI_API_KEY) && facts.hours_with_data ? await geminiSummary(env, fetchImpl, facts).catch(() => null) : null;
    const row = { site_id: siteId, summary: ai ? ai.text : templateSummary(facts), source: ai ? 'gemini' : 'template', model: ai ? ai.model : null, facts, created_at: new Date(now()).toISOString() };
    await service(env, fetchImpl, '/rest/v1/ai_summaries', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) }).catch(() => null);
    return json(200, { ok: true, summary: row.summary, source: row.source, model: row.model, created_at: row.created_at, cached: false });
  } catch (error) {
    return json(502, { ok: false, code: 'STORE_UNAVAILABLE' });
  }
}

// ---- Admin: accounts -----------------------------------------------------------------------------
async function requireAdmin(request, env, fetchImpl) {
  const user = await getUser(env, fetchImpl, bearer(request));
  return user?.app_metadata?.role === 'admin' ? user : null;
}

export async function handleAdminUsers(request, env, fetchImpl = fetch) {
  if (!configured(env)) return json(503, { ok: false, code: 'NOT_CONFIGURED' });
  const admin = await requireAdmin(request, env, fetchImpl);
  if (!admin) return json(403, { ok: false, code: 'ADMIN_ONLY' });
  try {
    if (request.method === 'GET') {
      const list = await service(env, fetchImpl, '/auth/v1/admin/users?page=1&per_page=500');
      const users = (list?.users || []).map(u => ({ id: u.id, email: u.email, role: u.app_metadata?.role || 'general', displayName: u.user_metadata?.display_name || null, createdAt: u.created_at, lastSignInAt: u.last_sign_in_at || null }));
      return json(200, { ok: true, users });
    }
    const body = await request.json().catch(() => null);
    const role = String(body?.role || 'general');
    if (!ROLES.includes(role)) return json(400, { ok: false, code: 'BAD_ROLE' });
    if (request.method === 'PATCH') {
      const id = String(body?.userId || '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return json(400, { ok: false, code: 'BAD_USER' });
      if (id === admin.id && role !== 'admin') return json(400, { ok: false, code: 'CANNOT_DEMOTE_SELF' });
      await service(env, fetchImpl, `/auth/v1/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ app_metadata: { role } }) });
      return json(200, { ok: true });
    }
    if (request.method === 'POST') {
      const email = String(body?.email || '').trim().toLowerCase();
      const password = String(body?.password || '');
      const displayName = String(body?.displayName || '').trim().slice(0, 60);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { ok: false, code: 'EMAIL_INVALID' });
      if (password.length < 8 || password.length > 72) return json(400, { ok: false, code: 'PASSWORD_TOO_SHORT' });
      let user;
      try {
        user = await service(env, fetchImpl, '/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true, app_metadata: { role }, user_metadata: { display_name: displayName || null } }) });
      } catch (error) {
        if (error.status === 422 || /already/i.test(JSON.stringify(error.body || ''))) return json(409, { ok: false, code: 'EMAIL_EXISTS' });
        throw error;
      }
      if (displayName) await service(env, fetchImpl, `/rest/v1/profiles?id=eq.${user.id}`, { method: 'PATCH', body: JSON.stringify({ display_name: displayName }) }).catch(() => null);
      const siteId = String(body?.siteId || '');
      if (/^[0-9a-f-]{36}$/.test(siteId)) {
        const membershipType = body?.membershipType === 'owner' ? 'owner' : 'member';
        await service(env, fetchImpl, '/rest/v1/site_memberships', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: siteId, user_id: user.id, membership_type: membershipType, status: 'active' }) });
      }
      return json(201, { ok: true, id: user.id });
    }
    return new Response(null, { status: 405, headers: { allow: 'GET, POST, PATCH' } });
  } catch (error) {
    return json(502, { ok: false, code: 'STORE_UNAVAILABLE' });
  }
}
