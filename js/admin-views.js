(function () {
  'use strict';

  // Admin tabs: overview of every site (status, devices, things to handle, adding sites and boards),
  // users and roles, and technician jobs. Writes go through Supabase as the admin (RLS admin policies);
  // creating accounts uses /api/v1/admin/users because it needs Supabase Auth's admin API.
  window.GasGuardViews = window.GasGuardViews || {};
  window.GasGuardViews.admin = ctx => {
    const { S, $, esc, db, q, api, toast, setHtml, setTab, selectSite, fmtPpm, ago, fullDate, randomHex, sha256Hex, ROLE_LABEL } = ctx;
    if (S.role !== 'admin') return {};

    const LEVEL = { watch: ['เฝ้าระวัง', '#E0A400'], warning: ['เตือน', '#EF6C00'], danger: ['อันตราย', '#D32F2F'] };
    const JOB_STATUS = { scheduled: 'นัดแล้ว', in_progress: 'กำลังทำ', blocked: 'ติดปัญหา', completed: 'เสร็จแล้ว', cancelled: 'ยกเลิก' };
    const D = { sites: [], devices: [], episodes: [], recent: [], calibrations: [], memberships: [], users: null, jobs: [], loaded: false };
    let openSite = null, newKey = null, showSiteForm = false, showUserForm = false, showJobForm = false;

    async function loadAll() {
      const since = new Date(Date.now() - 7 * 86400e3).toISOString();
      const [sites, devices, open, recent, cals, members, jobs] = await Promise.all([
        q(db().from('sites').select('id, name, address_text, lifecycle_status, customers(name, customer_type)').order('name')),
        q(db().from('devices').select('id, site_id, device_uid, lifecycle_status, device_status(last_seen_at, gas_ppm, safety, data_classification), sensors(sensor_uid, sensor_type)').order('created_at')),
        q(db().from('alert_episodes').select('id, site_id, level, peak_ppm, started_at').is('ended_at', null)),
        q(db().from('alert_episodes').select('site_id').gte('started_at', since)),
        q(db().from('sensor_calibrations').select('device_id, sensor_uid, measured_at').order('measured_at', { ascending: false })),
        q(db().from('site_memberships').select('site_id, user_id, membership_type, status').eq('status', 'active')),
        q(db().from('installation_jobs').select('id, site_id, job_type, status, scheduled_for, notes, created_at, job_assignments(technician_user_id, assignment_status)').order('created_at', { ascending: false }).limit(100))
      ]);
      D.sites = sites.data || []; D.devices = devices.data || []; D.episodes = open.data || []; D.recent = recent.data || [];
      D.calibrations = cals.data || []; D.memberships = members.data || []; D.jobs = jobs.data || []; D.loaded = true;
      S.sites = D.sites.map(s => ({ id: s.id, name: s.name, address: s.address_text }));
      ctx.renderSiteSwitch();
      if (S.tab === 'overview') renderOverview();
      if (S.tab === 'work') renderWork();
    }

    async function loadUsers() {
      const r = await api('/api/v1/admin/users').catch(() => ({ ok: false }));
      D.users = r.ok ? r.body.users : [];
      if (!r.ok) toast('โหลดรายชื่อผู้ใช้ไม่สำเร็จ');
      if (S.tab === 'users') renderUsers();
      if (S.tab === 'work') renderWork();
      if (S.tab === 'overview') renderOverview();
    }

    const userLabel = id => { const u = (D.users || []).find(x => x.id === id); return u ? (u.displayName || u.email) : 'ผู้ใช้'; };
    const online = d => { const s = Array.isArray(d.device_status) ? d.device_status[0] : d.device_status; return s && Date.now() - Date.parse(s.last_seen_at) < 30000 && s.data_classification !== 'SYNTHETIC_HANDSHAKE'; };
    const statusOf = d => (Array.isArray(d.device_status) ? d.device_status[0] : d.device_status) || null;

    function siteRow(s) {
      const devs = D.devices.filter(d => d.site_id === s.id);
      const on = devs.filter(online).length;
      const ep = D.episodes.find(e => e.site_id === s.id);
      const max = Math.max(...devs.map(d => { const st = statusOf(d); return st && online(d) && st.gas_ppm != null ? Number(st.gas_ppm) : -1; }), -1);
      const [label, color] = ep ? LEVEL[ep.level] : !devs.length ? ['ยังไม่มีบอร์ด', '#8A94A6'] : on === 0 ? ['ออฟไลน์', '#8A94A6'] : ['ปกติ', '#1F9D55'];
      const events = D.recent.filter(e => e.site_id === s.id).length;
      return `<tr><td><strong>${esc(s.name)}</strong><small>${esc((s.customers && s.customers.customer_type === 'restaurant') ? 'ร้านอาหาร' : 'บ้าน')}${s.address_text ? ` · ${esc(s.address_text)}` : ''}</small></td>
        <td><span style="display:inline-flex;align-items:center;gap:6px;font-weight:600"><span class="dot" style="background:${color}"></span>${label}</span></td>
        <td>${max >= 0 ? `${fmtPpm(max)} ppm` : '—'}</td><td>${on} / ${devs.length} ออนไลน์</td><td>${events}</td>
        <td style="white-space:nowrap"><button class="btn btn-small" type="button" data-admin="view-site" data-site="${esc(s.id)}">ดูบ้าน</button> <button class="btn btn-small" type="button" data-admin="manage-site" data-site="${esc(s.id)}">จัดการ</button></td></tr>`;
    }

    function todoList() {
      const items = [];
      for (const e of D.episodes) { const s = D.sites.find(x => x.id === e.site_id); items.push({ color: LEVEL[e.level][1], title: `${s ? s.name : 'สถานที่'} · ระดับ${LEVEL[e.level][0]}`, detail: `ตั้งแต่ ${ago(e.started_at)} · สูงสุด ${fmtPpm(Number(e.peak_ppm))} ppm · โทรหาเจ้าของบ้าน` }); }
      for (const d of D.devices) {
        const st = statusOf(d);
        if (d.lifecycle_status !== 'retired' && (!st || !online(d))) { const s = D.sites.find(x => x.id === d.site_id); items.push({ color: '#8A94A6', title: `${d.device_uid} ออฟไลน์`, detail: `${s ? s.name : ''} · ล่าสุด ${st ? ago(st.last_seen_at) : 'ไม่เคยส่งข้อมูล'} · มอบหมายช่างไปตรวจไฟและ Wi-Fi` }); }
        const cal = D.calibrations.find(c => c.device_id === d.id);
        if (d.lifecycle_status !== 'retired' && (!cal || Date.now() - Date.parse(cal.measured_at) > 182 * 86400e3)) items.push({ color: '#4FA3D9', title: `${d.device_uid} ถึงรอบตรวจเทียบเซ็นเซอร์`, detail: cal ? `ตรวจล่าสุด ${fullDate(Date.parse(cal.measured_at))}` : 'ยังไม่มีบันทึกค่า Ro · นัดช่างคาลิเบรต' });
      }
      return items.length ? items.slice(0, 12).map(i => `<div class="row"><span class="dot" style="background:${i.color}"></span><div class="row-main"><strong>${esc(i.title)}</strong><small>${esc(i.detail)}</small></div></div>`).join('') : '<p class="empty">ไม่มีเรื่องที่ต้องจัดการตอนนี้</p>';
    }

    function managePanel() {
      const s = D.sites.find(x => x.id === openSite);
      if (!s) return '';
      const devs = D.devices.filter(d => d.site_id === s.id);
      const mem = D.memberships.filter(m => m.site_id === s.id);
      const userOptions = (D.users || []).filter(u => !mem.some(m => m.user_id === u.id)).map(u => `<option value="${esc(u.id)}">${esc(u.displayName ? `${u.displayName} (${u.email})` : u.email)}</option>`).join('');
      return `<section class="card" id="manage-panel"><div class="card-head"><h2>จัดการ: ${esc(s.name)}</h2><button class="btn btn-small" type="button" data-admin="close-site">ปิด</button></div>
        ${newKey ? `<div class="secret-box"><strong>device key ของ ${esc(newKey.uid)} — แสดงครั้งเดียว</strong><code>${esc(newKey.key)}</code><small>ใส่ในไฟล์ secrets.h ของบอร์ด (GASGUARD_DEVICE_KEY) ห้ามส่งในแชทกลุ่มหรือเก็บใน git ระบบเก็บไว้แค่ค่า hash</small><div><button class="btn btn-small" type="button" data-admin="copy-key">คัดลอก</button> <button class="btn btn-small" type="button" data-admin="hide-key">ซ่อน</button></div></div>` : ''}
        <h3 style="font-size:15px;margin:14px 0 6px">บอร์ด</h3>
        <div class="table-wrap"><table class="table"><thead><tr><th>รหัสบอร์ด</th><th>เซ็นเซอร์</th><th>สถานะ</th><th></th></tr></thead><tbody>
          ${devs.map(d => { const st = statusOf(d); return `<tr><td><strong>${esc(d.device_uid)}</strong><small>${esc(d.lifecycle_status)}</small></td><td>${esc((d.sensors || []).map(x => x.sensor_uid).join(', ') || '—')}</td><td>${online(d) ? '<span class="tag is-ok">ออนไลน์</span>' : `<span class="tag is-off">${st ? `ล่าสุด ${esc(ago(st.last_seen_at))}` : 'ยังไม่เคยส่ง'}</span>`}</td><td><button class="btn btn-small" type="button" data-admin="new-key" data-device="${esc(d.id)}" data-uid="${esc(d.device_uid)}">ออก key ใหม่</button></td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">ยังไม่มีบอร์ด</td></tr>'}
        </tbody></table></div>
        <form class="form-grid" data-form="admin-device" style="margin-top:10px"><label class="field"><span>เพิ่มบอร์ด: รหัสบอร์ด</span><input name="uid" placeholder="ESP32-KITCHEN-02" pattern="[A-Za-z0-9._-]{1,64}" required></label>
          <label class="switch-row" style="border:0"><input type="checkbox" name="mq6" checked> MQ-6</label><label class="switch-row" style="border:0"><input type="checkbox" name="mq2" checked> MQ-2</label>
          <button class="btn btn-primary" type="submit">เพิ่มบอร์ดและออก key</button></form>
        <h3 style="font-size:15px;margin:18px 0 6px">สมาชิก</h3>
        ${mem.map(m => `<div class="row"><span class="avatar" aria-hidden="true">${esc(userLabel(m.user_id).charAt(0).toUpperCase())}</span><div class="row-main"><strong>${esc(userLabel(m.user_id))}</strong><small>${m.membership_type === 'owner' ? 'เจ้าของ' : 'สมาชิก'}</small></div><button class="btn btn-small btn-danger" type="button" data-admin="remove-member" data-site="${esc(s.id)}" data-user="${esc(m.user_id)}">ลบ</button></div>`).join('') || '<p class="empty">ยังไม่มีสมาชิก</p>'}
        ${userOptions ? `<form class="form-grid" data-form="admin-member" style="margin-top:10px"><label class="field"><span>เพิ่มผู้ใช้เข้าบ้านนี้</span><select name="user">${userOptions}</select></label>
          <label class="field"><span>สิทธิ์</span><select name="type"><option value="owner">เจ้าของ</option><option value="member">สมาชิก</option></select></label><button class="btn" type="submit">เพิ่ม</button></form>` : '<p class="muted small">สร้างบัญชีผู้ใช้ได้ที่แท็บ "ผู้ใช้"</p>'}
      </section>`;
    }

    function renderOverview() {
      if (!D.loaded) { setHtml($('#view-overview'), '<p class="empty">กำลังโหลด…</p>'); return; }
      const total = D.sites.length;
      const attention = new Set(D.episodes.map(e => e.site_id)).size;
      const offline = D.devices.filter(d => d.lifecycle_status !== 'retired' && !online(d)).length;
      const safe = D.sites.filter(s => !D.episodes.some(e => e.site_id === s.id) && D.devices.some(d => d.site_id === s.id && online(d))).length;
      setHtml($('#view-overview'), `<div class="kpis">
          <div class="kpi"><span>สถานที่ทั้งหมด</span><strong>${total}</strong><small>บ้านและร้านที่ดูแล</small></div>
          <div class="kpi"><span>ปลอดภัย</span><strong style="color:var(--safe-ink)">${safe}</strong><small>บอร์ดออนไลน์ ไม่มีเหตุ</small></div>
          <div class="kpi"><span>ต้องดูแล</span><strong style="color:var(--warning-ink)">${attention}</strong><small>มีเหตุที่ยังไม่จบ</small></div>
          <div class="kpi"><span>บอร์ดออฟไลน์</span><strong>${offline}</strong><small>เกิน 30 วินาที</small></div>
        </div>
        <div class="home-grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
          <section class="card" style="padding:0;overflow:hidden">
            <div class="card-head" style="padding:14px 16px 0"><h2>สถานที่ทั้งหมด</h2><div style="display:flex;gap:8px"><button class="btn btn-small" type="button" data-admin="refresh">รีเฟรช</button><button class="btn btn-small btn-primary" type="button" data-admin="site-form">+ เพิ่มสถานที่</button></div></div>
            ${showSiteForm ? `<form class="form-grid" data-form="admin-site" style="padding:12px 16px"><label class="field"><span>ชื่อสถานที่</span><input name="name" required maxlength="120" placeholder="ร้านอาหาร สาขา 1"></label>
              <label class="field"><span>ประเภท</span><select name="type"><option value="household">บ้าน</option><option value="restaurant">ร้านอาหาร</option><option value="other">อื่น ๆ</option></select></label>
              <label class="field"><span>ชื่อลูกค้า</span><input name="customer" maxlength="120" placeholder="ชื่อเจ้าของ / บริษัท"></label>
              <label class="field"><span>ที่อยู่</span><input name="address" maxlength="300"></label>
              <button class="btn btn-primary" type="submit">บันทึก</button></form>` : ''}
            <div class="table-wrap"><table class="table"><thead><tr><th>สถานที่</th><th>สถานะ</th><th>ค่าสูงสุด</th><th>อุปกรณ์</th><th>เหตุ 7 วัน</th><th></th></tr></thead><tbody>${D.sites.map(siteRow).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีสถานที่</td></tr>'}</tbody></table></div>
          </section>
          <section class="card list"><div class="card-head" style="margin:10px 0 0"><h2>ต้องจัดการ</h2></div>${todoList()}</section>
        </div>
        ${managePanel()}`);
    }

    function renderUsers() {
      const users = D.users;
      const rows = !users ? '<tr><td colspan="4" class="empty">กำลังโหลด…</td></tr>' : users.map(u => {
        const sites = D.memberships.filter(m => m.user_id === u.id).map(m => { const s = D.sites.find(x => x.id === m.site_id); return s ? `${s.name}${m.membership_type === 'owner' ? ' (เจ้าของ)' : ''}` : null; }).filter(Boolean);
        return `<tr><td><strong>${esc(u.displayName || u.email)}</strong><small>${esc(u.email)}</small></td>
          <td><select data-admin="role" data-user="${esc(u.id)}"${u.id === S.user.id ? ' disabled' : ''}>${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}"${u.role === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
          <td>${esc(sites.join(', ') || '—')}</td><td><small>${u.lastSignInAt ? esc(ago(u.lastSignInAt)) : 'ยังไม่เคยเข้า'}</small></td></tr>`;
      }).join('');
      setHtml($('#view-users'), `<section class="card" style="padding:0;overflow:hidden">
          <div class="card-head" style="padding:14px 16px 0"><h2>ผู้ใช้และสิทธิ์</h2><button class="btn btn-small btn-primary" type="button" data-admin="user-form">+ สร้างบัญชี</button></div>
          ${showUserForm ? `<form class="form-grid" data-form="admin-user" style="padding:12px 16px">
            <label class="field"><span>อีเมล</span><input name="email" type="email" required autocomplete="off"></label>
            <label class="field"><span>ชื่อที่แสดง</span><input name="name" maxlength="60"></label>
            <label class="field"><span>รหัสผ่านชั่วคราว (≥ 8 ตัว)</span><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
            <label class="field"><span>บทบาท</span><select name="role">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <label class="field"><span>เพิ่มเข้าสถานที่ (ไม่บังคับ)</span><select name="site"><option value="">—</option>${D.sites.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
            <label class="field"><span>สิทธิ์ในสถานที่</span><select name="type"><option value="owner">เจ้าของ</option><option value="member">สมาชิก</option></select></label>
            <button class="btn btn-primary" type="submit">สร้างบัญชี</button></form>` : ''}
          <div class="table-wrap"><table class="table"><thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>สถานที่</th><th>เข้าใช้ล่าสุด</th></tr></thead><tbody>${rows}</tbody></table></div>
        </section>
        <p class="muted small">เจ้าของบ้านเชิญสมาชิกเองได้จากแท็บ "บ้านของฉัน" · ช่างต้องมีบทบาท "ช่างติดตั้ง" จึงจะรับงานได้</p>`);
    }

    function renderWork() {
      const techs = (D.users || []).filter(u => u.role === 'technician');
      setHtml($('#view-work'), `<section class="card" style="padding:0;overflow:hidden">
          <div class="card-head" style="padding:14px 16px 0"><h2>งานช่าง</h2><button class="btn btn-small btn-primary" type="button" data-admin="job-form">+ สร้างงาน</button></div>
          ${showJobForm ? (techs.length ? `<form class="form-grid" data-form="admin-job" style="padding:12px 16px">
            <label class="field"><span>สถานที่</span><select name="site" required>${D.sites.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
            <label class="field"><span>ประเภทงาน</span><select name="type"><option value="installation">ติดตั้งใหม่</option><option value="service">ซ่อม / ตรวจเช็ค</option></select></label>
            <label class="field"><span>วันนัด</span><input name="date" type="date"></label>
            <label class="field"><span>ช่าง</span><select name="tech" required>${techs.map(t => `<option value="${esc(t.id)}">${esc(t.displayName || t.email)}</option>`).join('')}</select></label>
            <label class="field" style="grid-column:1/-1"><span>รายละเอียด</span><textarea name="notes" maxlength="1000"></textarea></label>
            <button class="btn btn-primary" type="submit">มอบหมายงาน</button></form>` : '<p class="muted" style="padding:12px 16px">ยังไม่มีบัญชีช่าง สร้างบัญชีที่มีบทบาท "ช่างติดตั้ง" ในแท็บผู้ใช้ก่อน</p>') : ''}
          <div class="table-wrap"><table class="table"><thead><tr><th>สถานที่</th><th>งาน</th><th>วันนัด</th><th>ช่าง</th><th>สถานะ</th><th></th></tr></thead><tbody>
          ${D.jobs.map(j => { const s = D.sites.find(x => x.id === j.site_id); const a = (j.job_assignments || [])[0]; return `<tr><td><strong>${esc(s ? s.name : '—')}</strong>${j.notes ? `<small style="white-space:pre-line">${esc(j.notes.slice(0, 140))}</small>` : ''}</td><td>${j.job_type === 'service' ? 'ซ่อม / ตรวจเช็ค' : 'ติดตั้งใหม่'}</td><td>${j.scheduled_for ? esc(fullDate(Date.parse(j.scheduled_for))) : '—'}</td><td>${a ? esc(userLabel(a.technician_user_id)) : '—'}</td><td><span class="tag ${j.status === 'completed' ? 'is-ok' : j.status === 'blocked' ? 'is-no' : j.status === 'cancelled' ? 'is-off' : 'is-info'}">${JOB_STATUS[j.status] || j.status}</span></td><td>${['completed', 'cancelled'].includes(j.status) ? '' : `<button class="btn btn-small" type="button" data-admin="cancel-job" data-job="${esc(j.id)}">ยกเลิก</button>`}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีงาน</td></tr>'}
          </tbody></table></div></section>`);
    }

    async function issueKey(deviceId, uid) {
      const key = randomHex(32);
      const { error } = await q(db().rpc('admin_issue_device_credential', { p_device_id: deviceId, p_credential_hash: await sha256Hex(key) }));
      if (error) { toast('ออก key ไม่สำเร็จ'); return; }
      newKey = { uid, key };
      renderOverview();
    }

    document.addEventListener('click', async evt => {
      const el = evt.target.closest('[data-admin]');
      if (!el || el.tagName === 'SELECT') return;
      const act = el.dataset.admin;
      if (act === 'refresh') loadAll();
      else if (act === 'site-form') { showSiteForm = !showSiteForm; renderOverview(); }
      else if (act === 'user-form') { showUserForm = !showUserForm; renderUsers(); }
      else if (act === 'job-form') { showJobForm = !showJobForm; renderWork(); }
      else if (act === 'view-site') { await selectSite(el.dataset.site, { quiet: true }); setTab('home'); }
      else if (act === 'manage-site') { openSite = el.dataset.site; newKey = null; renderOverview(); const p = $('#manage-panel'); if (p) p.scrollIntoView({ behavior: 'smooth' }); }
      else if (act === 'close-site') { openSite = null; newKey = null; renderOverview(); }
      else if (act === 'new-key') { if (confirm(`ออก key ใหม่ให้ ${el.dataset.uid}? key เดิมจะใช้ไม่ได้ทันที ต้องแฟลชบอร์ดใหม่`)) issueKey(el.dataset.device, el.dataset.uid); }
      else if (act === 'copy-key') { try { await navigator.clipboard.writeText(newKey.key); toast('คัดลอก key แล้ว'); } catch (e) { toast('คัดลอกไม่ได้ เลือกข้อความแล้วคัดลอกเอง'); } }
      else if (act === 'hide-key') { newKey = null; renderOverview(); }
      else if (act === 'remove-member') {
        if (!confirm('ลบผู้ใช้คนนี้ออกจากสถานที่?')) return;
        const { error } = await q(db().from('site_memberships').update({ status: 'revoked' }).eq('site_id', el.dataset.site).eq('user_id', el.dataset.user));
        toast(error ? 'ลบไม่สำเร็จ' : 'ลบแล้ว'); loadAll();
      }
      else if (act === 'cancel-job') {
        if (!confirm('ยกเลิกงานนี้?')) return;
        const { error } = await q(db().from('installation_jobs').update({ status: 'cancelled' }).eq('id', el.dataset.job));
        if (!error) await q(db().from('job_assignments').update({ assignment_status: 'cancelled' }).eq('job_id', el.dataset.job));
        toast(error ? 'ยกเลิกไม่สำเร็จ' : 'ยกเลิกงานแล้ว'); loadAll();
      }
    });

    document.addEventListener('change', async evt => {
      const el = evt.target;
      if (!el.dataset || el.dataset.admin !== 'role') return;
      const r = await api('/api/v1/admin/users', { method: 'PATCH', body: JSON.stringify({ userId: el.dataset.user, role: el.value }) }).catch(() => ({ ok: false }));
      toast(r.ok ? 'เปลี่ยนบทบาทแล้ว (มีผลเมื่อผู้ใช้เข้าสู่ระบบใหม่)' : 'เปลี่ยนบทบาทไม่สำเร็จ');
      loadUsers();
    });

    async function onSubmit(kind, form, data) {
      if (kind === 'admin-site') {
        const customer = await q(db().from('customers').insert({ name: data.customer || data.name, customer_type: data.type }).select('id').single());
        if (customer.error) { toast('บันทึกไม่สำเร็จ'); return; }
        const site = await q(db().from('sites').insert({ customer_id: customer.data.id, name: data.name, address_text: data.address || null, lifecycle_status: 'commissioning' }).select('id').single());
        if (site.error) { toast('บันทึกไม่สำเร็จ'); return; }
        showSiteForm = false; openSite = site.data.id; toast('เพิ่มสถานที่แล้ว ต่อไปเพิ่มบอร์ดและเจ้าของบ้าน');
        await loadAll();
      } else if (kind === 'admin-device') {
        const uid = String(data.uid || '').trim();
        const device = await q(db().from('devices').insert({ site_id: openSite, device_uid: uid, lifecycle_status: 'commissioning' }).select('id').single());
        if (device.error) { toast(/duplicate|unique/i.test(device.error.message || '') ? 'รหัสบอร์ดนี้มีอยู่แล้ว' : 'เพิ่มบอร์ดไม่สำเร็จ'); return; }
        const sensors = [data.mq6 ? { device_id: device.data.id, sensor_uid: 'MQ6-01', sensor_type: 'mq6' } : null, data.mq2 ? { device_id: device.data.id, sensor_uid: 'MQ2-01', sensor_type: 'mq2' } : null].filter(Boolean);
        if (sensors.length) await q(db().from('sensors').insert(sensors));
        await loadAll();
        await issueKey(device.data.id, uid);
      } else if (kind === 'admin-member') {
        const { error } = await q(db().from('site_memberships').upsert({ site_id: openSite, user_id: data.user, membership_type: data.type, status: 'active' }));
        toast(error ? 'เพิ่มไม่สำเร็จ' : 'เพิ่มเข้าสถานที่แล้ว'); loadAll();
      } else if (kind === 'admin-user') {
        const r = await api('/api/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: data.email, password: data.password, displayName: data.name, role: data.role, siteId: data.site || null, membershipType: data.type }) }).catch(() => ({ ok: false, body: {} }));
        const code = r.body && r.body.code;
        if (!r.ok) { toast(code === 'EMAIL_EXISTS' ? 'อีเมลนี้มีบัญชีแล้ว' : code === 'PASSWORD_TOO_SHORT' ? 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว' : 'สร้างบัญชีไม่สำเร็จ'); return; }
        showUserForm = false; toast('สร้างบัญชีแล้ว ส่งอีเมลและรหัสผ่านชั่วคราวให้ผู้ใช้ทางช่องทางส่วนตัว');
        await Promise.all([loadUsers(), loadAll()]);
      } else if (kind === 'admin-job') {
        const job = await q(db().from('installation_jobs').insert({ site_id: data.site, job_type: data.type, scheduled_for: data.date ? new Date(`${data.date}T09:00:00`).toISOString() : null, notes: data.notes || null, status: 'scheduled' }).select('id').single());
        if (job.error) { toast('สร้างงานไม่สำเร็จ'); return; }
        const assign = await q(db().from('job_assignments').insert({ job_id: job.data.id, technician_user_id: data.tech }));
        toast(assign.error ? 'สร้างงานแล้ว แต่มอบหมายช่างไม่สำเร็จ' : 'มอบหมายงานแล้ว');
        showJobForm = false; loadAll();
      }
    }
    const handles = kind => kind.startsWith('admin-');

    return {
      overview: { render: renderOverview, init() { loadAll(); loadUsers(); }, onSubmit: (k, f, d) => (handles(k) ? (onSubmit(k, f, d), true) : false) },
      users: { render: renderUsers },
      work: { render: renderWork }
    };
  };
}());
