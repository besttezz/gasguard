/* ============================================================
   GasGuard v2 — alerts.js
   เอนจินแจ้งเตือน: threshold + hysteresis + debounce,
   เสียงไซเรน (Web Audio), การแจ้งเตือนระบบ, toast, modal, webhook
   ============================================================ */
(function () {
  'use strict';

  const GG = window.GG;
  const { store, bus, util } = GG;

  const LABEL = { safe: 'ปลอดภัย', warning: 'เฝ้าระวัง', danger: 'อันตราย', offline: 'ออฟไลน์', system: 'ระบบ' };
  const ICON = { safe: 'fa-shield-heart', warning: 'fa-triangle-exclamation', danger: 'fa-skull-crossbones', offline: 'fa-plug-circle-xmark', system: 'fa-circle-info' };

  const alerts = {
    LABEL, ICON,
    state: {},            // devId -> { level, pendingLevel, pendingCount, lastEventAt }
    muteUntil: 0,
    _ctx: null,
    _sirenNodes: null,
    _sirenTimer: null,
    _modalOpen: false,
    _wakeLock: null,

    label(level) { return LABEL[level] || level; },
    icon(level) { return ICON[level] || 'fa-circle-info'; },

    /* ---------------- evaluate ---------------- */
    evaluate(sensor, rec) {
      const devId = sensor.devId;
      const st = (this.state[devId] = this.state[devId] || { level: 'safe', pendingLevel: null, pendingCount: 0, lastEventAt: 0 });
      const cfg = store.settings.thresholds;
      const { warn, danger } = store.thresholdsFor(sensor);
      const hys = Number(cfg.hysteresis) || 0;
      const ppm = rec.ppm;

      // ระดับใหม่ พร้อม hysteresis (ต้องลดต่ำกว่าเกณฑ์ - hysteresis จึงจะถือว่าลดระดับ)
      let level;
      if (ppm >= danger) level = 'danger';
      else if (ppm >= warn) level = 'warning';
      else level = 'safe';

      if (st.level === 'danger' && ppm >= danger - hys) level = 'danger';
      else if (st.level === 'warning' && level === 'safe' && ppm >= warn - hys) level = 'warning';

      if (level === st.level) { st.pendingLevel = null; st.pendingCount = 0; return; }

      // debounce: ต้องอ่านค่าติดต่อกัน N ครั้ง
      const need = Math.max(1, Number(cfg.debounce) || 1);
      if (st.pendingLevel === level) st.pendingCount++;
      else { st.pendingLevel = level; st.pendingCount = 1; }
      if (st.pendingCount < need) return;

      const prev = st.level;
      st.level = level;
      st.pendingLevel = null; st.pendingCount = 0;
      st.lastEventAt = Date.now();

      this.fire(sensor, rec, level, prev);
    },

    /* ---------------- fire ---------------- */
    fire(sensor, rec, level, prev) {
      const n = store.settings.notify;
      const name = sensor.name || sensor.devId;
      const where = sensor.location ? ` (${sensor.location})` : '';
      let title, text;

      if (level === 'danger') {
        title = '🚨 แก๊สรั่วระดับอันตราย!';
        text = `${name}${where} ตรวจพบ ${rec.ppm} PPM — อพยพและปิดวาล์วแก๊สทันที`;
      } else if (level === 'warning') {
        title = '⚠️ แก๊สเกินเกณฑ์เฝ้าระวัง';
        text = `${name}${where} ตรวจพบ ${rec.ppm} PPM`;
      } else {
        title = '✅ กลับสู่ระดับปลอดภัย';
        text = `${name}${where} ลดลงเหลือ ${rec.ppm} PPM`;
      }

      store.addEvent({ level, title, text, ppm: rec.ppm, sensorId: sensor.devId, sensorName: name });
      this.toast(level, title, text);

      const muted = Date.now() < this.muteUntil;

      if (n.sound && !muted && (level === 'danger' || (level === 'warning' && n.warnSound))) {
        this.playSiren(level);
      }
      if (n.vibrate && !muted && level !== 'safe' && navigator.vibrate) {
        try { navigator.vibrate(level === 'danger' ? [300, 120, 300, 120, 300] : [200, 100, 200]); } catch (e) {}
      }
      if (n.push && level !== 'safe') this.systemNotify(title, text, level);
      if (n.modal && level === 'danger' && !muted) this.showDangerModal(sensor, rec);
      if (n.webhook && level !== 'safe') this.sendWebhook({ level, sensor: name, deviceId: sensor.devId, ppm: rec.ppm, message: text, time: new Date().toISOString() });

      bus.emit('alert', { sensor, rec, level, prev });
    },

    /* ---------------- toast ---------------- */
    toast(type, title, message, timeout) {
      const wrap = document.getElementById('toast-container');
      if (!wrap) return;
      const el = document.createElement('div');
      el.className = 'toast ' + type;
      el.innerHTML = `
        <div class="toast-icon"><i class="fas ${this.icon(type)}"></i></div>
        <div class="toast-content">
          <div class="toast-title">${util.escapeHtml(title)}</div>
          <div class="toast-message">${util.escapeHtml(message)}</div>
        </div>
        <button class="toast-close" aria-label="ปิด"><i class="fas fa-xmark"></i></button>`;
      el.querySelector('.toast-close').addEventListener('click', () => el.remove());
      wrap.appendChild(el);
      while (wrap.children.length > 4) wrap.firstChild.remove();
      setTimeout(() => el.classList.add('out'), (timeout || 6000) - 400);
      setTimeout(() => el.remove(), timeout || 6000);
    },

    /* ---------------- Web Audio siren ---------------- */
    ensureCtx() {
      if (!this._ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this._ctx = new AC();
      }
      if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
      return this._ctx;
    },

    unlockAudio() {
      const ctx = this.ensureCtx();
      if (!ctx) return;
      try {
        const b = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = b; src.connect(ctx.destination); src.start(0);
      } catch (e) {}
    },

    playSiren(level, forceDuration) {
      const ctx = this.ensureCtx();
      if (!ctx) return;
      this.stopSiren();

      const vol = util.clamp(Number(store.settings.notify.volume) || 0.7, 0, 1);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const osc = ctx.createOscillator();
      osc.type = level === 'danger' ? 'sawtooth' : 'sine';
      osc.connect(gain);
      osc.start();
      this._sirenNodes = { osc, gain };

      const now = ctx.currentTime;
      if (level === 'danger') {
        // ไซเรนสองโทนสลับ
        const cycles = 12;
        for (let i = 0; i < cycles; i++) {
          const t0 = now + i * 0.7;
          osc.frequency.setValueAtTime(660, t0);
          osc.frequency.linearRampToValueAtTime(1180, t0 + 0.35);
          osc.frequency.linearRampToValueAtTime(660, t0 + 0.7);
          gain.gain.setValueAtTime(vol * 0.35, t0);
          gain.gain.linearRampToValueAtTime(vol * 0.05, t0 + 0.68);
        }
        this._sirenTimer = setTimeout(() => this.stopSiren(), (forceDuration || cycles * 700));
      } else {
        [0, 0.45].forEach(off => {
          const t0 = now + off;
          osc.frequency.setValueAtTime(880, t0);
          gain.gain.setValueAtTime(vol * 0.28, t0);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        });
        this._sirenTimer = setTimeout(() => this.stopSiren(), 1000);
      }
    },

    stopSiren() {
      clearTimeout(this._sirenTimer); this._sirenTimer = null;
      if (this._sirenNodes) {
        const { osc, gain } = this._sirenNodes;
        try {
          gain.gain.cancelScheduledValues(this._ctx.currentTime);
          gain.gain.setValueAtTime(0, this._ctx.currentTime);
          osc.stop(this._ctx.currentTime + 0.05);
        } catch (e) {}
        this._sirenNodes = null;
      }
    },

    mute(minutes) {
      this.muteUntil = Date.now() + (minutes || 5) * 60000;
      this.stopSiren();
      bus.emit('mute', this.muteUntil);
    },

    unmute() { this.muteUntil = 0; bus.emit('mute', 0); },

    isMuted() { return Date.now() < this.muteUntil; },

    /* ---------------- system notification ---------------- */
    async requestPermission() {
      if (!('Notification' in window)) return 'unsupported';
      try {
        const p = await Notification.requestPermission();
        return p;
      } catch (e) { return 'error'; }
    },

    systemNotify(title, body, level) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const opts = {
        body, tag: 'gasguard-' + level, renotify: true,
        icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
        vibrate: level === 'danger' ? [300, 120, 300] : [200],
        requireInteraction: level === 'danger'
      };
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opts)).catch(() => { new Notification(title, opts); });
        } else {
          new Notification(title, opts);
        }
      } catch (e) { /* iOS Safari นอกโหมดติดตั้งจะไม่รองรับ */ }
    },

    /* ---------------- webhook ---------------- */
    async sendWebhook(payload) {
      const url = store.settings.notify.webhook;
      if (!url) return;
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        try {
          await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
        } catch (e2) { console.warn('[GasGuard] ส่ง webhook ไม่สำเร็จ', e2); }
      }
    },

    /* ---------------- danger modal ---------------- */
    showDangerModal(sensor, rec) {
      const overlay = document.getElementById('modal-overlay');
      if (!overlay || this._modalOpen) return;
      this._modalOpen = true;
      document.getElementById('modal-message').textContent =
        `ตรวจพบระดับแก๊สเกินค่าอันตรายที่ ${sensor.name}${sensor.location ? ' (' + sensor.location + ')' : ''}`;
      document.getElementById('modal-ppm').textContent = rec.ppm + ' PPM';
      document.getElementById('modal-time').textContent = util.formatTime(rec.t || Date.now());
      overlay.hidden = false;
      requestAnimationFrame(() => overlay.classList.add('show'));
    },

    closeModal() {
      const overlay = document.getElementById('modal-overlay');
      if (!overlay) return;
      overlay.classList.remove('show');
      this._modalOpen = false;
      setTimeout(() => { overlay.hidden = true; }, 250);
    },

    /* ---------------- wake lock ---------------- */
    async requestWakeLock() {
      if (!('wakeLock' in navigator)) return false;
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
        return true;
      } catch (e) { return false; }
    },

    releaseWakeLock() {
      if (this._wakeLock) { try { this._wakeLock.release(); } catch (e) {} this._wakeLock = null; }
    }
  };

  GG.alerts = alerts;
})();
