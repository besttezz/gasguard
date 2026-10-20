(function () {
  'use strict';

  // Trial mode for reviewers: /?trial=owner|member|technician|admin|developer opens the real app with made-up data.
  // It replaces GasGuardAuth with an in-browser stand-in and answers /api/v1/* itself, so nothing reaches Supabase
  // or the device API and nothing is saved. Without ?trial= this file does nothing.
  const params = new URLSearchParams(location.search);
  const ROLES = {
    owner: { role: 'general', user: 'u1', label: 'เจ้าของบ้าน', name: 'คุณสมชาย', membership: 'owner' },
    member: { role: 'general', user: 'u2', label: 'สมาชิกในบ้าน', name: 'แม่', membership: 'member' },
    technician: { role: 'technician', user: 'u3', label: 'ช่างติดตั้ง', name: 'ช่างเอ', membership: null },
    admin: { role: 'admin', user: 'u4', label: 'ผู้ดูแลระบบ', name: 'แอดมิน', membership: null },
    developer: { role: 'developer', user: 'u5', label: 'นักพัฒนา', name: 'ทีมพัฒนา', membership: 'owner' }
  };
  const pick = ROLES[params.get('trial')];
  if (!pick) return;

  const now0 = Date.now();
  const iso = ms => new Date(ms).toISOString();
  const user = { id: pick.user, email: `${params.get('trial')}@trial.gasguard`, app_metadata: { role: pick.role }, user_metadata: { display_name: pick.name } };
  const trial = { leakAt: null };

  // ---- Fake database -----------------------------------------------------------------------------
  const hourly = [];
  for (let h = 167; h >= 0; h--) {
    const hour = new Date(Math.floor((now0 - h * 3600e3) / 3600e3) * 3600e3).toISOString();
    const bump = h === 30 ? 1250 : h === 5 ? 980 : 0;
    hourly.push({ hour, sensor_uid: 'MQ6-01', max_gas_ppm: bump || 140 + (h % 7) * 9, avg_gas_ppm: 120, reading_count: 360, data_classification: 'DEVICE_DATA' });
    hourly.push({ hour, sensor_uid: 'MQ2-01', max_gas_ppm: bump ? bump * 0.5 : 80 + (h % 5) * 6, avg_gas_ppm: 70, reading_count: 360, data_classification: 'DEVICE_DATA' });
  }
  const site1 = { id: 's1', name: 'บ้านตัวอย่าง (ทดลองใช้)', address_text: 'บางนา กรุงเทพฯ', customers: { customer_type: 'household', display_name: 'คุณสมชาย' } };
  const site2 = { id: 's2', name: 'ร้านอาหารตัวอย่าง สาขา 1', address_text: 'ลาดพร้าว กรุงเทพฯ', customers: { customer_type: 'restaurant', display_name: 'ร้านตัวอย่าง' } };
  const job = { id: 'j1', site_id: 's1', job_type: 'installation', status: 'scheduled', scheduled_for: iso(now0 + 86400e3), notes: 'ติดตั้งในครัว ถังแก๊สอยู่ใต้เคาน์เตอร์', sites: site1, job_assignments: [{ technician_user_id: 'u3', assignment_status: 'assigned' }] };
  const lists = {
    site_memberships: [{ site_id: 's1', user_id: pick.user, membership_type: pick.membership || 'owner', alert_min_level: 'watch', status: 'active', sites: site1 },
      { site_id: 's1', user_id: 'u2', membership_type: 'member', status: 'active' }],
    sites: [site1, site2],
    devices: [{ id: 'd1', site_id: 's1', device_uid: 'GG-DEMO-0001', lifecycle_status: 'active', created_at: iso(now0 - 9e8), device_status: { last_seen_at: iso(now0 - 3000), gas_ppm: 150, data_classification: 'DEVICE_DATA' }, sensors: [{ sensor_uid: 'MQ6-01' }, { sensor_uid: 'MQ2-01' }] },
      { id: 'd2', site_id: 's2', device_uid: 'GG-DEMO-0002', lifecycle_status: 'active', created_at: iso(now0 - 8e8), device_status: { last_seen_at: iso(now0 - 7200e3), gas_ppm: 2400, data_classification: 'DEVICE_DATA' }, sensors: [{ sensor_uid: 'MQ6-01' }] }],
    alert_episodes: [{ id: 'e1', site_id: 's2', level: 'warning', peak_ppm: 2400, started_at: iso(now0 - 900e3) }],
    telemetry_hourly: hourly,
    sensor_calibrations: [],
    installation_jobs: [job],
    job_assignments: [{ assignment_status: 'assigned', assigned_at: iso(now0 - 3600e3), installation_jobs: job }]
  };
  const singles = {
    site_memberships: pick.membership ? { membership_type: pick.membership, alert_min_level: 'watch' } : null,
    site_settings: { hose_installed_on: '2023-05-01', sensor_checked_on: null },
    profiles: { display_name: pick.name },
    alert_episodes: null, user_line_links: null, floor_plans: null
  };
  const members = [
    { user_id: 'u1', membership_type: 'owner', display_name: 'คุณสมชาย', email: 'owner@trial.gasguard', alert_min_level: 'watch', line_linked: true },
    { user_id: 'u2', membership_type: 'member', display_name: 'แม่', email: 'member@trial.gasguard', alert_min_level: 'warning', line_linked: false }
  ].map(m => ({ ...m, is_me: m.user_id === pick.user }));
  const rpcData = {
    can_edit_site: pick.membership !== 'member',
    site_members: members,
    create_line_link_code: '482913',
    create_site_invitation: true,
    invitation_info: { valid: false, status: 'not_found' }
  };
  const builder = table => {
    let single = false;
    const b = {};
    ['select', 'eq', 'neq', 'gte', 'lte', 'in', 'is', 'order', 'limit', 'insert', 'update', 'upsert', 'delete'].forEach(m => { b[m] = () => b; });
    b.maybeSingle = () => { single = true; return b; };
    b.single = () => { single = true; return b; };
    b.then = (res, rej) => Promise.resolve(single ? { data: table in singles ? singles[table] : { id: 'trial' }, error: null } : { data: lists[table] || [], error: null }).then(res, rej);
    return b;
  };
  const db = { from: builder, rpc: name => ({ then: (res, rej) => Promise.resolve({ data: rpcData[name] ?? null, error: null }).then(res, rej) }) };

  window.GasGuardAuth = {
    initialize: async () => ({ user, access_token: 'trial' }),
    getSession: async () => ({ user, access_token: 'trial' }),
    roleFromUser: u => (u && u.app_metadata ? u.app_metadata.role : 'general'),
    loginErrorMessage: () => 'โหมดทดลองใช้',
    signIn: async () => ({ session: { user, access_token: 'trial' } }),
    signOut: async () => { location.href = '/'; },
    getClient: () => db
  };

  // ---- Fake API ------------------------------------------------------------------------------------
  // Live readings for the last hour; "จำลองแก๊สรั่ว" ramps sensor A to danger in about a minute.
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
      history.push({ sensorId: 'MQ6-01', sensorType: 'MQ6', rawAdc: Math.round(700 + a / 4), sensorVoltage: 1.1, gasPpm: Math.round(a), calibrationStatus: 'CALIBRATED', receivedAt: iso(t) });
      history.push({ sensorId: 'MQ2-01', sensorType: 'MQ2', rawAdc: Math.round(500 + b / 4), sensorVoltage: 0.8, gasPpm: Math.round(b), calibrationStatus: 'CALIBRATED', receivedAt: iso(t) });
    }
    const latest = {};
    history.forEach(r => { latest[r.sensorId] = r; });
    return { deviceId: 'GG-DEMO-0001', dataClassification: 'DEVICE_DATA', connection: 'ONLINE', lastTelemetry: history[history.length - 1].receivedAt, sensorLatest: latest, history };
  }
  const api = {
    '/api/v1/config': () => ({ line: { configured: true, addFriendUrl: null }, ai: { configured: false } }),
    '/api/v1/device/status': status,
    '/api/v1/site/summary': () => ({ ok: true, summary: 'สัปดาห์นี้ค่าแก๊สส่วนใหญ่อยู่ระดับปกติ มีช่วงที่สูงขึ้นถึงระดับเฝ้าระวัง 2 ครั้ง (สูงสุด 1,250 ppm) แนะนำให้ตรวจข้อต่อและวาล์วที่ถังแก๊ส', source: 'template', created_at: new Date().toISOString() }),
    '/api/v1/admin/users': () => ({ ok: true, users: Object.entries(ROLES).map(([k, r]) => ({ id: r.user, email: `${k}@trial.gasguard`, role: r.role, displayName: r.name, createdAt: iso(now0 - 20 * 86400e3), lastSignInAt: iso(now0 - 3600e3) })) })
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
      el.innerHTML = `<span><strong>โหมดทดลองใช้</strong> · ${pick.label} · ข้อมูลจำลอง ไม่บันทึกจริง</span>
        <span class="trial-bar-actions"><button type="button" data-trial="leak">${trial.leakAt ? 'หยุดแก๊สรั่ว' : 'จำลองแก๊สรั่ว'}</button><a href="/#trial">เปลี่ยนบทบาท</a></span>`;
    };
    draw();
    el.addEventListener('click', evt => {
      const b = evt.target.closest('[data-trial="leak"]');
      if (!b) return;
      trial.leakAt = trial.leakAt ? null : Date.now();
      draw();
    });
    document.body.prepend(el);
    document.body.classList.add('is-trial');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bar); else bar();
}());
