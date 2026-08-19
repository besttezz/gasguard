/* ============================================================
   GasGuard v2 — app.js
   เริ่มระบบ, ล็อกอิน, service worker, ตัวจับเซ็นเซอร์ออฟไลน์
   ============================================================ */
(function () {
  'use strict';

  const GG = window.GG;
  const { store, util, alerts, charts } = GG;
  const $ = (id) => document.getElementById(id);

  const SESSION_KEY = 'gg.session';

  const app = {
    started: false,
    deferredInstall: null,

    /* ---------------- boot ---------------- */
    async boot() {
      store.init();

      // ธีมก่อนแสดงผล เพื่อลดการกระพริบ
      let theme = store.settings.theme || 'dark';
      if (theme === 'auto') theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);

      this.registerSW();
      this.bindInstallPrompt();

      if (store.settings.auth.enabled && !this.hasValidSession()) this.showLogin();
      else this.startApp();

      this.bindLogin();
    },

    /* ---------------- auth ---------------- */
    hasValidSession() {
      try {
        const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
        if (!raw) return false;
        const s = JSON.parse(raw);
        return !!(s && s.ok);
      } catch (e) { return false; }
    },

    showLogin() {
      $('login-screen').hidden = false;
      $('app').hidden = true;
      setTimeout(() => { const el = $('login-pin'); if (el) el.focus(); }, 200);
    },

    bindLogin() {
      const form = $('login-form');
      if (!form) return;

      $('toggle-pin').addEventListener('click', () => {
        const input = $('login-pin');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        $('toggle-pin').querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pin = $('login-pin').value;
        const expected = store.settings.auth.pinHash || await util.hash(store.settings.auth.defaultPin || '1234');
        const got = await util.hash(pin);
        const err = $('login-error');
        if (got !== expected) {
          err.textContent = 'รหัส PIN ไม่ถูกต้อง ลองใหม่อีกครั้ง';
          err.hidden = false;
          $('login-pin').value = '';
          $('login-pin').focus();
          if (navigator.vibrate) try { navigator.vibrate(200); } catch (e2) {}
          return;
        }
        err.hidden = true;
        const payload = JSON.stringify({ ok: true, t: Date.now() });
        try {
          if ($('login-remember').checked) localStorage.setItem(SESSION_KEY, payload);
          else sessionStorage.setItem(SESSION_KEY, payload);
        } catch (e2) {}
        alerts.unlockAudio();     // ปลดล็อกเสียงด้วย gesture ของผู้ใช้
        $('login-screen').hidden = true;
        this.startApp();
      });
    },

    logout() {
      try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
      location.reload();
    },

    /* ---------------- start ---------------- */
    startApp() {
      if (this.started) return;
      this.started = true;
      $('app').hidden = false;
      $('login-screen').hidden = true;

      charts.applyDefaults();
      charts.initGauge();
      charts.initTrend();

      GG.ui.init();

      // ไปยังหน้าจาก hash (เช่น เปิดจาก PWA shortcut)
      const hash = location.hash.replace('#', '');
      GG.ui.navigate(hash || 'dashboard');

      GG.sources.start();

      // ตรวจเซ็นเซอร์ที่ขาดการติดต่อ
      setInterval(() => {
        if (store.checkOffline()) {
          GG.ui.refreshDashboard();
          GG.ui.renderSensorDetails();
        }
      }, 5000);

      // อัปเดตกราฟ 24 ชม. เป็นระยะ
      setInterval(() => { if (GG.ui.currentPage === 'dashboard') charts.updateTrend(); }, 60000);

      // ปลดล็อกเสียงเมื่อผู้ใช้แตะครั้งแรก (นโยบาย autoplay)
      const unlock = () => { alerts.unlockAudio(); document.removeEventListener('click', unlock); document.removeEventListener('touchstart', unlock); };
      document.addEventListener('click', unlock);
      document.addEventListener('touchstart', unlock);

      if (store.settings.keepAwake) alerts.requestWakeLock();
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && store.settings.keepAwake) alerts.requestWakeLock();
      });

      store.addEvent({ level: 'system', title: 'เริ่มระบบ', text: `GasGuard เริ่มทำงาน · แหล่งข้อมูล: ${(store.settings.source.mode || 'sim').toUpperCase()}` });
    },

    /* ---------------- PWA ---------------- */
    registerSW() {
      if (!('serviceWorker' in navigator)) return;
      if (location.protocol === 'file:') return;   // เปิดจากไฟล์ตรง ๆ จะลงทะเบียนไม่ได้
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('[GasGuard] SW ไม่สำเร็จ', err));
      });
    },

    bindInstallPrompt() {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredInstall = e;
        this.showInstallButton();
      });
      window.addEventListener('appinstalled', () => {
        this.deferredInstall = null;
        const b = $('btn-install'); if (b) b.remove();
      });
    },

    showInstallButton() {
      if ($('btn-install')) return;
      const help = document.querySelector('#page-help .help-card');
      const btn = document.createElement('button');
      btn.id = 'btn-install';
      btn.className = 'btn-primary block install-btn';
      btn.innerHTML = '<i class="fas fa-download"></i> ติดตั้ง GasGuard เป็นแอปบนเครื่องนี้';
      btn.addEventListener('click', async () => {
        if (!this.deferredInstall) return;
        this.deferredInstall.prompt();
        await this.deferredInstall.userChoice;
        this.deferredInstall = null;
        btn.remove();
      });
      if (help) help.appendChild(btn);
      const settings = document.querySelector('#page-settings .grid-2');
      if (settings) {
        const clone = btn.cloneNode(true);
        clone.id = 'btn-install-2';
        clone.addEventListener('click', () => btn.click());
        settings.appendChild(clone);
      }
    }
  };

  GG.app = app;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => app.boot());
  else app.boot();
})();
