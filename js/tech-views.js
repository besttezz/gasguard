(function () {
  'use strict';

  // Technician tabs: "my jobs" and the 5-step installation wizard
  //   1 board  2 Wi-Fi  3 floor plan  4 sensor test  5 hand-over (Ro values + job completed)
  // Wizard progress is kept per job in this browser so a technician can leave and come back.
  window.GasGuardViews = window.GasGuardViews || {};
  window.GasGuardViews.technician = ctx => {
    const { S, $, esc, db, q, toast, setHtml, setTab, selectSite, fmtPpm, sensorName, fullDate } = ctx;
    if (S.role !== 'technician') return {};

    const STEPS = ['สแกนบอร์ด', 'ต่อ Wi-Fi', 'วางบนแปลน', 'ทดสอบ', 'ส่งมอบ'];
    const TEST_RISE_PPM = 300;
    const TYPE = { installation: 'ติดตั้งใหม่', service: 'ซ่อม / ตรวจเช็ค' };
    const STATUS = { scheduled: ['นัดแล้ว', 'is-info'], in_progress: ['กำลังทำ', 'is-info'], blocked: ['ติดปัญหา', 'is-no'], completed: ['เสร็จแล้ว', 'is-ok'], cancelled: ['ยกเลิก', 'is-off'] };
    let jobs = null, job = null, planCtl = null, planJobId = null, scanStream = null;
    const wizKey = id => `gasguard.install.${id}`;
    const loadWiz = id => { try { return JSON.parse(localStorage.getItem(wizKey(id))) || {}; } catch (e) { return {}; } };
    const saveWiz = (id, w) => { try { localStorage.setItem(wizKey(id), JSON.stringify(w)); } catch (e) { /* ignore */ } };
    let wiz = {};

    async function loadJobs() {
      const { data } = await q(db().from('job_assignments')
        .select('assignment_status, assigned_at, installation_jobs(id, site_id, job_type, status, scheduled_for, notes, sites(id, name, address_text))')
        .eq('technician_user_id', S.user.id).order('assigned_at', { ascending: false }));
      jobs = (data || []).filter(r => r.installation_jobs && r.assignment_status !== 'cancelled')
        .map(r => ({ ...r.installation_jobs, assignment: r.assignment_status, site: r.installation_jobs.sites }));
      const seen = new Set();
      S.sites = jobs.filter(j => j.site && !seen.has(j.site.id) && seen.add(j.site.id)).map(j => ({ id: j.site.id, name: j.site.name, address: j.site.address_text }));
      ctx.renderSiteSwitch();
      const savedId = (() => { try { return localStorage.getItem('gasguard.install.current'); } catch (e) { return null; } })();
      const open = jobs.filter(j => !['completed', 'cancelled'].includes(j.status));
      job = jobs.find(j => j.id === savedId && !['completed', 'cancelled'].includes(j.status)) || open[0] || null;
      if (job) { wiz = loadWiz(job.id); await selectSite(job.site_id, { quiet: true }); }
      renderJobs();
      if (S.tab === 'install') renderInstall();
    }

    function renderJobs() {
      if (!jobs) { setHtml($('#view-jobs'), '<p class="empty">กำลังโหลดงาน…</p>'); return; }
      if (!jobs.length) { setHtml($('#view-jobs'), '<section class="card"><p class="empty">ยังไม่มีงานที่มอบหมายให้คุณ</p></section>'); return; }
      setHtml($('#view-jobs'), jobs.map(j => {
        const [label, cls] = STATUS[j.status] || [j.status, 'is-off'];
        const done = ['completed', 'cancelled'].includes(j.status);
        return `<section class="card">
          <div class="card-head"><h2>${esc(j.site ? j.site.name : 'ไม่ทราบสถานที่')}</h2><span class="tag ${cls}">${label}</span></div>
          <p class="muted">${esc(TYPE[j.job_type] || j.job_type)}${j.scheduled_for ? ` · นัด ${esc(fullDate(Date.parse(j.scheduled_for)))}` : ''}${j.site && j.site.address_text ? ` · ${esc(j.site.address_text)}` : ''}</p>
          ${j.notes ? `<p class="small" style="white-space:pre-line;margin:8px 0 0">${esc(j.notes)}</p>` : ''}
          ${done ? '' : `<div style="margin-top:12px"><button class="btn btn-primary" type="button" data-tech="open" data-job="${esc(j.id)}">${j.status === 'scheduled' ? 'เริ่มงาน' : 'ทำต่อ'}</button></div>`}
        </section>`;
      }).join(''));
    }

    // ---- Wizard ----------------------------------------------------------------------------------
    function stepReady(step, a) {
      if (step === 0) return Boolean(wiz.boardOk);
      if (step === 1) return ctx.shown().connection === 'ONLINE';
      if (step === 2) return Boolean(wiz.planOk);
      if (step === 3) return testResults(a).length > 0 && testResults(a).every(r => r.pass) && Boolean(wiz.buzzerOk);
      return true;
    }

    function testResults(a) {
      return a.sensors.map(s => {
        const base = wiz.baseline && wiz.baseline[s.id];
        const max = Math.max(wiz.max && wiz.max[s.id] != null ? wiz.max[s.id] : -Infinity, s.ppm != null ? s.ppm : -Infinity);
        return { id: s.id, base, now: s.ppm, max: Number.isFinite(max) ? max : null, health: s.health, pass: base != null && Number.isFinite(max) && max - base >= TEST_RISE_PPM };
      });
    }

    function trackTest(a) {
      if (wiz.step !== 3) return;
      wiz.baseline = wiz.baseline || {};
      wiz.max = wiz.max || {};
      let changed = false;
      for (const s of a.sensors) {
        if (s.ppm == null) continue;
        if (wiz.baseline[s.id] == null) { wiz.baseline[s.id] = s.ppm; changed = true; }
        if (wiz.max[s.id] == null || s.ppm > wiz.max[s.id]) { wiz.max[s.id] = s.ppm; changed = true; }
      }
      if (changed) saveWiz(job.id, wiz);
    }

    function stepBody(step, a) {
      const st = ctx.shown();
      if (step === 0) {
        const uids = S.devices.map(d => d.device_uid);
        return `<p class="muted">สแกน QR บนบอร์ด หรือพิมพ์รหัสบอร์ด (เช่น ESP32-KITCHEN-01) เพื่อยืนยันว่าเป็นบอร์ดของบ้านนี้</p>
          <form class="form-grid" data-form="tech-board"><label class="field"><span>รหัสบอร์ด</span><input name="uid" value="${esc(wiz.uid || '')}" autocomplete="off" required></label>
          <div style="display:flex;gap:8px">${'BarcodeDetector' in window ? '<button class="btn" type="button" data-tech="scan">สแกน QR</button>' : ''}<button class="btn btn-primary" type="submit">ตรวจสอบ</button></div></form>
          <div id="tech-scan"></div>
          ${wiz.boardOk ? `<p class="tag is-ok">บอร์ด ${esc(wiz.uid)} ลงทะเบียนกับบ้านนี้แล้ว</p>` : ''}
          ${!uids.length ? '<p class="muted small">บ้านนี้ยังไม่มีบอร์ดในระบบ ให้ผู้ดูแลระบบเพิ่มบอร์ดและออก device key ก่อน</p>' : ''}`;
      }
      if (step === 1) {
        const online = st.connection === 'ONLINE';
        return `<ol class="steps" style="--lv:var(--brand)">
            <li>ใส่ชื่อและรหัส Wi-Fi ของลูกค้า กับ device key ในไฟล์ <code>secrets.h</code> แล้วแฟลชบอร์ด</li>
            <li>เสียบไฟบอร์ด รอ 30 วินาที</li>
            <li>ถ้าดู Serial Monitor ได้ ควรเห็น <code>HTTP=202</code> ทุก 10 วินาที</li></ol>
          <div class="row"><span class="dot" style="background:${online ? 'var(--safe)' : 'var(--unknown)'}"></span><div class="row-main"><strong>${online ? 'บอร์ดออนไลน์แล้ว' : 'ยังไม่ได้รับข้อมูลจากบอร์ด'}</strong><small>${online ? 'ได้รับข้อมูลภายใน 30 วินาทีล่าสุด' : 'ตรวจไฟเลี้ยง ชื่อ/รหัส Wi-Fi และ device key'}</small></div></div>`;
      }
      if (step === 2) {
        return `<p class="muted">เลือกแบบแปลนที่ใกล้เคียงบ้านลูกค้า หรืออัปโหลดรูปแปลน แล้วลากหมุดเตา ถังแก๊ส และเซ็นเซอร์ให้ตรงตำแหน่งที่ติดจริง (เซ็นเซอร์ติดสูงจากพื้นประมาณ 30 ซม.)</p>
          <div id="tech-plan"></div>
          <label class="switch-row"><span class="row-main"><strong>วางตำแหน่งบนแปลนครบแล้ว</strong></span><input type="checkbox" data-tech="plan-ok"${wiz.planOk ? ' checked' : ''}></label>`;
      }
      if (step === 3) {
        const rows = testResults(a);
        return `<p class="muted">พ่นแก๊สจากไฟแช็ก (ไม่จุดไฟ) ห่างเซ็นเซอร์ประมาณ 10 ซม. ทีละตัว ระบบจะผ่านเมื่อค่าขึ้นอย่างน้อย ${TEST_RISE_PPM} ppm</p>
          <div class="table-wrap"><table class="table"><thead><tr><th>เซ็นเซอร์</th><th>ก่อนทดสอบ</th><th>ตอนนี้</th><th>สูงสุด</th><th>ผล</th></tr></thead><tbody>
          ${rows.map(r => `<tr><td>${esc(sensorName(r.id))}<small class="${r.health.ok ? '' : 'is-bad'}">${esc(r.health.label)}</small></td><td>${fmtPpm(r.base)}</td><td>${fmtPpm(r.now)}</td><td>${fmtPpm(r.max)}</td><td><span class="tag ${r.pass ? 'is-ok' : 'is-off'}">${r.pass ? 'ผ่าน' : 'รอทดสอบ'}</span></td></tr>`).join('') || '<tr><td colspan="5" class="empty">ยังไม่มีค่า ppm จากบอร์ด</td></tr>'}
          </tbody></table></div>
          <label class="switch-row"><span class="row-main"><strong>buzzer ที่บอร์ดส่งเสียงตอนทดสอบ</strong><small>ยืนยันด้วยการฟังที่หน้างาน</small></span><input type="checkbox" data-tech="buzzer-ok"${wiz.buzzerOk ? ' checked' : ''}></label>
          <button class="btn btn-small" type="button" data-tech="reset-test">เริ่มทดสอบใหม่</button>`;
      }
      const ids = Object.keys(st.sensorLatest || {}).length ? Object.keys(st.sensorLatest) : ['MQ6-01', 'MQ2-01'];
      return `<p class="muted">บันทึกค่า Ro ที่วัดในอากาศสะอาด (หลังอุ่นเซ็นเซอร์ครบ 24 ชม.) แล้วส่งมอบงาน</p>
        <form class="form-grid" data-form="tech-handover">
          ${ids.map(id => `<label class="field"><span>Ro ของ ${esc(sensorName(id))} (kΩ)</span><input name="ro:${esc(id)}" type="number" step="0.001" min="0.001" max="9999" inputmode="decimal"></label>`).join('')}
          <label class="field" style="grid-column:1/-1"><span>บันทึกงาน</span><textarea name="notes" maxlength="500" placeholder="เช่น ติดเซ็นเซอร์ A ใต้เคาน์เตอร์ข้างถัง, แนะนำลูกค้าเรื่องปุ่มทดสอบ"></textarea></label>
          <button class="btn btn-primary" type="submit">ส่งมอบงานให้ลูกค้า</button>
        </form>`;
    }

    function renderInstall() {
      const el = $('#view-install');
      if (!job) { setHtml(el, '<section class="card"><p class="empty">เลือกงานจากแท็บ "งานของฉัน" ก่อน</p></section>'); return; }
      const a = ctx.assessNow();
      trackTest(a);
      const step = wiz.step || 0;
      const ready = stepReady(step, a);
      setHtml(el, `<section class="card"><div class="card-head"><h2>${esc(job.site ? job.site.name : '')}</h2><span class="tag is-info">${esc(TYPE[job.job_type] || '')}</span></div>
          <ol class="stepper">${STEPS.map((n, i) => `<li class="${i < step ? 'is-done' : i === step ? 'is-current' : ''}">${i + 1}. ${n}</li>`).join('')}</ol></section>
        <section class="card"><div class="card-head"><h2>ขั้นที่ ${step + 1} · ${STEPS[step]}</h2>${step < 4 ? `<span class="tag ${ready ? 'is-ok' : 'is-off'}">${ready ? 'พร้อม' : 'ยังไม่ครบ'}</span>` : ''}</div>${stepBody(step, a)}</section>
        <div class="wizard-nav"><button class="btn" type="button" data-tech="back"${step === 0 ? ' disabled' : ''}>ย้อนกลับ</button>${step < 4 ? `<button class="btn btn-primary" type="button" data-tech="next"${ready ? '' : ' disabled'}>ถัดไป</button>` : '<span></span>'}</div>`);
      if (step === 2) {
        const host = $('#tech-plan');
        if (host && (!planCtl || planJobId !== job.id || !host.firstChild)) { planCtl = ctx.mountPlanInto(host); planJobId = job.id; }
        if (planCtl) planCtl.update(Object.fromEntries(a.sensors.map(s => [s.id, { ppm: s.ppm, level: s.level }])));
      }
    }

    async function openJob(id) {
      job = jobs.find(j => j.id === id) || null;
      if (!job) return;
      try { localStorage.setItem('gasguard.install.current', job.id); } catch (e) { /* ignore */ }
      wiz = loadWiz(job.id);
      planCtl = null;
      if (job.status === 'scheduled') {
        await q(db().rpc('set_job_progress', { p_job_id: job.id, p_status: 'in_progress', p_notes: null }));
        job.status = 'in_progress';
      }
      await selectSite(job.site_id, { quiet: true });
      setTab('install');
    }

    async function scanQr() {
      const host = $('#tech-scan');
      if (!host || !('BarcodeDetector' in window)) return;
      try {
        scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch (e) { toast('เปิดกล้องไม่ได้ พิมพ์รหัสบอร์ดแทน'); return; }
      host.innerHTML = '<video class="qr-video" playsinline muted></video><button class="btn btn-small" type="button" data-tech="scan-stop">ปิดกล้อง</button>';
      const video = host.querySelector('video');
      video.srcObject = scanStream; await video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const loop = async () => {
        if (!scanStream) return;
        const codes = await detector.detect(video).catch(() => []);
        const value = codes[0] && String(codes[0].rawValue || '').trim();
        if (value) { stopScan(); checkBoard(value.replace(/^.*[?&]device=/, '')); return; }
        requestAnimationFrame(loop);
      };
      loop();
    }
    function stopScan() {
      if (scanStream) scanStream.getTracks().forEach(t => t.stop());
      scanStream = null;
      const host = $('#tech-scan'); if (host) host.innerHTML = '';
    }

    function checkBoard(uid) {
      uid = String(uid || '').trim();
      const device = S.devices.find(d => d.device_uid === uid);
      wiz.uid = uid; wiz.boardOk = Boolean(device);
      saveWiz(job.id, wiz);
      if (device) { S.device = { id: device.id, uid: device.device_uid }; S.real = null; toast('ยืนยันบอร์ดแล้ว'); }
      else toast('บอร์ดนี้ยังไม่ได้ลงทะเบียนกับบ้านนี้ ติดต่อผู้ดูแลระบบ');
      $('#view-install').__html = null;
      renderInstall();
    }

    document.addEventListener('click', async evt => {
      const el = evt.target.closest('[data-tech]');
      if (!el) return;
      const act = el.dataset.tech;
      if (act === 'open') openJob(el.dataset.job);
      else if (act === 'next') { wiz.step = Math.min(4, (wiz.step || 0) + 1); saveWiz(job.id, wiz); renderInstall(); window.scrollTo(0, 0); }
      else if (act === 'back') { wiz.step = Math.max(0, (wiz.step || 0) - 1); saveWiz(job.id, wiz); renderInstall(); window.scrollTo(0, 0); }
      else if (act === 'scan') scanQr();
      else if (act === 'scan-stop') stopScan();
      else if (act === 'reset-test') { wiz.baseline = {}; wiz.max = {}; saveWiz(job.id, wiz); renderInstall(); }
    });
    document.addEventListener('change', evt => {
      const el = evt.target.closest('[data-tech]');
      if (!el || !job) return;
      if (el.dataset.tech === 'plan-ok') { wiz.planOk = el.checked; saveWiz(job.id, wiz); renderInstall(); }
      if (el.dataset.tech === 'buzzer-ok') { wiz.buzzerOk = el.checked; saveWiz(job.id, wiz); renderInstall(); }
    });

    async function handover(data) {
      const rows = Object.entries(data).filter(([k, v]) => k.startsWith('ro:') && v !== '' && Number(v) > 0)
        .map(([k, v]) => ({ device_id: S.device && S.device.id, sensor_uid: k.slice(3), ro_kohm: Number(v), measured_by: S.user.id }));
      if (!S.device) { toast('ยังไม่ได้ยืนยันบอร์ด'); return; }
      if (rows.length) {
        const { error } = await q(db().from('sensor_calibrations').insert(rows));
        if (error) { toast('บันทึกค่า Ro ไม่สำเร็จ'); return; }
      }
      const { error } = await q(db().rpc('set_job_progress', { p_job_id: job.id, p_status: 'completed', p_notes: data.notes || null }));
      if (error) { toast('ปิดงานไม่สำเร็จ'); return; }
      try { localStorage.removeItem(wizKey(job.id)); localStorage.removeItem('gasguard.install.current'); } catch (e) { /* ignore */ }
      toast('ส่งมอบงานเรียบร้อย');
      job = null; wiz = {};
      await loadJobs();
      setTab('jobs');
    }

    const views = {
      jobs: { render: renderJobs, init: loadJobs },
      install: {
        live: true,
        render: renderInstall,
        onSubmit(kind, form, data) {
          if (kind === 'tech-board') { checkBoard(data.uid); return true; }
          if (kind === 'tech-handover') { handover(data); return true; }
          return false;
        }
      }
    };
    return views;
  };
}());
