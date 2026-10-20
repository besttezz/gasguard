(function () {
  'use strict';

  // GasGuard owner app: sign-in, then four tabs (home, floor plan, history, my home) for one site.
  // Live data comes from /api/v1/device/status (polled every 5 s with the user's token); the floor plan,
  // hourly history and members are read through Supabase with RLS. Demo mode replaces live data with
  // simulated readings every 10 s and is always labelled as such.
  const L = window.GasGuardSafetyLogic;
  const FP = window.GasGuardFloorPlan;
  const Auth = window.GasGuardAuth;

  const storage = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const alarm = window.GasGuardAlarm.create(storage);
  const params = new URLSearchParams(location.search);
  const WORKSPACES = { 'hardware-pilot': 'ESP32-KITCHEN-01', 'device-test': 'SIM-ESP32-KITCHEN-01' };
  const workspace = WORKSPACES[params.get('workspace')] ? params.get('workspace') : 'hardware-pilot';
  const DEVICE_UID = WORKSPACES[workspace];
  const POLL_MS = 5000;
  const TICK_MS = 10000;
  const SENSOR_NAMES = { 'MQ6-01': 'MQ-6', 'MQ2-01': 'MQ-2', 'MQ3-01': 'MQ-3' };
  const SERIES = { 'MQ6-01': '#1F5EFF', 'MQ2-01': '#0F766E', 'MQ3-01': '#7C3AED' };
  const TABS = { home: 'หน้าหลัก', plan: 'แปลนบ้าน', history: 'ประวัติ', mine: 'บ้านของฉัน' };
  const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', technician: 'ช่าง', developer: 'นักพัฒนา', general: 'ผู้ใช้' };
  const ICON = {
    safe: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    alert: '<svg viewBox="0 0 24 24"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>',
    unknown: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.8v.4"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
  };

  const S = {
    user: null, role: 'general', real: null, offlineApi: false, site: null, device: null, canEdit: false,
    members: null, sim: null, simTimer: null, scenario: 'cycle', tab: 'home', range: '1h',
    hourly: null, hourlyKey: '', hourlyLoading: false, planCtl: null, alarmTest: false, pollTimer: null, alarmWasHidden: true
  };

  const $ = sel => document.querySelector(sel);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmtPpm = v => (v == null ? '—' : v < 10 ? Number(v).toFixed(1) : Math.round(v).toLocaleString('th-TH'));
  const fmtLel = v => (v == null ? '—' : `${v < 1 ? v.toFixed(2) : v.toFixed(1)}%`);
  const clock = ms => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const dayClock = ms => new Date(ms).toLocaleString('th-TH', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const sensorName = id => SENSOR_NAMES[id] || id;
  const planKey = () => `gasguard.floorplan.v1:${S.site ? S.site.id : workspace}`;

  function ago(iso) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return 'ยังไม่มีข้อมูล';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return `${s} วินาทีที่แล้ว`;
    if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
    return dayClock(ms);
  }

  // Live views refresh every few seconds; only touch the DOM when the markup changed so a tap in progress is not lost.
  function setHtml(el, html) {
    if (el.__html === html) return false;
    el.__html = html;
    el.innerHTML = html;
    return true;
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  // ---- Data -------------------------------------------------------------------------------------
  function shown() {
    if (S.sim) return S.sim;
    if (S.real) return S.offlineApi ? { ...S.real, connection: S.real.history && S.real.history.length ? S.real.connection : 'WAITING_FOR_DEVICE', ingress: 'UNAVAILABLE' } : S.real;
    return { connection: 'WAITING_FOR_DEVICE', history: [], sensorLatest: {}, ingress: S.offlineApi ? 'UNAVAILABLE' : 'READY' };
  }

  async function poll() {
    const token = (await Auth.getSession().catch(() => null))?.access_token;
    if (!token) return;
    try {
      const response = await fetch(`/api/v1/device/status?workspace=${encodeURIComponent(workspace)}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`status ${response.status}`);
      S.real = await response.json();
      S.offlineApi = false;
    } catch (error) {
      S.offlineApi = true;
    }
    render();
  }

  async function loadSite() {
    const db = Auth.getClient();
    if (!db) return;
    try {
      const { data, error } = await db.from('devices').select('id, site_id, device_uid, sites(name)').eq('device_uid', DEVICE_UID).maybeSingle();
      if (error) throw error;
      if (data) {
        S.device = { id: data.id, uid: data.device_uid };
        S.site = { id: data.site_id, name: (data.sites && data.sites.name) || 'บ้านของฉัน' };
      }
    } catch (error) { /* the plan still works locally without a site */ }
    if (S.site) {
      const edit = await db.rpc('can_edit_site', { p_site_id: S.site.id }).catch(error => ({ error }));
      S.canEdit = edit && !edit.error ? edit.data === true : S.role === 'admin';
      loadMembers();
    } else {
      S.canEdit = S.role === 'admin';
    }
    mountPlan();
    render();
  }

  async function loadMembers() {
    const db = Auth.getClient();
    const { data, error } = await db.rpc('site_members', { p_site_id: S.site.id }).catch(e => ({ error: e }));
    S.members = error ? [{ user_id: S.user.id, membership_type: S.canEdit ? 'owner' : 'member', display_name: null, email: S.user.email, is_me: true }] : data;
    if (S.tab === 'mine') renderMine();
  }

  async function loadHourly() {
    if (!S.device || S.sim) return;
    const hours = S.range === '24h' ? 24 : 168;
    const key = `${S.range}:${Math.floor(Date.now() / 300000)}`;
    if (S.hourlyKey === key || S.hourlyLoading) return;
    S.hourlyLoading = true;
    const since = new Date(Date.now() - hours * 3600e3).toISOString();
    try {
      const { data, error } = await Auth.getClient().from('telemetry_hourly')
        .select('hour, sensor_uid, max_gas_ppm, avg_gas_ppm, reading_count, data_classification')
        .eq('device_id', S.device.id).neq('data_classification', 'SYNTHETIC_HANDSHAKE').gte('hour', since).order('hour', { ascending: true });
      if (error) throw error;
      S.hourly = data || [];
      S.hourlyKey = key;
    } catch (error) {
      S.hourly = null;
      toast('โหลดประวัติย้อนหลังไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
    S.hourlyLoading = false;
    if (S.tab === 'history') renderHistory();
  }

  // ---- Demo mode ---------------------------------------------------------------------------------
  function startDemo(scenario) {
    stopDemo();
    S.scenario = scenario || S.scenario;
    const sensors = ['MQ6-01', 'MQ2-01'];
    const sim = L.createSimulator({ scenario: S.scenario, sensors });
    const now = Date.now();
    const seed = [30, 20, 10].flatMap(s => sensors.map((id, i) => ({ sensorId: id, gasPpm: i ? 95 : 150, rawAdc: null, calibrationStatus: 'SIMULATED', receivedAt: new Date(now - s * 1000).toISOString() })));
    S.sim = { connection: 'ONLINE', dataClassification: 'SIMULATION', deviceId: DEVICE_UID, history: seed, sensorLatest: {}, lastTelemetry: seed[seed.length - 1].receivedAt, engine: sim };
    seed.forEach(r => { S.sim.sensorLatest[r.sensorId] = r; });
    const tick = () => {
      const t = Date.now();
      const readings = S.sim.engine.tick(t);
      S.sim.history = S.sim.history.filter(r => t - Date.parse(r.receivedAt) < 3600e3).concat(readings);
      readings.forEach(r => { S.sim.sensorLatest[r.sensorId] = r; });
      S.sim.lastTelemetry = readings[0].receivedAt;
      render();
    };
    tick();
    S.simTimer = setInterval(tick, TICK_MS);
  }
  function stopDemo() {
    if (S.simTimer) clearInterval(S.simTimer);
    S.simTimer = null; S.sim = null;
  }

  // ---- Shared bits --------------------------------------------------------------------------------
  function unknownReason(st) {
    if (st.ingress === 'UNAVAILABLE') return 'เชื่อมต่อระบบไม่ได้ กำลังลองใหม่อัตโนมัติ';
    if (st.connection === 'WAITING_FOR_DEVICE') return 'ยังไม่เคยได้รับข้อมูลจากบอร์ด ตรวจว่าบอร์ดเปิดอยู่และต่อ Wi-Fi แล้ว';
    if (st.connection === 'OFFLINE') return `บอร์ดไม่ได้ส่งข้อมูลเกิน 30 วินาที (ล่าสุด ${ago(st.lastTelemetry)}) ตรวจไฟและ Wi-Fi ของบอร์ด`;
    return 'บอร์ดส่งค่าดิบมา แต่ยังไม่มีค่า ppm ที่คาลิเบรตแล้ว';
  }

  function readingsMap(a) {
    const map = {};
    a.sensors.forEach(s => { map[s.id] = { ppm: s.ppm, level: s.level }; });
    return map;
  }

  function pinLabels() {
    const plan = S.planCtl ? S.planCtl.plan() : FP.loadPlan(planKey());
    const labels = {};
    plan.pins.filter(p => p.type === 'sensor' && p.sensorId).forEach(p => { labels[p.sensorId] = p.label; });
    return labels;
  }

  function sensorRows(a) {
    if (!a.sensors.length) return '<p class="empty">ยังไม่มีข้อมูลจากเซ็นเซอร์</p>';
    const labels = pinLabels();
    return a.sensors.map(s => `<div class="row">
        <span class="badge" style="background:${s.level.color}">${esc(labels[s.id] || sensorName(s.id).slice(-1))}</span>
        <div class="row-main"><strong>${esc(sensorName(s.id))}${labels[s.id] ? ` · จุด ${esc(labels[s.id])}` : ''}</strong><small class="${s.health.ok ? '' : 'is-bad'}">${esc(s.health.label)}</small></div>
        <div class="row-side"><strong>${s.ppm == null ? '—' : `${fmtPpm(s.ppm)} ppm`}</strong><small>${esc(s.level.rank >= 0 ? s.level.label : 'ไม่มีข้อมูล')} · ${esc(s.trend.label)}</small></div>
      </div>`).join('');
  }

  function legendHtml() {
    const T = L.THRESHOLDS, V = L.LEVELS;
    return [[V.safe, `ต่ำกว่า ${T.watch.toLocaleString()}`], [V.watch, `${T.watch.toLocaleString()}–${(T.warning - 1).toLocaleString()}`],
      [V.warning, `${T.warning.toLocaleString()}–${(T.danger - 1).toLocaleString()}`], [V.danger, `ตั้งแต่ ${T.danger.toLocaleString()}`]]
      .map(([lv, range]) => `<span><i style="background:${lv.color}"></i><b>${esc(lv.label)}</b> ${range} ppm</span>`).join('');
  }

  // ---- Render ------------------------------------------------------------------------------------
  function render() {
    if (!S.user) return;
    const st = shown();
    const a = L.assess(st, Date.now());
    alarm.update(a.level);
    renderTopbar(st);
    renderAlarm(a);
    if (S.planCtl) S.planCtl.update(readingsMap(a));
    if (S.tab === 'home') renderHome(st, a);
    if (S.tab === 'plan') setHtml($('#plan-sensors'), sensorRows(a));
    if (S.tab === 'history' && S.range === '1h') renderHistory();
  }

  function renderTopbar(st) {
    $('#site-name').textContent = S.site ? S.site.name : 'บ้านของฉัน';
    $('#page-title').textContent = TABS[S.tab];
    const pill = $('#conn-pill');
    const [cls, text] = S.sim ? ['is-demo', 'โหมดสาธิต']
      : st.ingress === 'UNAVAILABLE' ? ['is-offline', 'เชื่อมต่อระบบไม่ได้']
      : st.connection === 'ONLINE' ? ['is-online', 'บอร์ดออนไลน์']
      : st.connection === 'OFFLINE' ? ['is-offline', 'บอร์ดออฟไลน์'] : ['', 'รอข้อมูลจากบอร์ด'];
    pill.className = `pill ${cls}`;
    pill.lastElementChild.textContent = text;
    $('#demo-banner').hidden = !S.sim;
  }

  function renderHome(st, a) {
    const lv = a.level, w = a.worst;
    const known = lv.rank >= 0;
    const icon = !known ? ICON.unknown : lv.key === 'safe' ? ICON.safe : ICON.alert;
    const sound = !alarm.wantsSound()
      ? `<button class="btn btn-small" type="button" data-action="sound-on">${ICON.bell} เปิดเสียงเตือน</button>`
      : !alarm.soundOn() ? '<button class="btn btn-small" type="button" data-action="sound-on">แตะเพื่อเปิดเสียงเตือน</button>'
      : '<span class="tag is-ok">เสียงเตือนเปิดอยู่</span>';
    const ack = alarm.alarming() ? '<button class="btn btn-small" type="button" data-action="ack">รับทราบ / ปิดเสียง</button>' : '';
    const stats = known && w ? `<div class="stats">
        <div class="stat"><span>สูงสุด</span><strong>${fmtPpm(w.ppm)}</strong><small>ppm · ${esc(sensorName(w.id))}</small></div>
        <div class="stat"><span>ของจุดติดไฟ</span><strong>${fmtLel(w.lel)}</strong><small>LEL</small></div>
        <div class="stat"><span>แนวโน้ม</span><strong style="font-size:14px">${esc(w.trend.label)}</strong><small>${w.escalated ? 'เตือนล่วงหน้า' : '&nbsp;'}</small></div>
      </div>` : `<p class="muted">${esc(unknownReason(st))}</p>`;
    const plan = S.planCtl ? S.planCtl.plan() : FP.loadPlan(planKey());
    const thumb = FP.stageSvg(plan, readingsMap(a));
    const sensorsCount = Object.keys(st.sensorLatest || {}).length;

    setHtml($('#view-home'), `<div class="home-grid">
      <div class="view">
        <section class="hero is-${lv.key}" aria-live="polite">
          <div class="hero-top"><span class="hero-badge" aria-hidden="true">${icon}</span><div><p class="hero-kicker">สถานะตอนนี้</p><h2>${esc(lv.label)}</h2></div></div>
          <p class="hero-head">${esc(lv.headline)}</p>
          ${stats}
          <ol class="steps">${lv.actions.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
          <p class="muted">อัปเดต <span data-updated></span> · เซ็นเซอร์ ${sensorsCount} จุด${S.sim ? ' · ค่าจำลอง' : ''}</p>
          <div class="hero-foot">${sound}${ack}</div>
        </section>
        <section class="card">
          <div class="card-head"><h2>ตรวจก่อนจุดเตา</h2><span class="tag ${a.readyToCook ? 'is-ok' : 'is-no'}">${a.readyToCook ? 'พร้อมใช้งาน' : 'ยังไม่ควรจุดเตา'}</span></div>
          <ul class="checks">${a.checks.map(c => `<li class="${c.ok ? 'is-ok' : 'is-no'}"><span aria-hidden="true">${c.ok ? '✓' : '✕'}</span>${esc(c.label)}</li>`).join('')}</ul>
        </section>
      </div>
      <div class="view">
        <a class="card plan-card" href="#plan"><span class="plan-thumb" aria-hidden="true">${thumb}</span><span class="row-main"><strong>แปลนบ้าน</strong><small>ดูว่าแก๊สสะสมตรงไหนของห้อง</small></span>${ICON.chevron}</a>
        <section class="card list">${sensorRows(a)}</section>
        <div class="actions">
          <a class="btn btn-danger" href="tel:199">${ICON.phone} โทรดับเพลิง 199</a>
          <button class="btn" type="button" data-action="test-alarm">${ICON.bell} ทดสอบเสียงเตือน</button>
        </div>
      </div>
    </div>`);
    const updated = $('#view-home [data-updated]');
    if (updated) updated.textContent = ago(st.lastTelemetry);
  }

  function renderAlarm(a) {
    const el = $('#alarm');
    const live = alarm.alarming() && (a.level.key === 'danger' || a.level.key === 'warning');
    if (!S.alarmTest && !live) { el.hidden = true; S.alarmWasHidden = true; return; }
    const lv = S.alarmTest ? L.LEVELS.danger : a.level;
    const w = a.worst;
    const sub = S.alarmTest ? 'นี่คือการทดสอบเสียงและหน้าจอเตือน ไม่ได้มีแก๊สรั่วจริง'
      : w ? `วัดได้ ${fmtPpm(w.ppm)} ppm (${fmtLel(w.lel)} ของจุดติดไฟ) · ${w.trend.label}` : '';
    el.className = `alarm${lv.key === 'warning' ? ' is-warning' : ''}`;
    el.innerHTML = `<div class="alarm-inner" role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
      <div class="alarm-meta"><span>${esc(S.site ? S.site.name : 'บ้านของฉัน')}${w && !S.alarmTest ? ` · ${esc(sensorName(w.id))}` : ''}</span><span>${S.sim ? 'โหมดสาธิต' : 'ตอนนี้'}</span></div>
      ${S.alarmTest ? '<span class="alarm-test">ทดสอบ</span>' : ''}
      <span class="alarm-icon" aria-hidden="true">${ICON.alert}</span>
      <h2 id="alarm-title">${esc(lv.label)}</h2>
      <p class="alarm-head">${esc(lv.headline)}</p>
      <p class="alarm-sub">${esc(sub)}</p>
      <ol class="steps">${lv.actions.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      <div class="alarm-buttons"><a class="alarm-call" href="tel:199">โทรดับเพลิง 199</a><button class="alarm-ack" type="button" data-action="ack">รับทราบ / ปิดเสียง</button></div>
    </div>`;
    el.hidden = false;
    if (S.alarmWasHidden) { S.alarmWasHidden = false; const b = el.querySelector('[data-action="ack"]'); if (b) b.focus(); }
  }

  // ---- History -------------------------------------------------------------------------------------
  function levelEvents(history) {
    const rows = history.filter(r => Number.isFinite(Date.parse(r.receivedAt))).slice().sort((p, q) => Date.parse(p.receivedAt) - Date.parse(q.receivedAt));
    const latest = {}, events = [];
    let level = null, prevAt = null;
    for (const r of rows) {
      const t = Date.parse(r.receivedAt);
      if (prevAt != null && t - prevAt > 60e3) events.push({ at: prevAt, color: L.LEVELS.unknown.color, title: 'บอร์ดขาดการติดต่อ', detail: `ไม่มีข้อมูล ${Math.round((t - prevAt) / 60e3)} นาที` });
      prevAt = t;
      if (r.gasPpm == null) continue;
      latest[r.sensorId] = Number(r.gasPpm);
      const max = Math.max(...Object.values(latest));
      const next = L.classify(max);
      if (level && next.key !== level.key) events.push({ at: t, color: next.color, title: `${level.label} → ${next.label}`, detail: `${fmtPpm(max)} ppm` });
      level = next;
    }
    return events.reverse();
  }

  function hourlyBuckets(rows) {
    const byHour = new Map();
    for (const r of rows) {
      const t = Date.parse(r.hour);
      const max = r.max_gas_ppm == null ? null : Number(r.max_gas_ppm);
      const cur = byHour.get(t) || { t, max: null, bySensor: {} };
      if (max != null) { cur.max = cur.max == null ? max : Math.max(cur.max, max); cur.bySensor[r.sensor_uid] = max; }
      byHour.set(t, cur);
    }
    return [...byHour.values()].sort((p, q) => p.t - q.t);
  }

  function chartSvg(series, from, to, gapMs) {
    const W = 680, H = 230, Lm = 46, R = 12, T = 12, B = 26;
    const values = series.flatMap(s => s.points.map(p => p.v)).filter(Number.isFinite);
    if (!values.length) return '<p class="empty">ยังไม่มีข้อมูลในช่วงนี้</p>';
    const top = Math.max(100, Math.max(...values) * 1.25);
    const x = t => Lm + ((t - from) / (to - from)) * (W - Lm - R);
    const y = v => T + (1 - Math.min(v, top) / top) * (H - T - B);
    const Th = L.THRESHOLDS, V = L.LEVELS;
    const bands = [[0, Th.watch, '#E8F6EE'], [Th.watch, Th.warning, '#FFF6DB'], [Th.warning, Th.danger, '#FFEDDF'], [Th.danger, Infinity, '#FDE8E8']]
      .filter(([lo]) => lo < top).map(([lo, hi, c]) => `<rect x="${Lm}" y="${y(Math.min(hi, top)).toFixed(1)}" width="${W - Lm - R}" height="${(y(lo) - y(Math.min(hi, top))).toFixed(1)}" fill="${c}"/>`).join('');
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => { const v = top * f; return `<text x="${Lm - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${fmtPpm(v)}</text>`; }).join('');
    const span = to - from;
    const xt = [0, 0.5, 1].map(f => { const t = from + span * f; return `<text x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${f === 1 ? 'ตอนนี้' : span > 26 * 3600e3 ? dayClock(t) : clock(t)}</text>`; }).join('');
    const lines = series.map(s => {
      let d = '', prev = null;
      for (const p of s.points) { d += `${prev == null || p.t - prev > gapMs ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)} `; prev = p.t; }
      const last = s.points[s.points.length - 1];
      return `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${last ? `<circle cx="${x(last.t).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="3.5" fill="${s.color}"/>` : ''}`;
    }).join('');
    const legend = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
    return `<div class="legend">${legend}<span>หน่วย ppm · พื้นหลังคือระดับ ${esc(V.safe.label)} / ${esc(V.watch.label)} / ${esc(V.warning.label)} / ${esc(V.danger.label)}</span></div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟค่าแก๊สย้อนหลัง">${bands}${ticks}${xt}${lines}</svg>`;
  }

  function renderHistory() {
    const view = $('#view-history');
    const st = shown();
    const now = Date.now();
    const seg = ['1h', '24h', '7d'].map(r => `<button type="button" class="${S.range === r ? 'is-active' : ''}" data-range="${r}">${{ '1h': '1 ชั่วโมง', '24h': '24 ชั่วโมง', '7d': '7 วัน' }[r]}</button>`).join('');
    let chart = '', stats = '', events = [];
    if (S.range === '1h') {
      const hist = (st.history || []).filter(r => r.gasPpm != null && now - Date.parse(r.receivedAt) <= 3600e3);
      const ids = [...new Set(hist.map(r => r.sensorId))];
      const series = ids.map(id => ({ name: sensorName(id), color: SERIES[id] || '#475569', points: hist.filter(r => r.sensorId === id).map(r => ({ t: Date.parse(r.receivedAt), v: Number(r.gasPpm) })) }));
      chart = chartSvg(series, now - 3600e3, now, 60e3);
      const max = hist.length ? Math.max(...hist.map(r => Number(r.gasPpm))) : null;
      const above = new Set(hist.filter(r => Number(r.gasPpm) >= L.THRESHOLDS.watch).map(r => Math.floor(Date.parse(r.receivedAt) / 10e3))).size;
      events = levelEvents(st.history || []);
      stats = [['ค่าสูงสุด', max == null ? '—' : `${fmtPpm(max)} ppm`], ['เวลาที่เกินระดับปกติ', `${Math.round(above * 10 / 60)} นาที`], ['การเปลี่ยนระดับ', `${events.filter(e => e.title.includes('→')).length} ครั้ง`]];
    } else if (S.sim) {
      chart = '<p class="empty">โหมดสาธิตมีข้อมูลเฉพาะ 1 ชั่วโมงล่าสุด</p>';
    } else if (!S.device) {
      chart = '<p class="empty">ยังไม่พบอุปกรณ์ของบ้านนี้</p>';
    } else if (!S.hourly || !S.hourlyKey.startsWith(S.range)) {
      chart = '<p class="empty">กำลังโหลดประวัติ…</p>';
      loadHourly();
    } else {
      const hours = S.range === '24h' ? 24 : 168;
      const buckets = hourlyBuckets(S.hourly);
      const ids = [...new Set(S.hourly.map(r => r.sensor_uid))];
      const series = ids.map(id => ({ name: `${sensorName(id)} (สูงสุดรายชั่วโมง)`, color: SERIES[id] || '#475569',
        points: buckets.filter(b => b.bySensor[id] != null).map(b => ({ t: b.t + 1800e3, v: b.bySensor[id] })) }));
      chart = chartSvg(series, now - hours * 3600e3, now, 2 * 3600e3);
      const max = buckets.length ? Math.max(...buckets.map(b => b.max || 0)) : null;
      const hot = buckets.filter(b => b.max != null && b.max >= L.THRESHOLDS.watch);
      events = hot.slice().reverse().map(b => { const lv = L.classify(b.max); return { at: b.t, color: lv.color, title: `ช่วง ${dayClock(b.t)} ถึงระดับ${lv.label}`, detail: `ค่าสูงสุด ${fmtPpm(b.max)} ppm` }; });
      stats = [['ค่าสูงสุด', max == null ? '—' : `${fmtPpm(max)} ppm`], ['ชั่วโมงที่เกินระดับปกติ', `${hot.length} ชั่วโมง`], ['ชั่วโมงที่มีข้อมูล', `${buckets.length} / ${hours}`]];
    }
    const statsHtml = stats ? `<div class="stats">${stats.map(([k, v]) => `<div class="stat" style="background:var(--surface-soft)"><span>${k}</span><strong style="font-size:16px">${v}</strong></div>`).join('')}</div>` : '';
    const list = events.length ? events.slice(0, 20).map(e => `<div class="row"><span class="dot" style="background:${e.color}"></span><div class="row-main"><strong>${esc(e.title)}</strong><small>${esc(e.detail)}</small></div><div class="row-side"><small>${esc(S.range === '1h' ? clock(e.at) : dayClock(e.at))}</small></div></div>`).join('')
      : '<p class="empty">ไม่มีเหตุการณ์ผิดปกติในช่วงนี้</p>';
    setHtml(view, `<div class="segment" role="group" aria-label="ช่วงเวลา">${seg}</div>
      <section class="card">${statsHtml}<div style="margin-top:12px">${chart}</div></section>
      <section class="card list"><div class="card-head" style="margin:10px 0 0"><h2>เหตุการณ์</h2></div>${list}</section>`);
  }

  // ---- My home -------------------------------------------------------------------------------------
  function renderMine() {
    const st = shown();
    const members = (S.members || []).map(m => {
      const name = m.display_name || m.email || 'สมาชิก';
      return `<div class="row"><span class="avatar" aria-hidden="true">${esc(name.trim().charAt(0).toUpperCase())}</span><div class="row-main"><strong>${esc(name)}${m.is_me ? ' (คุณ)' : ''}</strong><small>${m.membership_type === 'owner' ? 'เจ้าของ · จัดการแปลนและสมาชิก' : 'สมาชิก · ดูสถานะและรับแจ้งเตือน'}</small></div></div>`;
    }).join('') || '<p class="empty">กำลังโหลดรายชื่อ…</p>';
    const notif = alarm.notificationState();
    const notifCtl = notif === 'granted' ? '<span class="tag is-ok">อนุญาตแล้ว</span>'
      : notif === 'denied' ? '<span class="tag is-no">ถูกปิดในเบราว์เซอร์</span>'
      : notif === 'unsupported' ? '<span class="tag is-off">เครื่องนี้ไม่รองรับ</span>'
      : '<button class="btn btn-small" type="button" data-action="notify">อนุญาต</button>';
    const scenarios = Object.entries(L.SCENARIOS).map(([k, v]) => `<option value="${k}"${k === S.scenario ? ' selected' : ''}>${esc(v)}</option>`).join('');
    const sensors = Object.keys(st.sensorLatest || {}).map(sensorName).join(' + ') || 'ยังไม่มีข้อมูล';
    $('#view-mine').innerHTML = `
      <section class="card">
        <div class="card-head"><h2>อุปกรณ์</h2><span class="tag ${st.connection === 'ONLINE' ? 'is-ok' : 'is-off'}">${S.sim ? 'โหมดสาธิต' : st.connection === 'ONLINE' ? 'ออนไลน์' : st.connection === 'OFFLINE' ? 'ออฟไลน์' : 'รอข้อมูล'}</span></div>
        <div class="row"><div class="row-main"><strong>${esc(DEVICE_UID)}</strong><small>ESP32 · ${esc(sensors)} · ส่งข้อมูลทุก 10 วินาที</small></div><div class="row-side"><small>ล่าสุด ${esc(ago(st.lastTelemetry))}</small></div></div>
        <p class="muted small">สายแก๊สควรเปลี่ยนทุก 2–3 ปี และควรตรวจเทียบค่าเซ็นเซอร์ MQ ทุก 6 เดือน</p>
      </section>
      <section class="card list">
        <div class="card-head" style="margin:10px 0 0"><h2>คนในบ้าน</h2></div>
        ${members}
        <div class="row"><div class="row-main"><strong>เชิญคนในบ้าน / พนักงาน</strong><small>เร็ว ๆ นี้ · ตอนนี้ให้ผู้ดูแลระบบเพิ่มสมาชิกให้</small></div><span class="tag is-off">เร็ว ๆ นี้</span></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>การแจ้งเตือนบนเครื่องนี้</h2></div>
        <label class="switch-row"><span class="row-main"><strong>เสียงเตือน</strong><small>เหลือง: เสียงเบา · ส้ม: บี๊บซ้ำ · แดง: ไซเรนจนกว่าจะกดรับทราบ</small></span><input type="checkbox" data-action="sound-toggle"${alarm.wantsSound() ? ' checked' : ''}></label>
        <div class="switch-row"><span class="row-main"><strong>แจ้งเตือนบนหน้าจอ</strong><small>ขึ้นข้อความเมื่อระดับสูงขึ้น ขณะเปิดแอปไว้</small></span>${notifCtl}</div>
        <div class="switch-row"><span class="row-main"><strong>สั่น</strong><small>ใช้ได้บนมือถือ Android · iPhone ไม่รองรับจากเว็บ</small></span><span class="tag is-info">อัตโนมัติ</span></div>
        <div class="switch-row"><span class="row-main"><strong>LINE</strong><small>ส่งข้อความถึงทุกคนในบ้านแม้ไม่ได้เปิดแอป</small></span><span class="tag is-off">เร็ว ๆ นี้</span></div>
        <div style="margin-top:12px"><button class="btn" type="button" data-action="test-alarm">${ICON.bell} ทดสอบเสียงเตือน</button></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>โหมดสาธิต</h2></div>
        <label class="switch-row"><span class="row-main"><strong>ใช้ค่าจำลองแทนบอร์ดจริง</strong><small>ค่าเปลี่ยนทุก 10 วินาที ไว้นำเสนอการเปลี่ยนสีและการแจ้งเตือน</small></span><input type="checkbox" data-action="demo-toggle"${S.sim ? ' checked' : ''}></label>
        <label class="field" style="margin-top:10px"><span>สถานการณ์</span><select data-action="scenario">${scenarios}</select></label>
      </section>
      <section class="card">
        <div class="card-head"><h2>เกณฑ์ระดับแก๊ส</h2><span class="tag is-off">ร่าง รอทีมยืนยัน</span></div>
        <div class="legend">${legendHtml()}</div>
        <p class="muted small">5 / 10 / 20% ของจุดติดไฟต่ำสุด (LEL) ของ LPG ที่ 18,000 ppm</p>
      </section>
      <section class="card">
        <div class="card-head"><h2>บัญชี</h2></div>
        <div class="row"><div class="row-main"><strong>${esc(S.user.email || '')}</strong><small>${esc(ROLE_LABEL[S.role] || 'ผู้ใช้')}${S.canEdit ? ' · แก้ไขแปลนได้' : ''}</small></div><button class="btn btn-small" type="button" data-action="sign-out">ออกจากระบบ</button></div>
      </section>`;
  }

  // ---- Floor plan --------------------------------------------------------------------------------
  function mountPlan() {
    if (S.planCtl) return;
    const db = Auth.getClient();
    const store = S.site && db ? {
      load: async () => {
        const { data, error } = await db.from('floor_plans').select('plan').eq('site_id', S.site.id).maybeSingle();
        if (error) throw error;
        return data ? data.plan : null;
      },
      save: async plan => {
        if (!S.canEdit) return false;
        const { error } = await db.from('floor_plans').upsert({ site_id: S.site.id, plan, updated_by: S.user.id });
        return !error;
      }
    } : null;
    S.planCtl = FP.mount($('#plan-mount'), {
      storageKey: planKey(),
      store,
      readOnly: !S.canEdit,
      sensorOptions: () => Object.keys(SENSOR_NAMES).map(id => ({ id, name: `${SENSOR_NAMES[id]} (${id})` })),
      onChange: () => { if (S.tab === 'home') render(); }
    });
    $('#plan-legend').innerHTML = legendHtml();
  }

  // ---- Navigation ----------------------------------------------------------------------------------
  function setTab(tab) {
    S.tab = TABS[tab] ? tab : 'home';
    document.querySelectorAll('.tab').forEach(a => {
      const on = a.dataset.tab === S.tab;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view[data-view]').forEach(v => { v.hidden = v.dataset.view !== S.tab; });
    if (S.tab === 'history') renderHistory();
    if (S.tab === 'mine') renderMine();
    render();
    window.scrollTo(0, 0);
  }

  // ---- Auth ---------------------------------------------------------------------------------------
  function showLanding(message) {
    S.user = null;
    clearInterval(S.pollTimer); S.pollTimer = null;
    stopDemo(); alarm.stop();
    $('#boot').hidden = true; $('#app').hidden = true; $('#landing').hidden = false; $('#alarm').hidden = true;
    $('#login-error').textContent = message || '';
  }

  function enterApp(session) {
    S.user = session.user;
    S.role = Auth.roleFromUser(session.user) || 'general';
    $('#boot').hidden = true; $('#landing').hidden = true; $('#app').hidden = false;
    setTab((location.hash || '#home').slice(1));
    loadSite();
    poll();
    clearInterval(S.pollTimer);
    S.pollTimer = setInterval(poll, POLL_MS);
    if (params.get('demo') === '1') startDemo();
  }

  async function signOut() {
    try { await Auth.signOut(); } catch (e) { /* local session is cleared anyway */ }
    S.planCtl = null; $('#plan-mount').innerHTML = '';
    S.site = null; S.device = null; S.members = null; S.real = null; S.hourly = null; S.hourlyKey = '';
    showLanding();
  }

  // ---- Events --------------------------------------------------------------------------------------
  document.addEventListener('click', async evt => {
    const el = evt.target.closest('[data-action], [data-range]');
    if (!el) return;
    if (el.dataset.range) { S.range = el.dataset.range; renderHistory(); return; }
    const action = el.dataset.action;
    if (action === 'sound-on') { await alarm.enable(); setTimeout(render, 150); toast('เปิดเสียงเตือนแล้ว'); }
    else if (action === 'ack') { if (S.alarmTest) S.alarmTest = false; else alarm.acknowledge(); render(); }
    else if (action === 'test-alarm') { if (!alarm.wantsSound()) await alarm.enable(); alarm.test(); S.alarmTest = true; render(); }
    else if (action === 'demo-off') { stopDemo(); render(); if (S.tab === 'mine') renderMine(); }
    else if (action === 'notify') { await alarm.enable(); renderMine(); }
    else if (action === 'sign-out') signOut();
  });

  document.addEventListener('change', evt => {
    const el = evt.target;
    const action = el.dataset && el.dataset.action;
    if (action === 'sound-toggle') { if (el.checked) alarm.enable(); else alarm.disable(); setTimeout(render, 150); }
    else if (action === 'demo-toggle') { if (el.checked) startDemo(); else stopDemo(); render(); if (S.tab === 'history') renderHistory(); }
    else if (action === 'scenario') { S.scenario = el.value; if (S.sim) startDemo(el.value); }
  });

  window.addEventListener('hashchange', () => { if (S.user) setTab(location.hash.slice(1)); });
  document.addEventListener('pointerdown', () => alarm.resumeIfWanted(), { once: true });
  setInterval(() => { if (S.user && S.tab === 'home') render(); }, 15000); // keeps "updated x seconds ago" fresh

  $('#login-form').addEventListener('submit', async evt => {
    evt.preventDefault();
    const button = $('#login-submit');
    button.disabled = true; button.textContent = 'กำลังเข้าสู่ระบบ…';
    $('#login-error').textContent = '';
    try {
      const result = await Auth.signIn($('#login-email').value, $('#login-password').value);
      $('#login-password').value = '';
      if (!S.user) enterApp(result.session);
    } catch (error) {
      $('#login-error').textContent = Auth.loginErrorMessage(error);
    } finally {
      button.disabled = false; button.textContent = 'เข้าสู่ระบบ';
    }
  });

  (async function boot() {
    try {
      const session = await Auth.initialize((event, next) => { if (event === 'SIGNED_OUT' && S.user) showLanding(); else if (event === 'SIGNED_IN' && next && !S.user) enterApp(next); });
      if (session) enterApp(session); else showLanding();
    } catch (error) {
      showLanding(error && error.code === 'config_missing' ? 'ยังไม่ได้ตั้งค่าระบบยืนยันตัวตน (Supabase)' : Auth.loginErrorMessage(error));
    }
  }());
}());
