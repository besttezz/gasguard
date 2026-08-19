/* ============================================================
   GasGuard v2 — ui.js
   การแสดงผลทุกหน้า, นำทาง, ฟอร์มตั้งค่า, จัดการเซ็นเซอร์
   ============================================================ */
(function () {
  'use strict';

  const GG = window.GG;
  const { store, bus, util, alerts, charts } = GG;
  const $ = (id) => document.getElementById(id);

  const PAGE_META = {
    dashboard: { title: 'แดชบอร์ด', subtitle: 'ภาพรวมระบบตรวจจับแก๊สรั่ว' },
    realtime: { title: 'ตรวจวัดเรียลไทม์', subtitle: 'กราฟแสดงค่าแก๊สแบบเรียลไทม์' },
    alerts: { title: 'การแจ้งเตือน', subtitle: 'รายการแจ้งเตือนและระดับความปลอดภัย' },
    statistics: { title: 'สถิติ', subtitle: 'วิเคราะห์ข้อมูล 7 วันล่าสุด' },
    history: { title: 'ประวัติเหตุการณ์', subtitle: 'บันทึกเหตุการณ์ทั้งหมดในระบบ' },
    sensors: { title: 'จัดการเซ็นเซอร์', subtitle: 'เพิ่ม แก้ไข หรือลบจุดตรวจวัด' },
    settings: { title: 'ตั้งค่า', subtitle: 'แหล่งข้อมูล เกณฑ์เตือน และการแจ้งเตือน' },
    help: { title: 'คู่มือใช้งาน', subtitle: 'วิธีใช้งานและการต่ออุปกรณ์จริง' }
  };

  const ui = {
    currentPage: 'dashboard',
    historyLimit: 20,

    /* =============== INIT =============== */
    init() {
      this.bindNav();
      this.bindTopbar();
      this.bindSensorModal();
      this.bindSettingsForm();
      this.bindHistoryControls();
      this.bindAlertsPage();
      this.bindModals();
      this.applyTheme(store.settings.theme, true);
      this.fillSettingsForm();
      this.renderAll();
      this.startClock();

      bus.on('reading', () => this.throttledRefresh());
      bus.on('event', () => { this.renderAlerts(); this.renderTimeline(); this.updateBadges(); });
      bus.on('sensors', () => { this.renderSensorCards(); this.renderSensorDetails(); this.renderSensorManage(); this.fillHistorySensorFilter(); charts.updateTrend(); });
      bus.on('conn', (s) => this.renderConnStatus(s));
      bus.on('conn-log', () => this.renderConnLog());
      bus.on('mute', () => this.updateMuteButton());

      window.addEventListener('resize', util.debounce(() => {
        charts.applyDefaults();
        Object.values(charts.inst).forEach(c => c.resize());
      }, 250));
    },

    /* =============== NAVIGATION =============== */
    bindNav() {
      document.querySelectorAll('[data-page]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          this.navigate(el.dataset.page);
        });
      });
      $('menu-btn').addEventListener('click', () => this.toggleSidebar(true));
      $('sidebar-close').addEventListener('click', () => this.toggleSidebar(false));
      $('scrim').addEventListener('click', () => this.toggleSidebar(false));
      window.addEventListener('hashchange', () => {
        const p = location.hash.replace('#', '');
        if (PAGE_META[p] && p !== this.currentPage) this.navigate(p);
      });
    },

    navigate(page) {
      if (!PAGE_META[page]) page = 'dashboard';
      this.currentPage = page;

      document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
      document.querySelectorAll('.bn-item').forEach(l => l.classList.toggle('active', l.dataset.page === page));
      document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));

      $('page-title').textContent = PAGE_META[page].title;
      $('page-subtitle').textContent = PAGE_META[page].subtitle;
      if (location.hash !== '#' + page) history.replaceState(null, '', '#' + page);

      this.toggleSidebar(false);
      $('page-wrap').scrollTop = 0;
      window.scrollTo(0, 0);

      if (page === 'realtime') { charts.initRealtime(); charts.initZone(); }
      if (page === 'statistics') this.renderStats();
      if (page === 'dashboard') { charts.updateTrend(); this.refreshDashboard(); }
      if (page === 'history') this.renderTimeline();
      if (page === 'sensors') this.renderSensorManage();
      if (page === 'settings') this.updateStorageInfo();
    },

    toggleSidebar(open) {
      const sb = $('sidebar'), scrim = $('scrim');
      if (open === undefined) open = !sb.classList.contains('open');
      sb.classList.toggle('open', open);
      scrim.hidden = !open;
      document.body.classList.toggle('no-scroll', open && window.innerWidth < 1100);
    },

    /* =============== TOPBAR =============== */
    bindTopbar() {
      $('btn-theme').addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        store.settings.theme = next; store.saveSettings();
        this.applyTheme(next);
        const sel = $('theme-select'); if (sel) sel.value = next;
      });

      $('btn-mute').addEventListener('click', () => {
        if (alerts.isMuted()) { alerts.unmute(); this.toast('safe', 'เปิดเสียงแล้ว', 'ระบบจะส่งเสียงเมื่อเกิดเหตุ'); }
        else { alerts.mute(30); this.toast('warning', 'ปิดเสียง 30 นาที', 'ยังบันทึกเหตุการณ์และแจ้งเตือนบนหน้าจอตามปกติ'); }
      });

      $('notification-btn').addEventListener('click', () => this.navigate('alerts'));
      $('btn-logout').addEventListener('click', () => GG.app.logout());
    },

    startClock() {
      const tick = () => {
        const now = new Date();
        const el = $('datetime');
        if (el) el.innerHTML = `<span class="dt-date">${util.formatDate(now)}</span><span class="dt-time">${util.formatTime(now)}</span>`;
      };
      tick(); setInterval(tick, 1000);
    },

    /* =============== RENDER ALL =============== */
    renderAll() {
      this.renderSensorCards();
      this.renderSensorDetails();
      this.renderSensorManage();
      this.renderAlertLevels();
      this.renderAlerts();
      this.renderTimeline();
      this.fillHistorySensorFilter();
      this.renderGaugeLegend();
      this.updateBadges();
      this.updateMuteButton();
      this.refreshDashboard();
    },

    throttledRefresh: null,   // assigned after object creation

    /* =============== DASHBOARD =============== */
    renderGaugeLegend() {
      const t = store.settings.thresholds;
      const el = $('gauge-legend');
      if (!el) return;
      el.innerHTML = `
        <div class="legend-item"><span class="legend-dot safe"></span><span>0-${t.warning - 1} ปลอดภัย</span></div>
        <div class="legend-item"><span class="legend-dot warning"></span><span>${t.warning}-${t.danger - 1} เฝ้าระวัง</span></div>
        <div class="legend-item"><span class="legend-dot danger"></span><span>${t.danger}+ อันตราย</span></div>`;
    },

    renderSensorCards() {
      const wrap = $('status-cards');
      if (!wrap) return;
      const sensors = store.enabledSensors();
      if (!sensors.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-microchip"></i>
          <p>ยังไม่มีเซ็นเซอร์</p><button class="btn-primary sm" onclick="GG.ui.navigate('sensors')">เพิ่มเซ็นเซอร์</button></div>`;
        return;
      }
      wrap.innerHTML = sensors.map(s => {
        const live = store.live[s.devId] || {};
        const st = live.online ? store.statusOf(live.ppm, s) : 'offline';
        const max = Number(store.settings.thresholds.scaleMax) || 1000;
        const pct = live.ppm != null ? util.clamp((live.ppm / max) * 100, 0, 100) : 0;
        return `
        <div class="status-card ${st}" data-dev="${util.escapeHtml(s.devId)}">
          <div class="card-header">
            <div class="card-icon"><i class="fas fa-location-dot"></i></div>
            <div class="card-status-tag ${st}"><i class="fas ${alerts.icon(st)}"></i> ${alerts.label(st)}</div>
          </div>
          <div class="card-body">
            <h3>${util.escapeHtml(s.name)}</h3>
            <p class="card-location">${util.escapeHtml(s.location || '—')}</p>
            <div class="card-value">
              <span class="value">${live.ppm != null ? live.ppm : '–'}</span><span class="unit">PPM</span>
            </div>
            <p class="card-meta">${live.t ? 'อัปเดต ' + util.relative(live.t) : 'ยังไม่ได้รับข้อมูล'} · ${util.escapeHtml(s.type || '')}</p>
          </div>
          <div class="card-progress"><div class="progress-bar"><div class="progress-fill ${st}" style="width:${pct}%"></div></div></div>
        </div>`;
      }).join('');
    },

    updateSensorCards() {
      const sensors = store.enabledSensors();
      const max = Number(store.settings.thresholds.scaleMax) || 1000;
      sensors.forEach(s => {
        const card = document.querySelector(`.status-card[data-dev="${CSS.escape(s.devId)}"]`);
        if (!card) return;
        const live = store.live[s.devId] || {};
        const st = live.online ? store.statusOf(live.ppm, s) : 'offline';
        card.className = `status-card ${st}`;
        const tag = card.querySelector('.card-status-tag');
        tag.className = `card-status-tag ${st}`;
        tag.innerHTML = `<i class="fas ${alerts.icon(st)}"></i> ${alerts.label(st)}`;
        card.querySelector('.value').textContent = live.ppm != null ? live.ppm : '–';
        card.querySelector('.card-meta').textContent =
          (live.t ? 'อัปเดต ' + util.relative(live.t) : 'ยังไม่ได้รับข้อมูล') + ' · ' + (s.type || '');
        const fill = card.querySelector('.progress-fill');
        fill.className = `progress-fill ${st}`;
        fill.style.width = util.clamp(((live.ppm || 0) / max) * 100, 0, 100) + '%';
      });
    },

    refreshDashboard() {
      const sensors = store.enabledSensors();
      const vals = sensors.map(s => store.live[s.devId]).filter(l => l && l.online && l.ppm != null);
      const avg = vals.length ? vals.reduce((a, l) => a + l.ppm, 0) / vals.length : 0;
      const max = vals.length ? Math.max.apply(null, vals.map(l => l.ppm)) : 0;

      const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      setText('kpi-avg', vals.length ? Math.round(avg) : '–');
      setText('kpi-max', vals.length ? max : '–');
      setText('kpi-alerts', store.alertsToday());
      setText('kpi-online', `${vals.length}/${sensors.length}`);

      let s = 0, w = 0, d = 0;
      sensors.forEach(sn => {
        const l = store.live[sn.devId];
        if (!l || !l.online) return;
        const st = store.statusOf(l.ppm, sn);
        if (st === 'danger') d++; else if (st === 'warning') w++; else s++;
      });
      setText('sum-safe', s); setText('sum-warning', w); setText('sum-danger', d); setText('sum-total', sensors.length);

      charts.updateGauge(avg);
      this.updateSensorCards();
    },

    /* =============== REALTIME =============== */
    renderSensorDetails() {
      const wrap = $('sensor-details');
      if (!wrap) return;
      const sensors = store.enabledSensors();
      if (!sensors.length) { wrap.innerHTML = '<p class="hint-text">ยังไม่มีเซ็นเซอร์</p>'; return; }
      wrap.innerHTML = sensors.map(s => {
        const l = store.live[s.devId] || {};
        const st = l.online ? store.statusOf(l.ppm, s) : 'offline';
        return `
        <div class="sensor-row" data-dev="${util.escapeHtml(s.devId)}">
          <div class="sensor-info">
            <span class="sensor-name">${util.escapeHtml(s.name)}</span>
            <span class="sensor-loc">${util.escapeHtml(s.location || '—')}</span>
          </div>
          <div class="sensor-reading ${st}"><span class="rd">${l.ppm != null ? l.ppm : '–'}</span> PPM</div>
          <div class="sensor-temp"><i class="fas fa-temperature-half"></i> <span class="tp">${l.temp != null ? l.temp : '–'}</span>°C</div>
          <div class="sensor-humidity"><i class="fas fa-droplet"></i> <span class="hm">${l.hum != null ? l.hum : '–'}</span>%</div>
        </div>`;
      }).join('');
    },

    updateSensorDetails() {
      store.enabledSensors().forEach(s => {
        const row = document.querySelector(`.sensor-row[data-dev="${CSS.escape(s.devId)}"]`);
        if (!row) return;
        const l = store.live[s.devId] || {};
        const st = l.online ? store.statusOf(l.ppm, s) : 'offline';
        const rd = row.querySelector('.sensor-reading');
        rd.className = `sensor-reading ${st}`;
        row.querySelector('.rd').textContent = l.ppm != null ? l.ppm : '–';
        row.querySelector('.tp').textContent = l.temp != null ? l.temp : '–';
        row.querySelector('.hm').textContent = l.hum != null ? l.hum : '–';
      });
    },

    /* =============== ALERTS =============== */
    renderAlertLevels() {
      const el = $('alert-levels');
      if (!el) return;
      const t = store.settings.thresholds;
      const counts = { safe: 0, warning: 0, danger: 0 };
      store.enabledSensors().forEach(s => {
        const l = store.live[s.devId];
        if (l && l.online) counts[store.statusOf(l.ppm, s)]++;
      });
      const rows = [
        { k: 'safe', name: 'ปลอดภัย', range: `0 - ${t.warning - 1} PPM`, desc: 'ระดับแก๊สปกติ ไม่มีอันตราย' },
        { k: 'warning', name: 'เฝ้าระวัง', range: `${t.warning} - ${t.danger - 1} PPM`, desc: 'ตรวจพบแก๊สเกินปกติ ควรตรวจสอบ' },
        { k: 'danger', name: 'อันตราย', range: `${t.danger} PPM ขึ้นไป`, desc: 'อันตราย! ปิดวาล์วและอพยพทันที' }
      ];
      el.innerHTML = rows.map(r => `
        <div class="alert-level-card ${r.k} ${counts[r.k] ? 'active-level' : ''}">
          <div class="level-icon"><i class="fas ${alerts.icon(r.k)}"></i></div>
          <h4>${r.name}</h4>
          <p>${r.range}</p>
          <span class="level-desc">${r.desc}</span>
          <span class="level-count">${counts[r.k]} จุดขณะนี้</span>
        </div>`).join('');
    },

    renderAlerts() {
      const list = $('alerts-list');
      if (!list) return;
      const data = store.events.slice(0, 60);
      if (!data.length) {
        list.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i><p>ยังไม่มีการแจ้งเตือน</p></div>`;
        return;
      }
      list.innerHTML = data.map((a, i) => `
        <div class="alert-item ${a.level} ${a.read ? 'read' : ''}" style="animation-delay:${Math.min(i, 10) * 0.03}s">
          <div class="alert-icon"><i class="fas ${alerts.icon(a.level)}"></i></div>
          <div class="alert-content">
            <div class="alert-title">${util.escapeHtml(a.title)}</div>
            <div class="alert-desc">${util.escapeHtml(a.text || '')}</div>
          </div>
          <div class="alert-time">${util.formatTime(a.t)}<span>${util.formatDateShort(a.t)}</span></div>
        </div>`).join('');
    },

    bindAlertsPage() {
      $('clear-alerts').addEventListener('click', () => {
        store.markAllRead();
        this.toast('safe', 'อ่านทั้งหมดแล้ว', 'ทำเครื่องหมายการแจ้งเตือนทั้งหมดว่าอ่านแล้ว');
      });
      $('btn-test-alert').addEventListener('click', () => {
        const s = store.enabledSensors()[0];
        if (!s) { this.toast('warning', 'ยังไม่มีเซ็นเซอร์', 'เพิ่มเซ็นเซอร์ก่อนทดสอบ'); return; }
        const ppm = (store.thresholdsFor(s).danger || 600) + 120;
        alerts.fire(s, { ppm, t: Date.now() }, 'danger', 'safe');
      });
    },

    updateBadges() {
      const n = store.unreadCount();
      [['alert-badge', 'badge'], ['bn-badge', 'bn-badge']].forEach(([id]) => {
        const el = $(id);
        if (!el) return;
        el.textContent = n > 99 ? '99+' : n;
        el.hidden = n === 0;
      });
      const dot = $('notification-dot');
      if (dot) dot.hidden = n === 0;
    },

    updateMuteButton() {
      const btn = $('btn-mute');
      if (!btn) return;
      const muted = alerts.isMuted() || !store.settings.notify.sound;
      btn.innerHTML = `<i class="fas ${muted ? 'fa-volume-xmark' : 'fa-volume-high'}"></i>`;
      btn.classList.toggle('muted', muted);
    },

    /* =============== STATISTICS =============== */
    renderStats() {
      const stats = charts.initStats();
      if (!stats) return;
      const days = stats.filter(d => d.count > 0);
      const avg = days.length ? Math.round(days.reduce((a, d) => a + d.avg, 0) / days.length) : 0;
      const max = stats.reduce((a, d) => Math.max(a, d.max), 0);
      const alertCount = stats.reduce((a, d) => a + d.alerts, 0);
      const totalSamples = stats.reduce((a, d) => a + d.count, 0);
      const safeSamples = stats.reduce((a, d) => a + d.safe, 0);
      const warnSamples = stats.reduce((a, d) => a + d.warn, 0);
      const dangerSamples = stats.reduce((a, d) => a + d.danger, 0);

      const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      setText('stat-range', `${util.formatDateShort(stats[0].date)} - ${util.formatDateShort(stats[stats.length - 1].date)}`);
      setText('stat-avg', totalSamples ? avg : '–');
      setText('stat-max', totalSamples ? max : '–');
      setText('stat-alerts', alertCount);

      // ความพร้อมใช้ = สัดส่วนวันที่มีข้อมูล นับตั้งแต่วันแรกที่ระบบเริ่มเก็บ
      const firstIdx = stats.findIndex(d => d.count > 0);
      const windowDays = firstIdx >= 0 ? stats.length - firstIdx : 0;
      const uptime = windowDays ? Math.round(days.length / windowDays * 100) : 0;
      setText('stat-uptime', totalSamples ? uptime + '%' : '–');

      // วิเคราะห์ความปลอดภัย
      const pct = (n) => totalSamples ? Math.round(n / totalSamples * 100) : 0;
      const safePct = pct(safeSamples), warnPct = pct(warnSamples), dangerPct = pct(dangerSamples);
      const score = util.clamp(Math.round(100 - warnPct * 0.6 - dangerPct * 2), 0, 100);

      // เวลาตอบสนอง: เวลาจากเหตุอันตราย → กลับสู่ปลอดภัยของเซ็นเซอร์เดียวกัน
      const respTimes = [];
      const evs = store.events.slice().sort((a, b) => a.t - b.t);
      const open = {};
      evs.forEach(e => {
        if (!e.sensorId) return;
        if (e.level === 'danger' || e.level === 'warning') { if (!open[e.sensorId]) open[e.sensorId] = e.t; }
        else if (e.level === 'safe' && open[e.sensorId]) { respTimes.push(e.t - open[e.sensorId]); delete open[e.sensorId]; }
      });
      const respAvg = respTimes.length ? respTimes.reduce((a, b) => a + b, 0) / respTimes.length / 60000 : null;

      const warnFreq = stats.reduce((a, d) => a + (d.warn > 0 ? 1 : 0), 0);
      const dangerFreq = stats.reduce((a, d) => a + (d.danger > 0 ? 1 : 0), 0);
      const freqLabel = (n) => n === 0 ? 'ไม่พบ' : n <= 2 ? 'ต่ำ' : n <= 4 ? 'ปานกลาง' : 'สูง';
      const freqClass = (n) => n === 0 || n <= 2 ? 'good' : n <= 4 ? 'moderate' : 'bad';

      const rows = [
        { label: 'ดัชนีความปลอดภัยรวม', value: score + '/100', cls: score >= 75 ? 'good' : score >= 50 ? 'moderate' : 'bad', width: score },
        { label: 'สัดส่วนเวลาปลอดภัย', value: safePct + '%', cls: safePct >= 80 ? 'good' : safePct >= 60 ? 'moderate' : 'bad', width: safePct },
        { label: 'ความถี่เหตุเฝ้าระวัง', value: freqLabel(warnFreq), cls: freqClass(warnFreq), width: Math.min(100, warnFreq / 7 * 100) },
        { label: 'ความถี่เหตุอันตราย', value: freqLabel(dangerFreq), cls: freqClass(dangerFreq), width: Math.min(100, dangerFreq / 7 * 100) },
        { label: 'เวลากลับสู่ปกติเฉลี่ย', value: respAvg == null ? 'ยังไม่มีข้อมูล' : respAvg.toFixed(1) + ' นาที', cls: respAvg == null ? 'moderate' : respAvg <= 5 ? 'good' : 'moderate', width: respAvg == null ? 5 : util.clamp(100 - respAvg * 6, 10, 100) }
      ];

      // เซ็นเซอร์ที่ควรตรวจสอบ
      let worst = null;
      store.enabledSensors().forEach(s => {
        let dangerCount = 0;
        stats.forEach(d => { const key = d.key; const day = store.daily[key]; if (day && day[s.devId]) dangerCount += day[s.devId].danger; });
        if (!worst || dangerCount > worst.count) worst = { sensor: s, count: dangerCount };
      });

      const el = $('safety-analysis');
      if (el) {
        el.innerHTML = rows.map(r => `
          <div class="analysis-item">
            <div class="analysis-header"><span>${r.label}</span><span class="analysis-score ${r.cls}">${r.value}</span></div>
            <div class="analysis-bar"><div class="analysis-fill ${r.cls}" style="width:${r.width}%"></div></div>
          </div>`).join('') + `
          <div class="analysis-summary">
            <i class="fas fa-lightbulb"></i>
            <p><strong>สรุป:</strong> ${totalSamples
              ? `ช่วง 7 วันที่ผ่านมามีข้อมูล ${totalSamples.toLocaleString('th-TH')} ค่า · อยู่ในระดับปลอดภัย ${safePct}% ของเวลา · แจ้งเตือน ${alertCount} ครั้ง${worst && worst.count ? ` · ควรตรวจสอบ <strong>${util.escapeHtml(worst.sensor.name)}</strong> เป็นพิเศษ` : ''}`
              : 'ยังไม่มีข้อมูลสะสมเพียงพอ ระบบจะเริ่มสรุปให้หลังเก็บข้อมูลสักระยะ'}</p>
          </div>`;
      }

      this._lastStats = stats;
    },

    exportStatsCsv() {
      const stats = this._lastStats || store.weeklyStats(7);
      const sensors = store.enabledSensors();
      const head = ['วันที่', 'เฉลี่ย(PPM)', 'สูงสุด(PPM)', 'ต่ำสุด(PPM)', 'จำนวนค่าที่วัด', 'ปลอดภัย', 'เฝ้าระวัง', 'อันตราย', 'แจ้งเตือน']
        .concat(sensors.map(s => s.name + '(เฉลี่ย)'));
      const rows = [head].concat(stats.map(d => [
        d.key, d.avg, d.max, d.min, d.count, d.safe, d.warn, d.danger, d.alerts
      ].concat(sensors.map(s => d.perSensor[s.devId] || 0))));
      util.download(`gasguard-stats-${util.dayKey(Date.now())}.csv`, util.csv(rows), 'text/csv;charset=utf-8');
      this.toast('safe', 'ส่งออกสำเร็จ', 'ดาวน์โหลดไฟล์ CSV แล้ว');
    },

    /* =============== HISTORY =============== */
    bindHistoryControls() {
      ['history-filter', 'history-sensor', 'history-range'].forEach(id =>
        $(id).addEventListener('change', () => { this.historyLimit = 20; this.renderTimeline(); }));
      $('history-search').addEventListener('input', util.debounce(() => { this.historyLimit = 20; this.renderTimeline(); }, 250));
      $('btn-load-more').addEventListener('click', () => { this.historyLimit += 30; this.renderTimeline(); });
      $('btn-export-history').addEventListener('click', () => this.exportHistoryCsv());
      $('btn-clear-history').addEventListener('click', async () => {
        if (await this.confirm('ล้างประวัติทั้งหมด?', 'เหตุการณ์ที่บันทึกไว้จะถูกลบถาวร (ข้อมูลกราฟยังอยู่)')) {
          store.clearEvents();
          this.toast('safe', 'ล้างประวัติแล้ว', 'ระบบเริ่มบันทึกเหตุการณ์ใหม่');
        }
      });
      $('btn-export-stats').addEventListener('click', () => this.exportStatsCsv());
    },

    fillHistorySensorFilter() {
      const sel = $('history-sensor');
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="all">ทุกเซ็นเซอร์</option>' +
        store.sensors.map(s => `<option value="${util.escapeHtml(s.devId)}">${util.escapeHtml(s.name)}</option>`).join('');
      if (cur) sel.value = cur;
    },

    filteredHistory() {
      const level = $('history-filter').value;
      const dev = $('history-sensor').value;
      const range = Number($('history-range').value);
      const q = ($('history-search').value || '').trim().toLowerCase();
      const since = range ? Date.now() - range * 86400000 : 0;
      return store.events.filter(e => {
        if (since && e.t < since) return false;
        if (level !== 'all' && e.level !== level) return false;
        if (dev !== 'all' && e.sensorId !== dev) return false;
        if (q) {
          const hay = `${e.title} ${e.text || ''} ${e.sensorName || ''}`.toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
    },

    renderTimeline() {
      const wrap = $('timeline');
      if (!wrap) return;
      const all = this.filteredHistory();
      const shown = all.slice(0, this.historyLimit);
      if (!shown.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-clock-rotate-left"></i><p>ไม่พบเหตุการณ์ตามเงื่อนไข</p></div>`;
        $('btn-load-more').hidden = true;
        return;
      }
      wrap.innerHTML = shown.map(e => `
        <div class="timeline-item ${e.level}">
          <div class="timeline-dot"></div>
          <div class="timeline-header">
            <span class="timeline-tag">${alerts.label(e.level)}</span>
            <span class="timeline-time">${util.formatDateTime(e.t)}</span>
          </div>
          <p class="timeline-text"><strong>${util.escapeHtml(e.title)}</strong> — ${util.escapeHtml(e.text || '')}</p>
        </div>`).join('');
      $('btn-load-more').hidden = all.length <= shown.length;
    },

    exportHistoryCsv() {
      const rows = [['เวลา', 'ระดับ', 'เซ็นเซอร์', 'PPM', 'หัวข้อ', 'รายละเอียด']].concat(
        this.filteredHistory().map(e => [
          new Date(e.t).toLocaleString('th-TH'), alerts.label(e.level),
          e.sensorName || e.sensorId || '-', e.ppm != null ? e.ppm : '', e.title, e.text || ''
        ]));
      util.download(`gasguard-history-${util.dayKey(Date.now())}.csv`, util.csv(rows), 'text/csv;charset=utf-8');
      this.toast('safe', 'ส่งออกสำเร็จ', `บันทึก ${rows.length - 1} เหตุการณ์เป็นไฟล์ CSV`);
    },

    /* =============== SENSOR MANAGEMENT =============== */
    renderSensorManage() {
      const wrap = $('sensor-manage-list');
      if (!wrap) return;
      if (!store.sensors.length) {
        wrap.innerHTML = `<div class="empty-state"><i class="fas fa-microchip"></i><p>ยังไม่มีเซ็นเซอร์ในระบบ</p></div>`;
        return;
      }
      wrap.innerHTML = store.sensors.map(s => {
        const l = store.live[s.devId] || {};
        const st = l.online ? store.statusOf(l.ppm, s) : 'offline';
        const th = store.thresholdsFor(s);
        return `
        <div class="manage-row ${s.enabled === false ? 'disabled' : ''}">
          <div class="manage-main">
            <div class="manage-title">
              <span class="dot ${st}"></span>
              <strong>${util.escapeHtml(s.name)}</strong>
              <code>${util.escapeHtml(s.devId)}</code>
              ${s.enabled === false ? '<span class="chip">ปิดใช้งาน</span>' : ''}
            </div>
            <div class="manage-meta">
              <span><i class="fas fa-location-dot"></i> ${util.escapeHtml(s.location || '—')}</span>
              <span><i class="fas fa-flask"></i> ${util.escapeHtml(s.type || '-')}</span>
              <span><i class="fas fa-sliders"></i> เตือน ${th.warn} / อันตราย ${th.danger} PPM</span>
              <span><i class="fas fa-gauge-high"></i> ${l.ppm != null ? l.ppm + ' PPM' : 'ไม่มีข้อมูล'}</span>
            </div>
          </div>
          <div class="manage-actions">
            <button class="icon-btn ghost" data-edit="${util.escapeHtml(s.uid)}" title="แก้ไข"><i class="fas fa-pen"></i></button>
            <button class="icon-btn ghost danger-text" data-del="${util.escapeHtml(s.uid)}" title="ลบ"><i class="fas fa-trash"></i></button>
          </div>
        </div>`;
      }).join('');

      wrap.querySelectorAll('[data-edit]').forEach(b =>
        b.addEventListener('click', () => this.openSensorModal(b.dataset.edit)));
      wrap.querySelectorAll('[data-del]').forEach(b =>
        b.addEventListener('click', async () => {
          const s = store.sensors.find(x => x.uid === b.dataset.del);
          if (!s) return;
          if (await this.confirm('ลบเซ็นเซอร์?', `ต้องการลบ "${s.name}" ออกจากระบบใช่หรือไม่`)) {
            store.removeSensor(s.uid);
            store.addEvent({ level: 'system', title: 'ลบเซ็นเซอร์', text: `ลบ "${s.name}" (${s.devId}) ออกจากระบบ` });
            this.toast('safe', 'ลบแล้ว', `ลบ ${s.name} เรียบร้อย`);
          }
        }));
    },

    bindSensorModal() {
      $('btn-add-sensor').addEventListener('click', () => this.openSensorModal());
      $('sensor-modal-close').addEventListener('click', () => this.closeSensorModal());
      $('sensor-cancel').addEventListener('click', () => this.closeSensorModal());
      $('sensor-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const uid = $('sensor-uid').value;
        const devId = $('sensor-devid').value.trim();
        if (!devId) return;
        const dup = store.sensors.find(s => s.devId === devId && s.uid !== uid);
        if (dup) { this.toast('warning', 'รหัสอุปกรณ์ซ้ำ', `มีเซ็นเซอร์ "${dup.name}" ใช้รหัสนี้แล้ว`); return; }
        const data = {
          uid: uid || util.uid('sn'),
          name: $('sensor-name').value.trim() || devId,
          devId,
          location: $('sensor-location').value.trim(),
          type: $('sensor-type').value,
          warn: $('sensor-warn').value === '' ? null : Number($('sensor-warn').value),
          danger: $('sensor-danger').value === '' ? null : Number($('sensor-danger').value),
          offset: Number($('sensor-offset').value) || 0,
          simLevel: $('sensor-sim').value,
          enabled: $('sensor-enabled').checked
        };
        store.upsertSensor(data);
        store.addEvent({ level: 'system', title: uid ? 'แก้ไขเซ็นเซอร์' : 'เพิ่มเซ็นเซอร์', text: `${data.name} (${data.devId})` });
        this.closeSensorModal();
        this.toast('safe', 'บันทึกแล้ว', `บันทึกข้อมูล ${data.name} เรียบร้อย`);
        charts.destroy('realtime'); charts.destroy('zone');
        if (this.currentPage === 'realtime') { charts.initRealtime(); charts.initZone(); }
      });
    },

    openSensorModal(uid) {
      const s = uid ? store.sensors.find(x => x.uid === uid) : null;
      $('sensor-modal-title').textContent = s ? 'แก้ไขเซ็นเซอร์' : 'เพิ่มเซ็นเซอร์';
      $('sensor-uid').value = s ? s.uid : '';
      $('sensor-name').value = s ? s.name : '';
      $('sensor-devid').value = s ? s.devId : '';
      $('sensor-location').value = s ? (s.location || '') : '';
      $('sensor-type').value = s ? (s.type || 'LPG') : 'LPG';
      $('sensor-warn').value = s && s.warn != null ? s.warn : '';
      $('sensor-danger').value = s && s.danger != null ? s.danger : '';
      $('sensor-offset').value = s ? (s.offset || 0) : 0;
      $('sensor-sim').value = s ? (s.simLevel || 'low') : 'low';
      $('sensor-enabled').checked = s ? s.enabled !== false : true;
      const m = $('sensor-modal');
      m.hidden = false;
      requestAnimationFrame(() => m.classList.add('show'));
    },

    closeSensorModal() {
      const m = $('sensor-modal');
      m.classList.remove('show');
      setTimeout(() => { m.hidden = true; }, 220);
    },

    /* =============== SETTINGS =============== */
    fillSettingsForm() {
      const s = store.settings;
      const set = (id, v) => { const el = $(id); if (el) el.value = v; };
      const chk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };

      set('threshold-warning', s.thresholds.warning);
      set('threshold-danger', s.thresholds.danger);
      set('scale-max', s.thresholds.scaleMax);
      set('debounce-count', s.thresholds.debounce);
      set('hysteresis', s.thresholds.hysteresis);
      set('offline-timeout', s.thresholds.offlineTimeout);

      chk('toggle-sound', s.notify.sound);
      set('siren-volume', Math.round((s.notify.volume || 0.7) * 100));
      chk('toggle-warn-sound', s.notify.warnSound);
      chk('toggle-vibrate', s.notify.vibrate);
      chk('toggle-push', s.notify.push);
      chk('toggle-modal', s.notify.modal);
      set('webhook-url', s.notify.webhook || '');

      set('theme-select', s.theme);
      chk('toggle-keepawake', s.keepAwake);
      chk('toggle-login', s.auth.enabled);

      set('sim-scenario', (s.source.sim && s.source.sim.scenario) || 'normal');
      set('rest-url', s.source.rest.url || '');
      set('rest-key', s.source.rest.key || '');
      set('rest-interval', s.source.rest.interval || 5);
      set('mqtt-url', s.source.mqtt.url || '');
      set('mqtt-topic', s.source.mqtt.topic || 'gasguard/+/reading');
      set('mqtt-user', s.source.mqtt.user || '');
      set('mqtt-pass', s.source.mqtt.pass || '');

      this.setSourceMode(s.source.mode || 'sim', true);
      this.updateNotifStatus();
      this.updateStorageInfo();
    },

    setSourceMode(mode, silent) {
      document.querySelectorAll('#source-mode button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
      ['sim', 'rest', 'mqtt'].forEach(m => { const p = $('panel-' + m); if (p) p.hidden = m !== mode; });
      this._pendingMode = mode;
      if (!silent) this.toast('safe', 'เลือกโหมด: ' + (mode === 'sim' ? 'จำลอง' : mode.toUpperCase()), 'กด "บันทึกแหล่งข้อมูล" เพื่อเริ่มใช้งาน');
    },

    bindSettingsForm() {
      document.querySelectorAll('#source-mode button').forEach(b =>
        b.addEventListener('click', () => this.setSourceMode(b.dataset.mode)));

      $('btn-save-source').addEventListener('click', () => {
        const s = store.settings.source;
        s.mode = this._pendingMode || s.mode;
        s.sim = { scenario: $('sim-scenario').value };
        s.rest = { url: $('rest-url').value.trim(), key: $('rest-key').value.trim(), interval: util.clamp(Number($('rest-interval').value) || 5, 1, 300) };
        s.mqtt = { url: $('mqtt-url').value.trim(), topic: $('mqtt-topic').value.trim() || 'gasguard/+/reading', user: $('mqtt-user').value, pass: $('mqtt-pass').value };
        store.saveSettings();
        GG.sources.start();
        store.addEvent({ level: 'system', title: 'เปลี่ยนแหล่งข้อมูล', text: 'โหมด: ' + s.mode.toUpperCase() });
        this.toast('safe', 'บันทึกแล้ว', 'เริ่มรับข้อมูลจากแหล่งที่เลือก');
      });

      $('sim-scenario').addEventListener('change', () => {
        store.settings.source.sim = { scenario: $('sim-scenario').value };
        store.saveSettings();
        if (store.settings.source.mode === 'sim') GG.sources.start();
      });

      $('btn-test-rest').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        store.settings.source.rest = { url: $('rest-url').value.trim(), key: $('rest-key').value.trim(), interval: Number($('rest-interval').value) || 5 };
        const n = await GG.sources.testRest();
        btn.disabled = false;
        if (n) this.toast('safe', 'เชื่อมต่อสำเร็จ', `รับข้อมูล ${n} เซ็นเซอร์`);
        else this.toast('danger', 'เชื่อมต่อไม่สำเร็จ', 'ดูรายละเอียดในบันทึกการเชื่อมต่อด้านล่าง');
      });

      $('btn-test-mqtt').addEventListener('click', () => {
        store.settings.source.mqtt = { url: $('mqtt-url').value.trim(), topic: $('mqtt-topic').value.trim(), user: $('mqtt-user').value, pass: $('mqtt-pass').value };
        store.settings.source.mode = 'mqtt';
        store.saveSettings();
        GG.sources.start();
      });

      $('save-thresholds').addEventListener('click', () => {
        const t = store.settings.thresholds;
        const warn = Number($('threshold-warning').value) || 300;
        const danger = Number($('threshold-danger').value) || 600;
        if (danger <= warn) { this.toast('warning', 'ค่าไม่ถูกต้อง', 'ระดับอันตรายต้องมากกว่าระดับเฝ้าระวัง'); return; }
        t.warning = warn; t.danger = danger;
        t.scaleMax = Math.max(danger + 50, Number($('scale-max').value) || 1000);
        t.debounce = util.clamp(Number($('debounce-count').value) || 2, 1, 10);
        t.hysteresis = util.clamp(Number($('hysteresis').value) || 0, 0, 500);
        t.offlineTimeout = util.clamp(Number($('offline-timeout').value) || 30, 10, 3600);
        $('scale-max').value = t.scaleMax;
        store.saveSettings();
        this.renderGaugeLegend(); this.renderAlertLevels(); this.refreshDashboard();
        charts.updateTrend(); charts.updateRealtime(); charts.updateZone();
        this.toast('safe', 'บันทึกสำเร็จ', 'ค่าเกณฑ์การแจ้งเตือนถูกอัปเดตแล้ว');
      });

      const notifyInputs = ['toggle-sound', 'toggle-warn-sound', 'toggle-vibrate', 'toggle-push', 'toggle-modal', 'siren-volume', 'webhook-url'];
      notifyInputs.forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('change', () => this.saveNotify(true));
      });
      $('btn-save-notify').addEventListener('click', () => this.saveNotify());

      $('btn-test-siren').addEventListener('click', () => {
        alerts.unlockAudio();
        alerts.playSiren('danger', 3000);
        setTimeout(() => alerts.stopSiren(), 3000);
        this.toast('safe', 'ทดสอบเสียง', 'ถ้าไม่ได้ยิน ให้ตรวจสอบระดับเสียงเครื่องและปุ่มปิดเสียง');
      });

      $('btn-req-notif').addEventListener('click', async () => {
        const p = await alerts.requestPermission();
        this.updateNotifStatus();
        if (p === 'granted') { alerts.systemNotify('GasGuard พร้อมแจ้งเตือน', 'ระบบจะแจ้งเตือนคุณเมื่อพบแก๊สเกินเกณฑ์', 'safe'); this.toast('safe', 'อนุญาตแล้ว', 'จะได้รับการแจ้งเตือนบนอุปกรณ์นี้'); }
        else if (p === 'denied') this.toast('warning', 'ถูกปฏิเสธ', 'เปิดสิทธิ์ได้ที่การตั้งค่าเบราว์เซอร์');
        else if (p === 'unsupported') this.toast('warning', 'ไม่รองรับ', 'บน iPhone/iPad ต้องเพิ่มเว็บลงหน้าจอโฮมก่อน');
      });

      $('theme-select').addEventListener('change', () => {
        store.settings.theme = $('theme-select').value;
        store.saveSettings();
        this.applyTheme(store.settings.theme);
      });

      $('toggle-keepawake').addEventListener('change', async () => {
        store.settings.keepAwake = $('toggle-keepawake').checked;
        store.saveSettings();
        if (store.settings.keepAwake) {
          const ok = await alerts.requestWakeLock();
          this.toast(ok ? 'safe' : 'warning', ok ? 'เปิดใช้งานแล้ว' : 'อุปกรณ์ไม่รองรับ', ok ? 'หน้าจอจะไม่ดับขณะเปิดแอป' : 'เบราว์เซอร์นี้ไม่รองรับ Wake Lock');
        } else alerts.releaseWakeLock();
      });

      $('toggle-login').addEventListener('change', () => {
        store.settings.auth.enabled = $('toggle-login').checked;
        store.saveSettings();
        this.toast('safe', 'บันทึกแล้ว', store.settings.auth.enabled ? 'ต้องใส่ PIN ทุกครั้งที่เปิดแอป' : 'ปิดการล็อกอินแล้ว');
      });

      $('btn-save-pin').addEventListener('click', async () => {
        const p1 = $('new-pin').value, p2 = $('new-pin2').value;
        if (p1.length < 4) { this.toast('warning', 'PIN สั้นเกินไป', 'ต้องมีอย่างน้อย 4 หลัก'); return; }
        if (p1 !== p2) { this.toast('warning', 'PIN ไม่ตรงกัน', 'กรุณากรอกให้ตรงกันทั้งสองช่อง'); return; }
        store.settings.auth.pinHash = await util.hash(p1);
        store.saveSettings();
        $('new-pin').value = ''; $('new-pin2').value = '';
        this.toast('safe', 'เปลี่ยน PIN แล้ว', 'ใช้ PIN ใหม่ในการเข้าสู่ระบบครั้งถัดไป');
      });

      $('btn-backup').addEventListener('click', () => {
        util.download(`gasguard-backup-${util.dayKey(Date.now())}.json`, store.exportBackup(), 'application/json');
        this.toast('safe', 'สำรองข้อมูลแล้ว', 'เก็บไฟล์ไว้เพื่อกู้คืนภายหลัง');
      });

      $('btn-restore').addEventListener('click', () => $('restore-file').click());
      $('restore-file').addEventListener('change', (e) => {
        const f = e.target.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            store.importBackup(rd.result);
            this.toast('safe', 'กู้คืนสำเร็จ', 'กำลังโหลดระบบใหม่…');
            setTimeout(() => location.reload(), 900);
          } catch (err) { this.toast('danger', 'กู้คืนไม่สำเร็จ', err.message); }
        };
        rd.readAsText(f);
        e.target.value = '';
      });

      $('btn-reset').addEventListener('click', async () => {
        if (await this.confirm('รีเซ็ตทั้งหมด?', 'ลบการตั้งค่า เซ็นเซอร์ ประวัติ และข้อมูลกราฟทั้งหมดในเครื่องนี้')) {
          store.resetAll();
          location.reload();
        }
      });
    },

    saveNotify(silent) {
      const n = store.settings.notify;
      n.sound = $('toggle-sound').checked;
      n.volume = util.clamp(Number($('siren-volume').value) / 100, 0, 1);
      n.warnSound = $('toggle-warn-sound').checked;
      n.vibrate = $('toggle-vibrate').checked;
      n.push = $('toggle-push').checked;
      n.modal = $('toggle-modal').checked;
      n.webhook = $('webhook-url').value.trim();
      store.saveSettings();
      this.updateMuteButton();
      if (!silent) this.toast('safe', 'บันทึกสำเร็จ', 'อัปเดตการตั้งค่าการแจ้งเตือนแล้ว');
    },

    updateNotifStatus() {
      const el = $('notif-status');
      if (!el) return;
      if (!('Notification' in window)) { el.textContent = 'อุปกรณ์นี้ไม่รองรับการแจ้งเตือนของระบบ (บน iPhone/iPad ให้เพิ่มเว็บลงหน้าจอโฮมก่อน)'; return; }
      const p = Notification.permission;
      el.textContent = p === 'granted' ? '✅ อนุญาตการแจ้งเตือนแล้ว'
        : p === 'denied' ? '⛔ ถูกปฏิเสธ — เปิดสิทธิ์ได้ที่การตั้งค่าเบราว์เซอร์'
        : 'ℹ️ ยังไม่ได้ขออนุญาต — กดปุ่ม "ขออนุญาตแจ้งเตือน"';
    },

    updateStorageInfo() {
      const el = $('storage-info');
      if (!el) return;
      const kb = Math.round(store.storageUsage() / 1024);
      el.textContent = `ใช้พื้นที่จัดเก็บในเครื่อง ~${kb} KB · เหตุการณ์ ${store.events.length} รายการ · เซ็นเซอร์ ${store.sensors.length} ตัว`;
    },

    renderConnStatus(s) {
      const chip = $('conn-chip'), text = $('conn-chip-text');
      if (!chip) return;
      const mode = store.settings.source.mode;
      const modeLabel = mode === 'sim' ? 'โหมดจำลอง' : mode === 'rest' ? 'REST API' : 'MQTT';
      const status = (s && s.status) || GG.sources.status;
      chip.className = 'conn-chip ' + status;
      text.textContent = modeLabel + (status === 'connected' ? '' : status === 'connecting' ? ' · กำลังเชื่อมต่อ' : status === 'error' ? ' · ขัดข้อง' : ' · หยุด');
      const side = $('conn-status-side');
      if (side) {
        side.querySelector('.status-dot').className = 'status-dot ' + (status === 'connected' ? 'online' : status === 'error' ? 'offline' : 'idle');
        side.querySelector('.conn-text').textContent =
          status === 'connected' ? 'ระบบทำงานปกติ' : status === 'connecting' ? 'กำลังเชื่อมต่อ…' : status === 'error' ? 'การเชื่อมต่อขัดข้อง' : 'หยุดชั่วคราว';
      }
    },

    renderConnLog() {
      const el = $('conn-log');
      if (!el) return;
      const logs = GG.sources.logs.slice(0, 8);
      if (!logs.length) { el.textContent = 'ยังไม่มีบันทึกการเชื่อมต่อ'; return; }
      el.innerHTML = logs.map(l => `<div class="log-line ${l.kind}"><span>${util.formatTime(l.t)}</span> ${util.escapeHtml(l.msg)}</div>`).join('');
    },

    /* =============== MODALS =============== */
    bindModals() {
      $('btn-acknowledge').addEventListener('click', () => {
        alerts.stopSiren(); alerts.closeModal();
        store.addEvent({ level: 'system', title: 'รับทราบการแจ้งเตือน', text: 'ผู้ใช้กดรับทราบเหตุการณ์อันตราย' });
      });
      $('btn-silence').addEventListener('click', () => {
        alerts.mute(5); alerts.closeModal();
        this.toast('warning', 'ปิดเสียง 5 นาที', 'ระบบยังคงบันทึกและแสดงการแจ้งเตือน');
      });
      $('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') { alerts.stopSiren(); alerts.closeModal(); } });
      $('sensor-modal').addEventListener('click', (e) => { if (e.target.id === 'sensor-modal') this.closeSensorModal(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { alerts.stopSiren(); alerts.closeModal(); this.closeSensorModal(); this.closeConfirm(false); }
      });

      $('btn-pause-live').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const paused = !GG.sources._paused;
        GG.sources.pause(paused);
        btn.innerHTML = paused ? '<i class="fas fa-play"></i> เล่นต่อ' : '<i class="fas fa-pause"></i> หยุดชั่วคราว';
        $('live-badge').classList.toggle('paused', paused);
      });
    },

    confirm(title, message) {
      return new Promise(resolve => {
        this._confirmResolve = resolve;
        $('confirm-title').textContent = title;
        $('confirm-message').textContent = message;
        const m = $('confirm-modal');
        m.hidden = false;
        requestAnimationFrame(() => m.classList.add('show'));
        const ok = $('confirm-ok'), cancel = $('confirm-cancel');
        const done = (v) => { this.closeConfirm(v); ok.removeEventListener('click', okH); cancel.removeEventListener('click', cH); };
        const okH = () => done(true), cH = () => done(false);
        ok.addEventListener('click', okH); cancel.addEventListener('click', cH);
      });
    },

    closeConfirm(value) {
      const m = $('confirm-modal');
      if (!m || m.hidden) return;
      m.classList.remove('show');
      setTimeout(() => { m.hidden = true; }, 200);
      if (this._confirmResolve) { this._confirmResolve(!!value); this._confirmResolve = null; }
    },

    /* =============== THEME =============== */
    applyTheme(pref, silent) {
      let theme = pref || 'dark';
      if (theme === 'auto') {
        theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
      document.documentElement.setAttribute('data-theme', theme);
      const icon = $('btn-theme') && $('btn-theme').querySelector('i');
      if (icon) icon.className = theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', theme === 'dark' ? '#0a0e1a' : '#f4f6fb');
      if (!silent && window.Chart) charts.refreshTheme();
    },

    toast(type, title, msg) { alerts.toast(type, title, msg); }
  };

  ui.throttledRefresh = (function () {
    let queued = false;
    return function () {
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        if (ui.currentPage === 'dashboard') ui.refreshDashboard();
        else if (ui.currentPage === 'realtime') { ui.updateSensorDetails(); charts.updateRealtime(); charts.updateZone(); }
        else if (ui.currentPage === 'alerts') ui.renderAlertLevels();
        ui.updateBadges();
      }, 400);
    };
  })();

  GG.ui = ui;
})();
