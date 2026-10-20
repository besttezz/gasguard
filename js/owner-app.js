(function () {
  'use strict';

  // GasGuard app core. Sign-in, the site being viewed, live polling, alarms and the home-owner tabs
  // (home, floor plan, history, my home). Technician and admin tabs come from js/tech-views.js and
  // js/admin-views.js, which receive the shared context built here.
  // Live data: /api/v1/device/status?device=<uid> every 5 s with the user's token. Everything else is read
  // and written through Supabase as the signed-in user, so row-level security decides what is allowed.
  const L = window.GasGuardSafetyLogic;
  const FP = window.GasGuardFloorPlan;
  const Auth = window.GasGuardAuth;

  const storage = (() => { try { return window.localStorage; } catch (e) { return null; } })();
  const store = {
    get: k => { try { return storage && storage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { storage && storage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  };
  const alarm = window.GasGuardAlarm.create(storage);
  const params = new URLSearchParams(location.search);
  const POLL_MS = 5000;
  const TICK_MS = 10000;
  const SENSOR_NAMES = { 'MQ6-01': 'MQ-6', 'MQ2-01': 'MQ-2', 'MQ3-01': 'MQ-3' };
  const SERIES = { 'MQ6-01': '#1F5EFF', 'MQ2-01': '#0F766E', 'MQ3-01': '#7C3AED' };
  const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', technician: 'ช่างติดตั้ง', developer: 'นักพัฒนา', general: 'ผู้ใช้' };
  const LEVEL_OPTIONS = [['watch', 'ตั้งแต่เฝ้าระวัง (เหลือง)'], ['warning', 'ตั้งแต่เตือน (ส้ม)'], ['danger', 'เฉพาะอันตราย (แดง)']];
  const SVG = (d, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    safe: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    alert: '<svg viewBox="0 0 24 24"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>',
    unknown: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 16.8v.4"/></svg>',
    phone: SVG('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 18),
    bell: SVG('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>', 18),
    chevron: SVG('<path d="M9 6l6 6-6 6"/>', 20),
    print: SVG('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>', 18),
    spark: SVG('<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/>', 18)
  };
  const TAB_DEFS = {
    home: { label: 'หน้าหลัก', icon: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
    plan: { label: 'แปลนบ้าน', icon: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>' },
    history: { label: 'ประวัติ', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
    mine: { label: 'บ้านของฉัน', icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>' },
    jobs: { label: 'งานของฉัน', icon: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 4V2h6v2M8 10h8M8 14h8M8 18h5"/>' },
    install: { label: 'ติดตั้ง', icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>' },
    overview: { label: 'ภาพรวม', icon: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>' },
    users: { label: 'ผู้ใช้', icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>' },
    work: { label: 'งานช่าง', icon: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>' }
  };
  const ROLE_TABS = {
    general: ['home', 'plan', 'history', 'mine'],
    developer: ['home', 'plan', 'history', 'mine'],
    technician: ['jobs', 'install', 'plan', 'mine'],
    admin: ['overview', 'users', 'work', 'home', 'plan', 'history', 'mine']
  };

  const S = {
    user: null, role: 'general', profileName: null, sites: [], site: null, devices: [], device: null, membership: null, canEdit: false,
    real: null, offlineApi: false, members: null, settings: null, episode: null, config: null, lineLinked: null, lineCode: null,
    summary: null, summaryLoading: false, sim: null, simTimer: null, scenario: 'cycle', tab: null, range: '1h',
    hourly: null, hourlyKey: '', hourlyLoading: false, planCtl: null, alarmTest: false, pollTimer: null, alarmWasHidden: true,
    invite: null, inviteToken: null, inviteForm: null, views: {}
  };

  const $ = sel => document.querySelector(sel);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmtPpm = v => (v == null ? '—' : v < 10 ? Number(v).toFixed(1) : Math.round(v).toLocaleString('th-TH'));
  const fmtLel = v => (v == null ? '—' : `${v < 1 ? v.toFixed(2) : v.toFixed(1)}%`);
  const clock = ms => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const dayClock = ms => new Date(ms).toLocaleString('th-TH', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const fullDate = ms => new Date(ms).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  const sensorName = id => SENSOR_NAMES[id] || id;
  const planKey = () => `gasguard.floorplan.v1:${S.site ? S.site.id : 'local'}`;
  const db = () => Auth.getClient();
  // Supabase query builders are thenables without .catch(); this turns any failure into { error }.
  const q = async builder => { try { return await builder; } catch (error) { return { data: null, error }; } };
  const randomHex = bytes => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

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
    if (!el || el.__html === html) return false;
    el.__html = html;
    el.innerHTML = html;
    return true;
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  async function api(path, init = {}) {
    const token = (await Auth.getSession().catch(() => null))?.access_token;
    const headers = { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) };
    const response = await fetch(path, { ...init, headers });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  }

  // ---- Sites, devices, live data -----------------------------------------------------------------
  function shown() {
    if (S.sim) return S.sim;
    if (!S.device) return { connection: 'NO_DEVICE', history: [], sensorLatest: {} };
    if (S.real) return S.offlineApi ? { ...S.real, ingress: 'UNAVAILABLE' } : S.real;
    return { connection: 'WAITING_FOR_DEVICE', history: [], sensorLatest: {}, ingress: S.offlineApi ? 'UNAVAILABLE' : 'READY' };
  }

  function assessNow() { return L.assess(shown(), Date.now()); }

  async function poll() {
    if (!S.user) return;
    if (S.device) {
      const r = await api(`/api/v1/device/status?device=${encodeURIComponent(S.device.uid)}`).catch(() => ({ ok: false }));
      if (r.ok) { S.real = r.body; S.offlineApi = false; } else S.offlineApi = true;
    }
    if (S.site) {
      const { data } = await q(db().from('alert_episodes').select('id, level, peak_level, peak_ppm, started_at, alert_acks(user_id, acked_at)').eq('site_id', S.site.id).is('ended_at', null).maybeSingle());
      S.episode = data || null;
    }
    render();
  }

  async function loadSites() {
    let sites = [];
    if (S.role === 'admin') {
      const { data } = await q(db().from('sites').select('id, name, address_text, lifecycle_status, customer_id').order('name'));
      sites = (data || []).map(s => ({ id: s.id, name: s.name, address: s.address_text }));
    } else if (S.role === 'technician') {
      sites = S.sites; // set by the job list
    } else {
      const { data } = await q(db().from('site_memberships').select('site_id, membership_type, alert_min_level, sites(id, name, address_text)').eq('user_id', S.user.id).eq('status', 'active'));
      sites = (data || []).filter(m => m.sites).map(m => ({ id: m.site_id, name: m.sites.name, address: m.sites.address_text }));
    }
    S.sites = sites;
    const saved = store.get('gasguard.site');
    const pick = sites.find(s => s.id === saved) || sites[0] || null;
    renderSiteSwitch();
    if (pick) await selectSite(pick.id, { quiet: true }); else render();
  }

  async function selectSite(siteId, opts = {}) {
    const site = S.sites.find(s => s.id === siteId) || opts.site || null;
    if (opts.site && !S.sites.some(s => s.id === opts.site.id)) S.sites.push(opts.site);
    S.site = site;
    if (site) store.set('gasguard.site', site.id);
    S.device = null; S.devices = []; S.real = null; S.members = null; S.settings = null; S.episode = null; S.membership = null;
    S.hourly = null; S.hourlyKey = ''; S.summary = null;
    if (S.planCtl) { S.planCtl = null; $('#plan-mount').innerHTML = ''; }
    $('#view-home').__html = null;
    renderSiteSwitch();
    if (!site) { render(); return; }
    const [devices, edit, membership, settings] = await Promise.all([
      q(db().from('devices').select('id, device_uid, lifecycle_status, created_at').eq('site_id', site.id).order('created_at')),
      q(db().rpc('can_edit_site', { p_site_id: site.id })),
      q(db().from('site_memberships').select('membership_type, alert_min_level').eq('site_id', site.id).eq('user_id', S.user.id).maybeSingle()),
      q(db().from('site_settings').select('hose_installed_on, sensor_checked_on, updated_at').eq('site_id', site.id).maybeSingle())
    ]);
    if (S.site !== site) return; // another site was picked meanwhile
    S.devices = devices.data || [];
    const active = S.devices.find(d => d.lifecycle_status !== 'retired') || S.devices[0];
    S.device = active ? { id: active.id, uid: active.device_uid } : null;
    S.canEdit = edit.error ? S.role === 'admin' : edit.data === true;
    S.membership = membership.data || null;
    S.settings = settings.data || null;
    mountPlan();
    loadMembers();
    poll();
    if (S.tab === 'mine') renderMine();
    if (S.tab === 'history') renderHistory();
    if (!opts.quiet && opts.tab) setTab(opts.tab); else render();
  }

  function renderSiteSwitch() {
    const wrap = $('#site-switch-wrap');
    const many = S.sites.length > 1 || (S.role === 'admin' && S.sites.length > 0);
    wrap.hidden = !many;
    $('#site-name').hidden = many;
    if (many) setHtml($('#site-switch'), S.sites.map(s => `<option value="${esc(s.id)}"${S.site && s.id === S.site.id ? ' selected' : ''}>${esc(s.name)}</option>`).join(''));
    $('#site-name').textContent = S.site ? S.site.name : (S.role === 'technician' ? 'งานติดตั้ง' : 'ยังไม่มีบ้านในบัญชีนี้');
  }

  async function loadMembers() {
    if (!S.site) return;
    const { data, error } = await q(db().rpc('site_members', { p_site_id: S.site.id }));
    S.members = error ? [] : (data || []);
    const me = S.members.find(m => m.is_me);
    if (me) S.lineLinked = me.line_linked;
    if (S.tab === 'mine') renderMine();
  }

  async function loadConfig() {
    const r = await api('/api/v1/config').catch(() => ({ ok: false }));
    S.config = r.ok ? r.body : { line: { configured: false }, ai: { configured: false } };
  }

  async function loadHourly() {
    if (!S.device || S.sim) return;
    const hours = S.range === '1h' ? 168 : S.range === '24h' ? 24 : 168;
    const key = `${S.range}:${S.device.id}:${Math.floor(Date.now() / 300000)}`;
    if (S.hourlyKey === key || S.hourlyLoading) return;
    S.hourlyLoading = true;
    const since = new Date(Date.now() - hours * 3600e3).toISOString();
    const { data, error } = await q(db().from('telemetry_hourly')
      .select('hour, sensor_uid, max_gas_ppm, avg_gas_ppm, reading_count, data_classification')
      .eq('device_id', S.device.id).neq('data_classification', 'SYNTHETIC_HANDSHAKE').gte('hour', since).order('hour', { ascending: true }));
    if (error) { S.hourly = null; toast('โหลดประวัติย้อนหลังไม่สำเร็จ ลองใหม่อีกครั้ง'); } else { S.hourly = data || []; S.hourlyKey = key; }
    S.hourlyLoading = false;
    if (S.tab === 'history') renderHistory();
  }

  async function loadSummary(refresh) {
    if (!S.site || S.summaryLoading) return;
    S.summaryLoading = true;
    if (S.tab === 'history') renderHistory();
    const r = await api('/api/v1/site/summary', { method: 'POST', body: JSON.stringify({ siteId: S.site.id, refresh: Boolean(refresh) }) }).catch(() => ({ ok: false }));
    S.summary = r.ok ? r.body : { error: true };
    S.summaryLoading = false;
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
    S.sim = { connection: 'ONLINE', dataClassification: 'SIMULATION', history: seed, sensorLatest: {}, lastTelemetry: seed[seed.length - 1].receivedAt, engine: sim };
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
    if (st.connection === 'NO_DEVICE') return S.site ? 'บ้านนี้ยังไม่มีบอร์ด ให้ผู้ดูแลระบบลงทะเบียนบอร์ดก่อน' : 'บัญชีนี้ยังไม่ได้อยู่ในบ้านใด ขอลิงก์เชิญจากเจ้าของบ้าน';
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

  function memberName(userId) {
    const m = (S.members || []).find(x => x.user_id === userId);
    return m ? (m.display_name || m.email || 'สมาชิก') : 'สมาชิก';
  }

  // Gas hose and sensor checks that are due, from site_settings.
  function reminders() {
    const out = [];
    const s = S.settings || {};
    const yearsSince = d => (Date.now() - Date.parse(d)) / (365.25 * 86400e3);
    if (s.hose_installed_on && yearsSince(s.hose_installed_on) >= 2) out.push({ title: 'ถึงเวลาเปลี่ยนสายแก๊ส', detail: `ใช้มาตั้งแต่ ${fullDate(Date.parse(s.hose_installed_on))} (ควรเปลี่ยนทุก 2–3 ปี)` });
    if (s.sensor_checked_on && yearsSince(s.sensor_checked_on) >= 0.5) out.push({ title: 'ถึงเวลาตรวจเทียบเซ็นเซอร์', detail: `ตรวจล่าสุด ${fullDate(Date.parse(s.sensor_checked_on))} (ควรตรวจทุก 6 เดือน)` });
    if (S.canEdit && S.role !== 'technician' && (!s.hose_installed_on || !s.sensor_checked_on)) out.push({ title: 'บันทึกวันเปลี่ยนสายแก๊สและวันตรวจเซ็นเซอร์', detail: 'ระบบจะเตือนเมื่อถึงเวลา · ไปที่ บ้านของฉัน' });
    return out;
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
    // Keep device status fresh on "my home", but never while the user is filling in a field there.
    if (S.tab === 'mine' && !$('#view-mine').contains(document.activeElement)) renderMine();
    const view = S.views[S.tab];
    if (view && view.live) view.render();
  }

  function renderTopbar(st) {
    $('#page-title').textContent = TAB_DEFS[S.tab] ? (S.tab === 'mine' && S.role === 'technician' ? 'บัญชีของฉัน' : TAB_DEFS[S.tab].label) : '';
    const pill = $('#conn-pill');
    const siteTab = ['home', 'plan', 'history', 'mine', 'install'].includes(S.tab);
    pill.hidden = !siteTab;
    const [cls, text] = S.sim ? ['is-demo', 'โหมดสาธิต']
      : st.connection === 'NO_DEVICE' ? ['', 'ยังไม่มีบอร์ด']
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
    const due = reminders();
    const remindHtml = due.length ? `<section class="card list">${due.map(r => `<a class="row" href="#mine" style="color:inherit"><span class="dot" style="background:var(--warning)"></span><span class="row-main"><strong>${esc(r.title)}</strong><small>${esc(r.detail)}</small></span>${ICON.chevron}</a>`).join('')}</section>` : '';

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
        ${remindHtml}
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
    if (!S.alarmTest && !live) { el.hidden = true; S.alarmWasHidden = true; el.__html = null; return; }
    const lv = S.alarmTest ? L.LEVELS.danger : a.level;
    const w = a.worst;
    const sub = S.alarmTest ? 'นี่คือการทดสอบเสียงและหน้าจอเตือน ไม่ได้มีแก๊สรั่วจริง'
      : w ? `วัดได้ ${fmtPpm(w.ppm)} ppm (${fmtLel(w.lel)} ของจุดติดไฟ) · ${w.trend.label}` : '';
    const acks = !S.alarmTest && S.episode && S.episode.alert_acks && S.episode.alert_acks.length
      ? `<p class="alarm-acks">รับทราบแล้ว: ${S.episode.alert_acks.map(x => esc(memberName(x.user_id))).join(', ')}</p>` : '';
    el.className = `alarm${lv.key === 'warning' ? ' is-warning' : ''}`;
    setHtml(el, `<div class="alarm-inner" role="alertdialog" aria-modal="true" aria-labelledby="alarm-title">
      <div class="alarm-meta"><span>${esc(S.site ? S.site.name : 'บ้านของฉัน')}${w && !S.alarmTest ? ` · ${esc(sensorName(w.id))}` : ''}</span><span>${S.sim ? 'โหมดสาธิต' : 'ตอนนี้'}</span></div>
      ${S.alarmTest ? '<span class="alarm-test">ทดสอบ</span>' : ''}
      <span class="alarm-icon" aria-hidden="true">${ICON.alert}</span>
      <h2 id="alarm-title">${esc(lv.label)}</h2>
      <p class="alarm-head">${esc(lv.headline)}</p>
      <p class="alarm-sub">${esc(sub)}</p>
      <ol class="steps">${lv.actions.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      ${acks}
      <div class="alarm-buttons"><a class="alarm-call" href="tel:199">โทรดับเพลิง 199</a><button class="alarm-ack" type="button" data-action="ack">รับทราบ / ปิดเสียง</button></div>
    </div>`);
    el.hidden = false;
    if (S.alarmWasHidden) { S.alarmWasHidden = false; const b = el.querySelector('[data-action="ack"]'); if (b) b.focus(); }
  }

  // ---- History -------------------------------------------------------------------------------------
  function levelEvents(history) {
    const rows = history.filter(r => Number.isFinite(Date.parse(r.receivedAt))).slice().sort((p, x) => Date.parse(p.receivedAt) - Date.parse(x.receivedAt));
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
    return [...byHour.values()].sort((p, x) => p.t - x.t);
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

  function weekView() {
    const now = Date.now();
    const buckets = hourlyBuckets(S.hourly || []);
    const ids = [...new Set((S.hourly || []).map(r => r.sensor_uid))];
    const series = ids.map(id => ({ name: `${sensorName(id)} (สูงสุดรายชั่วโมง)`, color: SERIES[id] || '#475569',
      points: buckets.filter(b => b.bySensor[id] != null).map(b => ({ t: b.t + 1800e3, v: b.bySensor[id] })) }));
    const max = buckets.length ? Math.max(...buckets.map(b => b.max || 0)) : null;
    const hot = buckets.filter(b => b.max != null && b.max >= L.THRESHOLDS.watch);
    const events = hot.slice().reverse().map(b => { const lv = L.classify(b.max); return { at: b.t, color: lv.color, title: `ช่วง ${dayClock(b.t)} ถึงระดับ${lv.label}`, detail: `ค่าสูงสุด ${fmtPpm(b.max)} ppm` }; });
    return { buckets, series, max, hot, events, now };
  }

  function summaryCard() {
    const sum = S.summary;
    const body = S.summaryLoading ? '<p class="muted">กำลังสรุป…</p>'
      : !sum ? '<p class="muted">กดเพื่อสรุปข้อมูล 7 วันล่าสุด</p>'
      : sum.error ? '<p class="muted">สรุปไม่สำเร็จ ลองใหม่อีกครั้ง</p>'
      : `<p style="margin:0;font-size:15px;line-height:1.6">${esc(sum.summary)}</p><p class="muted small">${sum.source === 'gemini' ? `สรุปโดย AI (${esc(sum.model || 'Gemini')})` : 'สรุปอัตโนมัติจากข้อมูล (ยังไม่ได้เปิดใช้ AI)'} · ${esc(ago(sum.created_at))} · ระดับอันตรายตัดสินด้วยกฎ ไม่ใช่ AI</p>`;
    return `<section class="card"><div class="card-head"><h2 style="display:flex;align-items:center;gap:8px">${ICON.spark} สรุปสัปดาห์นี้</h2><button class="btn btn-small" type="button" data-action="summary">${sum && !sum.error ? 'สรุปใหม่' : 'สรุป'}</button></div>${body}</section>`;
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
      chart = '<p class="empty">บ้านนี้ยังไม่มีบอร์ด</p>';
    } else if (!S.hourly || !S.hourlyKey.startsWith(S.range)) {
      chart = '<p class="empty">กำลังโหลดประวัติ…</p>';
      loadHourly();
    } else {
      const hours = S.range === '24h' ? 24 : 168;
      const w = weekView();
      const series = w.series.map(s => ({ ...s, points: s.points.filter(p => p.t >= now - hours * 3600e3) }));
      const buckets = w.buckets.filter(b => b.t >= now - hours * 3600e3);
      chart = chartSvg(series, now - hours * 3600e3, now, 2 * 3600e3);
      const max = buckets.length ? Math.max(...buckets.map(b => b.max || 0)) : null;
      const hot = buckets.filter(b => b.max != null && b.max >= L.THRESHOLDS.watch);
      events = w.events.filter(e => e.at >= now - hours * 3600e3);
      stats = [['ค่าสูงสุด', max == null ? '—' : `${fmtPpm(max)} ppm`], ['ชั่วโมงที่เกินระดับปกติ', `${hot.length} ชั่วโมง`], ['ชั่วโมงที่มีข้อมูล', `${buckets.length} / ${hours}`]];
    }
    const statsHtml = stats ? `<div class="stats">${stats.map(([k, v]) => `<div class="stat" style="background:var(--surface-soft)"><span>${k}</span><strong style="font-size:16px">${v}</strong></div>`).join('')}</div>` : '';
    const list = events.length ? events.slice(0, 20).map(e => `<div class="row"><span class="dot" style="background:${e.color}"></span><div class="row-main"><strong>${esc(e.title)}</strong><small>${esc(e.detail)}</small></div><div class="row-side"><small>${esc(S.range === '1h' ? clock(e.at) : dayClock(e.at))}</small></div></div>`).join('')
      : '<p class="empty">ไม่มีเหตุการณ์ผิดปกติในช่วงนี้</p>';
    setHtml(view, `${S.site && !S.sim ? summaryCard() : ''}
      <div class="segment" role="group" aria-label="ช่วงเวลา">${seg}</div>
      <section class="card">${statsHtml}<div style="margin-top:12px">${chart}</div></section>
      <section class="card list"><div class="card-head" style="margin:10px 0 0"><h2>เหตุการณ์</h2></div>${list}</section>
      ${S.site && !S.sim ? `<button class="btn" type="button" data-action="report">${ICON.print} พิมพ์รายงาน 7 วัน / บันทึกเป็น PDF</button>` : ''}`);
  }

  // Printable 7-day report: a separate element shown only by the print stylesheet.
  async function printReport() {
    if (!S.site) return;
    const prevRange = S.range;
    S.range = '7d';
    if (!S.hourly || !S.hourlyKey.startsWith('7d')) { S.hourlyKey = ''; await loadHourly(); }
    S.range = prevRange;
    if (!S.summary || S.summary.error) await loadSummary(false);
    const w = weekView();
    const chart = chartSvg(w.series, w.now - 168 * 3600e3, w.now, 2 * 3600e3);
    const members = (S.members || []).map(m => esc(m.display_name || m.email || 'สมาชิก')).join(', ') || '—';
    const sensors = Object.keys(shown().sensorLatest || {}).map(sensorName).join(' + ') || '—';
    $('#report').innerHTML = `<header class="report-head"><div><h1>รายงานความปลอดภัยแก๊ส LPG</h1><p>${esc(S.site.name)}${S.site.address ? ` · ${esc(S.site.address)}` : ''}</p></div><div class="report-brand">GasGuard</div></header>
      <table class="report-meta"><tr><th>ช่วงเวลา</th><td>${fullDate(w.now - 7 * 86400e3)} – ${fullDate(w.now)}</td><th>ออกรายงาน</th><td>${new Date().toLocaleString('th-TH')}</td></tr>
      <tr><th>อุปกรณ์</th><td>${esc(S.device ? S.device.uid : '—')} · ${esc(sensors)}</td><th>สมาชิก</th><td>${members}</td></tr></table>
      <h2>สรุป</h2><p>${esc(S.summary && !S.summary.error ? S.summary.summary : 'ไม่มีสรุป')}</p>
      <h2>สถิติ 7 วัน</h2><table class="report-meta"><tr><th>ค่าสูงสุด</th><td>${w.max == null ? '—' : `${fmtPpm(w.max)} ppm`}</td><th>ชั่วโมงที่เกินระดับปกติ</th><td>${w.hot.length}</td></tr>
      <tr><th>ชั่วโมงที่มีข้อมูล</th><td>${w.buckets.length} / 168</td><th>เกณฑ์</th><td>900 / 1,800 / 3,600 ppm</td></tr></table>
      <h2>กราฟค่าแก๊ส (สูงสุดรายชั่วโมง)</h2>${chart}
      <h2>เหตุการณ์</h2>${w.events.length ? `<table class="report-table"><tr><th>เวลา</th><th>เหตุการณ์</th><th>รายละเอียด</th></tr>${w.events.slice(0, 40).map(e => `<tr><td>${esc(dayClock(e.at))}</td><td>${esc(e.title)}</td><td>${esc(e.detail)}</td></tr>`).join('')}</table>` : '<p>ไม่มีเหตุการณ์ผิดปกติ</p>'}
      <p class="report-note">ค่า ppm เป็นค่าประมาณจากเซ็นเซอร์ MQ ที่คาลิเบรตในอากาศสะอาด ใช้เพื่อเตือนเบื้องต้น ไม่ใช่เครื่องมือวัดที่ผ่านการรับรอง</p>`;
    $('#report').hidden = false;
    setTimeout(() => { window.print(); }, 150);
  }

  // ---- My home -------------------------------------------------------------------------------------
  function memberRow(m) {
    const name = m.display_name || m.email || 'สมาชิก';
    const editable = S.canEdit || m.is_me;
    const level = editable
      ? `<label class="field" style="gap:2px"><span class="small muted">แจ้งเตือน LINE</span><select data-action="member-level" data-user="${esc(m.user_id)}">${LEVEL_OPTIONS.map(([v, t]) => `<option value="${v}"${m.alert_min_level === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`
      : `<span class="tag is-off">${esc((LEVEL_OPTIONS.find(o => o[0] === m.alert_min_level) || ['', ''])[1])}</span>`;
    const remove = S.canEdit && !m.is_me && S.role !== 'technician' ? `<button class="btn btn-small btn-danger" type="button" data-action="member-remove" data-user="${esc(m.user_id)}">ลบ</button>` : '';
    return `<div class="row" style="flex-wrap:wrap"><span class="avatar" aria-hidden="true">${esc(name.trim().charAt(0).toUpperCase())}</span>
      <div class="row-main"><strong>${esc(name)}${m.is_me ? ' (คุณ)' : ''}</strong><small>${m.membership_type === 'owner' ? 'เจ้าของ · จัดการแปลนและสมาชิก' : 'สมาชิก · ดูสถานะและรับแจ้งเตือน'}${m.line_linked ? ' · เชื่อม LINE แล้ว' : ''}</small></div>
      <div style="display:flex;gap:8px;align-items:flex-end">${level}${remove}</div></div>`;
  }

  function inviteBlock() {
    if (!S.canEdit || S.role === 'technician' || !S.site) return '';
    const f = S.inviteForm;
    if (f && f.link) {
      return `<div class="invite-result"><strong>ส่งลิงก์นี้ให้คนในบ้าน (ใช้ได้ 7 วัน ครั้งเดียว)</strong><input class="field-input" readonly value="${esc(f.link)}" aria-label="ลิงก์เชิญ">
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-small btn-primary" type="button" data-action="invite-copy">คัดลอกลิงก์</button>${navigator.share ? '<button class="btn btn-small" type="button" data-action="invite-share">แชร์</button>' : ''}<button class="btn btn-small" type="button" data-action="invite-done">เสร็จแล้ว</button></div></div>`;
    }
    if (f) {
      return `<form class="invite-form" data-form="invite"><div class="form-grid">
          <label class="field"><span>สิทธิ์</span><select name="type"><option value="member">สมาชิก (ดูและรับแจ้งเตือน)</option><option value="owner">เจ้าของร่วม (แก้แปลนและสมาชิกได้)</option></select></label>
          <label class="field"><span>รับแจ้งเตือน LINE</span><select name="level">${LEVEL_OPTIONS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
        </div><div style="display:flex;gap:8px"><button class="btn btn-primary" type="submit">สร้างลิงก์เชิญ</button><button class="btn" type="button" data-action="invite-done">ยกเลิก</button></div></form>`;
    }
    return '<button class="btn" type="button" data-action="invite-open">+ เชิญคนในบ้าน / พนักงาน</button>';
  }

  function lineBlock() {
    const cfg = S.config && S.config.line;
    if (!cfg || !cfg.configured) return '<div class="switch-row"><span class="row-main"><strong>LINE</strong><small>ผู้ดูแลระบบยังไม่ได้ตั้งค่า LINE Official Account</small></span><span class="tag is-off">ยังไม่ได้ตั้งค่า</span></div>';
    if (S.lineLinked) return '<div class="switch-row"><span class="row-main"><strong>LINE</strong><small>ได้รับแจ้งเตือนทาง LINE ตามระดับที่ตั้งไว้</small></span><button class="btn btn-small" type="button" data-action="line-unlink">ยกเลิกการเชื่อม</button></div>';
    if (S.lineCode) {
      return `<div class="line-link"><strong>เชื่อม LINE ใน 2 ขั้นตอน</strong><ol class="steps" style="--lv:var(--brand)">
        <li>${cfg.addFriendUrl ? `<a href="${esc(cfg.addFriendUrl)}" target="_blank" rel="noopener">เพิ่มเพื่อน GasGuard ใน LINE</a>` : 'เพิ่มเพื่อนบัญชี LINE ของ GasGuard'}</li>
        <li>ส่งรหัสนี้ในแชท: <span class="line-code">${esc(S.lineCode)}</span> (ใช้ได้ 15 นาที)</li></ol><p class="muted small">หน้านี้จะเปลี่ยนเป็น "เชื่อมแล้ว" เองเมื่อสำเร็จ</p></div>`;
    }
    return '<div class="switch-row"><span class="row-main"><strong>LINE</strong><small>รับแจ้งเตือนแม้ไม่ได้เปิดแอป</small></span><button class="btn btn-small btn-primary" type="button" data-action="line-link">เชื่อม LINE</button></div>';
  }

  function renderMine() {
    const st = shown();
    const tech = S.role === 'technician';
    const notif = alarm.notificationState();
    const notifCtl = notif === 'granted' ? '<span class="tag is-ok">อนุญาตแล้ว</span>'
      : notif === 'denied' ? '<span class="tag is-no">ถูกปิดในเบราว์เซอร์</span>'
      : notif === 'unsupported' ? '<span class="tag is-off">เครื่องนี้ไม่รองรับ</span>'
      : '<button class="btn btn-small" type="button" data-action="notify">อนุญาต</button>';
    const scenarios = Object.entries(L.SCENARIOS).map(([k, v]) => `<option value="${k}"${k === S.scenario ? ' selected' : ''}>${esc(v)}</option>`).join('');
    const sensors = Object.keys(st.sensorLatest || {}).map(sensorName).join(' + ') || 'ยังไม่มีข้อมูล';
    const s = S.settings || {};
    const device = S.device ? `<section class="card">
        <div class="card-head"><h2>อุปกรณ์</h2><span class="tag ${st.connection === 'ONLINE' ? 'is-ok' : 'is-off'}">${S.sim ? 'โหมดสาธิต' : st.connection === 'ONLINE' ? 'ออนไลน์' : st.connection === 'OFFLINE' ? 'ออฟไลน์' : 'รอข้อมูล'}</span></div>
        <div class="row"><div class="row-main"><strong>${esc(S.device.uid)}</strong><small>ESP32 · ${esc(sensors)} · ส่งข้อมูลทุก 10 วินาที</small></div><div class="row-side"><small>ล่าสุด ${esc(ago(st.lastTelemetry))}</small></div></div>
      </section>` : '';
    const care = S.site && !tech ? `<section class="card">
        <div class="card-head"><h2>ดูแลอุปกรณ์แก๊ส</h2></div>
        <form class="form-grid" data-form="settings">
          <label class="field"><span>วันที่เปลี่ยนสายแก๊สล่าสุด</span><input type="date" name="hose" value="${esc(s.hose_installed_on || '')}"${S.canEdit ? '' : ' disabled'}></label>
          <label class="field"><span>วันที่ตรวจเทียบเซ็นเซอร์ล่าสุด</span><input type="date" name="sensor" value="${esc(s.sensor_checked_on || '')}"${S.canEdit ? '' : ' disabled'}></label>
          ${S.canEdit ? '<button class="btn" type="submit">บันทึก</button>' : ''}
        </form>
        <p class="muted small">ระบบจะเตือนเมื่อสายแก๊สใช้ครบ 2 ปี และเมื่อเซ็นเซอร์ไม่ได้ตรวจเกิน 6 เดือน</p>
      </section>` : '';
    const members = S.site && !tech ? `<section class="card list">
        <div class="card-head" style="margin:10px 0 0"><h2>คนในบ้าน</h2></div>
        ${S.members ? (S.members.map(memberRow).join('') || '<p class="empty">ยังไม่มีสมาชิก</p>') : '<p class="empty">กำลังโหลดรายชื่อ…</p>'}
        <div style="padding:12px 0">${inviteBlock()}</div>
      </section>` : '';
    setHtml($('#view-mine'), `${device}${members}
      <section class="card">
        <div class="card-head"><h2>การแจ้งเตือน</h2></div>
        <label class="switch-row"><span class="row-main"><strong>เสียงเตือนบนเครื่องนี้</strong><small>เหลือง: เสียงเบา · ส้ม: บี๊บซ้ำ · แดง: ไซเรนจนกว่าจะกดรับทราบ</small></span><input type="checkbox" data-action="sound-toggle"${alarm.wantsSound() ? ' checked' : ''}></label>
        <div class="switch-row"><span class="row-main"><strong>แจ้งเตือนบนหน้าจอ</strong><small>ขึ้นข้อความเมื่อระดับสูงขึ้น ขณะเปิดแอปไว้</small></span>${notifCtl}</div>
        <div class="switch-row"><span class="row-main"><strong>สั่น</strong><small>ใช้ได้บนมือถือ Android · iPhone ไม่รองรับจากเว็บ</small></span><span class="tag is-info">อัตโนมัติ</span></div>
        ${lineBlock()}
        <div style="margin-top:12px"><button class="btn" type="button" data-action="test-alarm">${ICON.bell} ทดสอบเสียงเตือน</button></div>
      </section>
      ${care}
      ${tech ? '' : `<section class="card">
        <div class="card-head"><h2>โหมดสาธิต</h2></div>
        <label class="switch-row"><span class="row-main"><strong>ใช้ค่าจำลองแทนบอร์ดจริง</strong><small>ค่าเปลี่ยนทุก 10 วินาที ไว้นำเสนอการเปลี่ยนสีและการแจ้งเตือน</small></span><input type="checkbox" data-action="demo-toggle"${S.sim ? ' checked' : ''}></label>
        <label class="field" style="margin-top:10px"><span>สถานการณ์</span><select data-action="scenario">${scenarios}</select></label>
      </section>`}
      <section class="card">
        <div class="card-head"><h2>เกณฑ์ระดับแก๊ส</h2></div>
        <div class="legend">${legendHtml()}</div>
        <p class="muted small">5 / 10 / 20% ของจุดติดไฟต่ำสุด (LEL) ของ LPG ที่ 18,000 ppm · ใช้ค่าเดียวกันทั้งแอป บอร์ด และแจ้งเตือน LINE</p>
      </section>
      <section class="card">
        <div class="card-head"><h2>บัญชี</h2></div>
        <form class="form-grid" data-form="profile"><label class="field"><span>ชื่อที่แสดง</span><input name="name" maxlength="60" value="${esc(S.profileName || '')}" placeholder="เช่น แม่, พี่บี"></label><button class="btn" type="submit">บันทึกชื่อ</button></form>
        <div class="row"><div class="row-main"><strong>${esc(S.user.email || '')}</strong><small>${esc(ROLE_LABEL[S.role] || 'ผู้ใช้')}${S.canEdit && !tech ? ' · แก้ไขแปลนได้' : ''}</small></div><button class="btn btn-small" type="button" data-action="sign-out">ออกจากระบบ</button></div>
      </section>`);
  }

  // ---- Floor plan --------------------------------------------------------------------------------
  function planStore() {
    if (!S.site) return null;
    const siteId = S.site.id;
    return {
      load: async () => {
        const { data, error } = await q(db().from('floor_plans').select('plan').eq('site_id', siteId).maybeSingle());
        if (error) throw error;
        return data ? data.plan : null;
      },
      save: async plan => {
        if (!S.canEdit) return false;
        const { error } = await q(db().from('floor_plans').upsert({ site_id: siteId, plan, updated_by: S.user.id }));
        return !error;
      }
    };
  }

  function mountPlanInto(el) {
    return FP.mount(el, {
      storageKey: planKey(),
      store: planStore(),
      readOnly: !S.canEdit,
      sensorOptions: () => Object.keys(SENSOR_NAMES).map(id => ({ id, name: `${SENSOR_NAMES[id]} (${id})` })),
      onChange: () => { if (S.tab === 'home') render(); }
    });
  }

  function mountPlan() {
    if (S.planCtl) return;
    S.planCtl = mountPlanInto($('#plan-mount'));
    $('#plan-legend').innerHTML = legendHtml();
  }

  // ---- Navigation ----------------------------------------------------------------------------------
  function roleTabs() { return ROLE_TABS[S.role] || ROLE_TABS.general; }

  function renderTabbar() {
    const tabs = roleTabs();
    $('#tabbar').innerHTML = `<div class="brand tabbar-brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/></svg></span>GasGuard</div>`
      + tabs.map(t => `<a class="tab" href="#${t}" data-tab="${t}"><svg viewBox="0 0 24 24" aria-hidden="true">${TAB_DEFS[t].icon}</svg><span>${esc(t === 'mine' && S.role === 'technician' ? 'บัญชี' : TAB_DEFS[t].label)}</span></a>`).join('');
    $('#tabbar').style.setProperty('--tabs', tabs.length);
  }

  function setTab(tab) {
    const tabs = roleTabs();
    S.tab = tabs.includes(tab) ? tab : tabs[0];
    if (location.hash.slice(1) !== S.tab) history.replaceState(null, '', `#${S.tab}`);
    document.querySelectorAll('.tab').forEach(a => {
      const on = a.dataset.tab === S.tab;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('.view[data-view]').forEach(v => { v.hidden = v.dataset.view !== S.tab; });
    if (S.tab === 'history') { renderHistory(); if (!S.summary && S.site && !S.sim) loadSummary(false); }
    if (S.tab === 'mine') renderMine();
    if (S.views[S.tab]) S.views[S.tab].render();
    render();
    window.scrollTo(0, 0);
  }

  // ---- Invitations --------------------------------------------------------------------------------
  async function loadInvite() {
    const token = params.get('invite');
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return;
    S.inviteToken = token;
    const { data } = await q(db().rpc('invitation_info', { p_token_hash: await sha256Hex(token) }));
    S.invite = data || { valid: false, status: 'not_found' };
  }

  function renderInvitePanel() {
    const panel = $('#invite-panel');
    if (!S.inviteToken) { panel.hidden = true; return; }
    const inv = S.invite || {};
    panel.hidden = false;
    if (!inv.valid) {
      panel.innerHTML = `<h2>ลิงก์เชิญใช้ไม่ได้</h2><p class="muted">${inv.status === 'claimed' ? 'ลิงก์นี้ถูกใช้ไปแล้ว' : inv.status === 'expired' ? 'ลิงก์หมดอายุแล้ว' : 'ไม่พบลิงก์นี้'} ขอลิงก์ใหม่จากเจ้าของบ้าน</p>`;
      return;
    }
    panel.innerHTML = `<p class="eyebrow">คำเชิญ</p><h2>เข้าร่วม "${esc(inv.site_name)}"</h2>
      <p class="muted">ในฐานะ${inv.membership_type === 'owner' ? 'เจ้าของร่วม' : 'สมาชิก'} · สร้างบัญชีใหม่ หรือเข้าสู่ระบบด้วยบัญชีเดิมด้านล่าง</p>
      <form class="login" id="signup-form" novalidate style="padding:0">
        <label class="field"><span>ชื่อที่แสดง</span><input name="name" maxlength="60" autocomplete="nickname" placeholder="เช่น แม่, พี่บี"></label>
        <label class="field"><span>อีเมล</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>ตั้งรหัสผ่าน (อย่างน้อย 8 ตัว)</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <button class="btn btn-primary" type="submit">สร้างบัญชีและเข้าร่วม</button>
        <p class="form-error" id="signup-error" role="alert"></p>
      </form>`;
  }

  async function claimInviteIfAny() {
    if (!S.inviteToken || !S.invite || !S.invite.valid) return;
    const { data, error } = await q(db().rpc('claim_site_invitation', { p_token_hash: await sha256Hex(S.inviteToken) }));
    S.inviteToken = null; S.invite = null;
    history.replaceState(null, '', location.pathname + location.hash);
    if (error || !data || !data.ok) toast('ลิงก์เชิญใช้ไม่ได้แล้ว ขอลิงก์ใหม่จากเจ้าของบ้าน');
    else { toast('เข้าร่วมบ้านเรียบร้อย'); store.set('gasguard.site', data.site_id); }
  }

  // ---- Auth ---------------------------------------------------------------------------------------
  function showLanding(message) {
    S.user = null;
    clearInterval(S.pollTimer); S.pollTimer = null;
    stopDemo(); alarm.stop();
    $('#boot').hidden = true; $('#app').hidden = true; $('#landing').hidden = false; $('#alarm').hidden = true;
    $('#login-error').textContent = message || '';
    renderInvitePanel();
  }

  async function enterApp(session) {
    S.user = session.user;
    S.role = Auth.roleFromUser(session.user) || 'general';
    S.profileName = (session.user.user_metadata && session.user.user_metadata.display_name) || null;
    $('#boot').hidden = true; $('#landing').hidden = true; $('#app').hidden = false;
    renderTabbar();
    S.views = {};
    const ctx = makeContext();
    Object.values(window.GasGuardViews || {}).forEach(factory => Object.assign(S.views, factory(ctx)));
    await claimInviteIfAny();
    setTab((location.hash || '').slice(1));
    loadConfig().then(() => { if (S.tab === 'mine') renderMine(); });
    q(db().from('profiles').select('display_name').eq('id', S.user.id).maybeSingle()).then(({ data }) => { if (data && data.display_name) S.profileName = data.display_name; });
    if (S.role !== 'technician') await loadSites();
    clearInterval(S.pollTimer);
    S.pollTimer = setInterval(poll, POLL_MS);
    if (params.get('demo') === '1') startDemo();
    Object.values(S.views).forEach(v => v.init && v.init());
  }

  async function signOut() {
    try { await Auth.signOut(); } catch (e) { /* local session is cleared anyway */ }
    S.planCtl = null; $('#plan-mount').innerHTML = '';
    Object.assign(S, { sites: [], site: null, device: null, devices: [], members: null, real: null, hourly: null, hourlyKey: '', summary: null, episode: null, lineLinked: null, lineCode: null, inviteForm: null });
    document.querySelectorAll('.view[data-view]').forEach(v => { v.innerHTML = v.dataset.view === 'plan' ? v.innerHTML : ''; v.__html = null; });
    showLanding();
  }

  function makeContext() {
    return { S, L, FP, ICON, $, esc, db, q, api, toast, setHtml, setTab, selectSite, loadSites, renderSiteSwitch, shown, assessNow, render,
      fmtPpm, fmtLel, ago, clock, dayClock, fullDate, sensorName, legendHtml, sensorRows, mountPlanInto, randomHex, sha256Hex, ROLE_LABEL, SENSOR_NAMES };
  }

  // ---- Events --------------------------------------------------------------------------------------
  let lineTimer = null;
  document.addEventListener('click', async evt => {
    const el = evt.target.closest('[data-action], [data-range]');
    if (!el) return;
    if (el.dataset.range) { S.range = el.dataset.range; renderHistory(); return; }
    const action = el.dataset.action;
    if (action === 'sound-on') { await alarm.enable(); setTimeout(render, 150); toast('เปิดเสียงเตือนแล้ว'); }
    else if (action === 'ack') {
      if (S.alarmTest) S.alarmTest = false;
      else {
        alarm.acknowledge();
        if (S.episode && !S.sim) { await q(db().rpc('ack_alert', { p_episode_id: S.episode.id })); poll(); }
      }
      render();
    }
    else if (action === 'test-alarm') { if (!alarm.wantsSound()) await alarm.enable(); alarm.test(); S.alarmTest = true; render(); }
    else if (action === 'demo-off') { stopDemo(); render(); if (S.tab === 'mine') renderMine(); }
    else if (action === 'notify') { await alarm.enable(); renderMine(); }
    else if (action === 'go-login') { evt.preventDefault(); $('#login-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#login-email').focus({ preventScroll: true }); }
    else if (action === 'sign-out') signOut();
    else if (action === 'summary') loadSummary(Boolean(S.summary && !S.summary.error));
    else if (action === 'report') printReport();
    else if (action === 'invite-open') { S.inviteForm = {}; renderMine(); }
    else if (action === 'invite-done') { S.inviteForm = null; renderMine(); }
    else if (action === 'invite-copy') { try { await navigator.clipboard.writeText(S.inviteForm.link); toast('คัดลอกลิงก์แล้ว'); } catch (e) { toast('คัดลอกไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอก'); } }
    else if (action === 'invite-share') { try { await navigator.share({ title: 'เข้าร่วมบ้านใน GasGuard', text: `เชิญเข้าร่วม ${S.site.name} ใน GasGuard`, url: S.inviteForm.link }); } catch (e) { /* cancelled */ } }
    else if (action === 'member-remove') {
      if (!confirm('ลบสมาชิกคนนี้ออกจากบ้าน? เขาจะไม่เห็นข้อมูลและไม่ได้รับแจ้งเตือนอีก')) return;
      const { data, error } = await q(db().rpc('remove_site_member', { p_site_id: S.site.id, p_user_id: el.dataset.user }));
      toast(error ? 'ลบไม่สำเร็จ' : data && data.code === 'LAST_OWNER' ? 'ต้องมีเจ้าของอย่างน้อย 1 คน' : 'ลบสมาชิกแล้ว');
      loadMembers();
    }
    else if (action === 'line-link') {
      const { data, error } = await q(db().rpc('create_line_link_code'));
      if (error || !data) { toast('ขอรหัสไม่สำเร็จ ลองใหม่'); return; }
      S.lineCode = data; renderMine();
      clearInterval(lineTimer);
      const started = Date.now();
      lineTimer = setInterval(async () => {
        const { data: link } = await q(db().from('user_line_links').select('user_id').eq('user_id', S.user.id).maybeSingle());
        if (link || Date.now() - started > 15 * 60e3) {
          clearInterval(lineTimer); S.lineCode = null; S.lineLinked = Boolean(link);
          if (link) toast('เชื่อม LINE สำเร็จ');
          loadMembers(); if (S.tab === 'mine') renderMine();
        }
      }, 4000);
    }
    else if (action === 'line-unlink') {
      await q(db().from('user_line_links').delete().eq('user_id', S.user.id));
      S.lineLinked = false; toast('ยกเลิกการเชื่อม LINE แล้ว'); loadMembers(); renderMine();
    }
  });

  document.addEventListener('change', async evt => {
    const el = evt.target;
    const action = el.dataset && el.dataset.action;
    if (action === 'sound-toggle') { if (el.checked) alarm.enable(); else alarm.disable(); setTimeout(render, 150); }
    else if (action === 'demo-toggle') { if (el.checked) startDemo(); else stopDemo(); render(); if (S.tab === 'history') renderHistory(); }
    else if (action === 'scenario') { S.scenario = el.value; if (S.sim) startDemo(el.value); }
    else if (action === 'member-level') {
      const { error } = await q(db().rpc('set_member_alert_level', { p_site_id: S.site.id, p_user_id: el.dataset.user, p_level: el.value }));
      toast(error ? 'บันทึกไม่สำเร็จ' : 'บันทึกระดับแจ้งเตือนแล้ว');
      loadMembers();
    }
    else if (el.id === 'site-switch') selectSite(el.value);
  });

  document.addEventListener('submit', async evt => {
    const form = evt.target;
    const kind = form.dataset && form.dataset.form;
    if (form.id === 'signup-form') { evt.preventDefault(); return signup(form); }
    if (!kind) return;
    evt.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (kind === 'invite') {
      const token = randomHex(32);
      const { error } = await q(db().rpc('create_site_invitation', { p_site_id: S.site.id, p_token_hash: await sha256Hex(token), p_membership_type: data.type, p_alert_min_level: data.level }));
      if (error) { toast('สร้างลิงก์ไม่สำเร็จ'); return; }
      S.inviteForm = { link: `${location.origin}/?invite=${token}` };
      renderMine();
    } else if (kind === 'settings') {
      const row = { site_id: S.site.id, hose_installed_on: data.hose || null, sensor_checked_on: data.sensor || null, updated_by: S.user.id };
      const { error } = await q(db().from('site_settings').upsert(row));
      if (!error) S.settings = row;
      toast(error ? 'บันทึกไม่สำเร็จ' : 'บันทึกแล้ว');
      $('#view-home').__html = null;
    } else if (kind === 'profile') {
      const name = String(data.name || '').trim().slice(0, 60) || null;
      const { error } = await q(db().from('profiles').update({ display_name: name }).eq('id', S.user.id));
      if (!error) S.profileName = name;
      toast(error ? 'บันทึกไม่สำเร็จ' : 'บันทึกชื่อแล้ว');
      loadMembers();
    } else {
      for (const view of Object.values(S.views)) if (view.onSubmit && view.onSubmit(kind, form, data)) break;
    }
  });

  async function signup(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const err = $('#signup-error');
    err.textContent = '';
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const r = await api('/api/v1/invite/signup', { method: 'POST', body: JSON.stringify({ token: S.inviteToken, email: data.email, password: data.password, displayName: data.name }) }).catch(() => ({ ok: false, body: {} }));
    if (!r.ok) {
      const code = r.body && r.body.code;
      err.textContent = code === 'EMAIL_EXISTS' ? 'อีเมลนี้มีบัญชีแล้ว เข้าสู่ระบบด้วยฟอร์มด้านล่างเพื่อเข้าร่วมบ้าน'
        : code === 'PASSWORD_TOO_SHORT' ? 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร'
        : code === 'EMAIL_INVALID' ? 'รูปแบบอีเมลไม่ถูกต้อง'
        : code === 'INVITATION_INVALID' ? 'ลิงก์เชิญใช้ไม่ได้แล้ว' : 'สร้างบัญชีไม่สำเร็จ ลองใหม่อีกครั้ง';
      button.disabled = false;
      return;
    }
    S.inviteToken = null; S.invite = null;
    history.replaceState(null, '', location.pathname);
    try {
      const result = await Auth.signIn(data.email, data.password);
      if (!S.user) enterApp(result.session);
    } catch (e) {
      showLanding('สร้างบัญชีแล้ว เข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่ตั้งไว้');
    }
  }

  window.addEventListener('hashchange', () => { if (S.user) setTab(location.hash.slice(1)); });
  window.addEventListener('afterprint', () => { $('#report').hidden = true; });
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
      await loadInvite();
      if (session) enterApp(session); else showLanding();
    } catch (error) {
      showLanding(error && error.code === 'config_missing' ? 'ยังไม่ได้ตั้งค่าระบบยืนยันตัวตน (Supabase)' : Auth.loginErrorMessage(error));
    }
  }());
}());
