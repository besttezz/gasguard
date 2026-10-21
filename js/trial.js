(function () {
  'use strict';

  // Trial mode for reviewers: /?trial opens the gas-detection screens (home, floor plan, history) as a home owner
  // with made-up readings. It replaces GasGuardAuth with an in-browser stand-in and answers /api/v1/* itself, so
  // nothing reaches the database or the device API and nothing is saved. Without ?trial this file does nothing.
  const params = new URLSearchParams(location.search);
  if (!params.has('trial')) return;
  window.GasGuardTrial = true;

  const now0 = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const user = { id: 'trial', email: 'trial@gasguard', app_metadata: { role: 'general' }, user_metadata: { display_name: 'ผู้ทดลองใช้' } };
  const trial = { leakAt: null };

  // ---- Fake database: one home with one board and two sensors -----------------------------------
  const hourly = [];
  for (let h = 167; h >= 0; h--) {
    const hour = new Date(Math.floor((now0 - h * 3600e3) / 3600e3) * 3600e3).toISOString();
    const bump = h === 30 ? 1250 : h === 5 ? 980 : 0;
    hourly.push({ hour, sensor_uid: 'MQ6-01', max_gas_ppm: bump || 140 + (h % 7) * 9, avg_gas_ppm: 120, reading_count: 360, data_classification: 'DEVICE_DATA' });
    hourly.push({ hour, sensor_uid: 'MQ2-01', max_gas_ppm: bump ? bump * 0.5 : 80 + (h % 5) * 6, avg_gas_ppm: 70, reading_count: 360, data_classification: 'DEVICE_DATA' });
  }
  const site = { id: 'trial-home', name: 'บ้านตัวอย่าง (ทดลองใช้)', address_text: 'กรุงเทพฯ' };
  const lists = {
    site_memberships: [{ site_id: site.id, user_id: user.id, membership_type: 'owner', alert_min_level: 'watch', status: 'active', sites: site }],
    devices: [{ id: 'trial-device', site_id: site.id, device_uid: 'GG-DEMO-0001', lifecycle_status: 'active', created_at: iso(now0 - 9e8) }],
    telemetry_hourly: hourly
  };
  const singles = {
    site_memberships: { membership_type: 'owner', alert_min_level: 'watch' },
    site_settings: { hose_installed_on: '2024-05-01', sensor_checked_on: iso(now0 - 30 * 86400e3).slice(0, 10) }
  };
  const rpcData = {
    can_edit_site: true,
    site_members: [{ user_id: user.id, membership_type: 'owner', display_name: 'ผู้ทดลองใช้', email: user.email, is_me: true, alert_min_level: 'watch', line_linked: false }]
  };
  const builder = table => {
    let single = false;
    const b = {};
    ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'is', 'order', 'limit', 'insert', 'update', 'upsert', 'delete'].forEach(m => { b[m] = () => b; });
    b.maybeSingle = () => { single = true; return b; };
    b.single = () => { single = true; return b; };
    b.then = (res, rej) => Promise.resolve({ data: single ? singles[table] ?? null : lists[table] || [], error: null }).then(res, rej);
    return b;
  };
  const db = { from: builder, rpc: name => ({ then: (res, rej) => Promise.resolve({ data: rpcData[name] ?? null, error: null }).then(res, rej) }) };

  window.GasGuardAuth = {
    initialize: async () => ({ user, access_token: 'trial' }),
    getSession: async () => ({ user, access_token: 'trial' }),
    roleFromUser: () => 'general',
    loginErrorMessage: () => 'โหมดทดลองใช้',
    signIn: async () => ({ session: { user, access_token: 'trial' } }),
    signOut: async () => { location.href = '/'; },
    getClient: () => db
  };

  // ---- Fake API: live readings for the last hour ---------------------------------------------------
  // "จำลองแก๊สรั่ว" ramps sensor A from normal to danger in about a minute.
  function ppmAt(t) {
    const base = 150 + Math.sin(t / 60e3) * 8;
    if (trial.leakAt == null || t < trial.leakAt) return [base, base * 0.6];
    const a = Math.min(4200, base + ((t - trial.leakAt) / 1000) * 65);
    return [a, a * 0.45];
  }
  function status() {
    const now = Date.now(), history = [];
    for (let s = 3590; s >= 0; s -= 10) {
      const t = now - s * 1000;
      const [a, b] = ppmAt(t);
      history.push({ sensorId: 'MQ6-01', rawAdc: Math.round(700 + a / 4), gasPpm: Math.round(a), calibrationStatus: 'CALIBRATED', receivedAt: iso(t) });
      history.push({ sensorId: 'MQ2-01', rawAdc: Math.round(500 + b / 4), gasPpm: Math.round(b), calibrationStatus: 'CALIBRATED', receivedAt: iso(t) });
    }
    const latest = {};
    history.forEach(r => { latest[r.sensorId] = r; });
    return { deviceId: 'GG-DEMO-0001', dataClassification: 'DEVICE_DATA', connection: 'ONLINE', lastTelemetry: history[history.length - 1].receivedAt, sensorLatest: latest, history };
  }
  const api = {
    '/api/v1/config': () => ({ line: { configured: false }, ai: { configured: false } }),
    '/api/v1/device/status': status,
    '/api/v1/site/summary': () => ({ ok: true, summary: 'สัปดาห์นี้ค่าแก๊สส่วนใหญ่อยู่ระดับปกติ มีช่วงที่สูงขึ้นถึงระดับเฝ้าระวัง 2 ครั้ง (สูงสุด 1,250 ppm) แนะนำให้ตรวจข้อต่อและวาล์วที่ถังแก๊ส', source: 'template', created_at: new Date().toISOString() })
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      const make = api[url.pathname];
      const body = make ? make() : { ok: true, trial: true };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    return realFetch(input, init);
  };

  // ---- Trial bar -----------------------------------------------------------------------------------
  function bar() {
    const el = document.createElement('div');
    el.className = 'trial-bar';
    el.setAttribute('role', 'status');
    const draw = () => {
      el.innerHTML = `<span><strong>ทดลองตรวจแก๊ส</strong> · ข้อมูลจำลอง ไม่บันทึกจริง</span>
        <span class="trial-bar-actions"><button type="button" data-trial="leak"${trial.leakAt ? ' class="is-on"' : ''}>${trial.leakAt ? 'หยุดแก๊สรั่ว' : 'จำลองแก๊สรั่ว'}</button><a href="/">ออก</a></span>`;
    };
    draw();
    el.addEventListener('click', evt => {
      if (!evt.target.closest('[data-trial="leak"]')) return;
      trial.leakAt = trial.leakAt ? null : Date.now();
      draw();
    });
    document.body.prepend(el);
    document.body.classList.add('is-trial');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bar); else bar();
}());
