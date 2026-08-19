/* ============================================================
   GasGuard v2 — store.js
   สถานะกลางของแอป + บันทึกลง localStorage
   ============================================================ */
(function () {
  'use strict';

  const GG = (window.GG = window.GG || {});

  /* ---------- Utilities ---------- */
  const util = {
    pad(n) { return String(n).padStart(2, '0'); },

    formatTime(d) {
      d = d instanceof Date ? d : new Date(d);
      return `${util.pad(d.getHours())}:${util.pad(d.getMinutes())}:${util.pad(d.getSeconds())}`;
    },

    formatShortTime(d) {
      d = d instanceof Date ? d : new Date(d);
      return `${util.pad(d.getHours())}:${util.pad(d.getMinutes())}`;
    },

    formatDate(d) {
      d = d instanceof Date ? d : new Date(d);
      try {
        return d.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      } catch (e) {
        return d.toDateString();
      }
    },

    formatDateShort(d) {
      d = d instanceof Date ? d : new Date(d);
      try {
        return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
      } catch (e) { return `${d.getDate()}/${d.getMonth() + 1}`; }
    },

    formatDateTime(d) {
      d = d instanceof Date ? d : new Date(d);
      return `${util.formatDateShort(d)} ${util.formatShortTime(d)}`;
    },

    relative(t) {
      const diff = Date.now() - t;
      if (diff < 15000) return 'เมื่อครู่';
      if (diff < 60000) return `${Math.floor(diff / 1000)} วินาทีที่แล้ว`;
      if (diff < 3600000) return `${Math.floor(diff / 60000)} นาทีที่แล้ว`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)} ชั่วโมงที่แล้ว`;
      return `${Math.floor(diff / 86400000)} วันที่แล้ว`;
    },

    clamp(v, min, max) { return Math.min(max, Math.max(min, v)); },

    uid(prefix) {
      return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },

    randomInRange(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; },

    escapeHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    debounce(fn, wait) {
      let t;
      return function () {
        const args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(() => fn.apply(ctx, args), wait);
      };
    },

    async hash(text) {
      try {
        if (window.crypto && crypto.subtle && crypto.subtle.digest) {
          const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('gg::' + text));
          return Array.from(new Uint8Array(buf)).map(b => util.pad(b.toString(16))).join('');
        }
      } catch (e) { /* fall through */ }
      // Fallback (ไม่ปลอดภัยเชิงเข้ารหัส แต่พอสำหรับล็อกหน้าจอฝั่ง client)
      let h = 2166136261;
      const s = 'gg::' + text;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return 'fnv' + (h >>> 0).toString(16);
    },

    download(filename, content, mime) {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
    },

    csv(rows) {
      return '﻿' + rows.map(r => r.map(c => {
        const s = String(c == null ? '' : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',')).join('\n');
    },

    dayKey(d) {
      d = d instanceof Date ? d : new Date(d);
      return `${d.getFullYear()}-${util.pad(d.getMonth() + 1)}-${util.pad(d.getDate())}`;
    }
  };
  GG.util = util;

  /* ---------- Defaults ---------- */
  const DEFAULT_SETTINGS = {
    version: 2,
    auth: { enabled: true, pinHash: null, defaultPin: '1234' },
    theme: 'dark',
    thresholds: { warning: 300, danger: 600, scaleMax: 1000, debounce: 2, hysteresis: 30, offlineTimeout: 30 },
    notify: { sound: true, volume: 0.7, warnSound: false, vibrate: true, push: true, modal: true, webhook: '' },
    source: {
      mode: 'sim',
      sim: { scenario: 'normal' },
      rest: { url: '', key: '', interval: 5 },
      mqtt: { url: '', topic: 'gasguard/+/reading', user: '', pass: '' }
    },
    keepAwake: false
  };

  const DEFAULT_SENSORS = [
    { uid: 'sn-1', devId: 'kitchen-01', name: 'เซ็นเซอร์ #1', location: 'ห้องครัว - ชั้น 1', type: 'LPG', warn: null, danger: null, offset: 0, simLevel: 'low', enabled: true },
    { uid: 'sn-2', devId: 'store-01', name: 'เซ็นเซอร์ #2', location: 'ห้องเก็บของ - ชั้น B1', type: 'LPG', warn: null, danger: null, offset: 0, simLevel: 'mid', enabled: true },
    { uid: 'sn-3', devId: 'garage-01', name: 'เซ็นเซอร์ #3', location: 'โรงจอดรถ - ชั้น B2', type: 'CO', warn: null, danger: null, offset: 0, simLevel: 'low', enabled: true },
    { uid: 'sn-4', devId: 'boiler-01', name: 'เซ็นเซอร์ #4', location: 'ห้องหม้อต้ม - ชั้น 1', type: 'CH4', warn: null, danger: null, offset: 0, simLevel: 'high', enabled: true }
  ];

  const K = {
    settings: 'gg.settings',
    sensors: 'gg.sensors',
    events: 'gg.events',
    series: 'gg.series',
    daily: 'gg.daily',
    session: 'gg.session'
  };

  const MAX_EVENTS = 400;
  const SERIES_STEP_MS = 5 * 60 * 1000;   // เก็บจุดละ 5 นาที
  const SERIES_KEEP_MS = 24 * 60 * 60 * 1000;
  const DAILY_KEEP = 45;
  const LIVE_POINTS = 90;                  // จุดในกราฟเรียลไทม์

  /* ---------- Safe storage ---------- */
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const val = JSON.parse(raw);
      return val == null ? fallback : val;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.warn('[GasGuard] เขียน localStorage ไม่สำเร็จ', key, e); return false; }
  }
  function deepMerge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      const v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && base[k] !== null) {
        out[k] = deepMerge(base[k], v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  }

  /* ---------- Event bus ---------- */
  const bus = {
    map: {},
    on(evt, cb) { (this.map[evt] = this.map[evt] || []).push(cb); return () => this.off(evt, cb); },
    off(evt, cb) { this.map[evt] = (this.map[evt] || []).filter(f => f !== cb); },
    emit(evt, payload) { (this.map[evt] || []).forEach(f => { try { f(payload); } catch (e) { console.error(e); } }); }
  };
  GG.bus = bus;

  /* ---------- Store ---------- */
  const store = {
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    sensors: [],
    events: [],
    series: {},   // devId -> [[t, ppm], ...] (จุดละ 5 นาที ย้อนหลัง 24 ชม.)
    daily: {},    // 'YYYY-MM-DD' -> { devId: {sum,count,max,min,safe,warn,danger}, _alerts: n }
    live: {},     // devId -> { ppm, temp, hum, t, status, online }
    liveSeries: {}, // devId -> [{t,ppm}] เก็บในหน่วยความจำสำหรับกราฟเรียลไทม์
    _lastSeriesWrite: {},

    init() {
      this.settings = deepMerge(DEFAULT_SETTINGS, readJSON(K.settings, {}));
      this.sensors = readJSON(K.sensors, null) || JSON.parse(JSON.stringify(DEFAULT_SENSORS));
      this.events = readJSON(K.events, []);
      this.series = readJSON(K.series, {});
      this.daily = readJSON(K.daily, {});
      this.pruneSeries();
      this.pruneDaily();
      this.sensors.forEach(s => {
        this.live[s.devId] = { ppm: null, temp: null, hum: null, t: 0, status: 'offline', online: false };
        this.liveSeries[s.devId] = [];
      });
      return this;
    },

    /* --- persistence --- */
    saveSettings() { writeJSON(K.settings, this.settings); bus.emit('settings', this.settings); },
    saveSensors() { writeJSON(K.sensors, this.sensors); bus.emit('sensors', this.sensors); },
    saveEvents: null,   // assigned below (debounced)
    saveSeries: null,
    saveDaily: null,
    flush() {
      writeJSON(K.events, this.events);
      writeJSON(K.series, this.series);
      writeJSON(K.daily, this.daily);
      writeJSON(K.settings, this.settings);
      writeJSON(K.sensors, this.sensors);
    },

    /* --- sensors --- */
    enabledSensors() { return this.sensors.filter(s => s.enabled !== false); },

    sensorByDevId(devId) { return this.sensors.find(s => s.devId === devId); },

    upsertSensor(data) {
      const idx = this.sensors.findIndex(s => s.uid === data.uid);
      if (idx >= 0) {
        const oldDev = this.sensors[idx].devId;
        this.sensors[idx] = Object.assign({}, this.sensors[idx], data);
        if (oldDev !== data.devId) {
          this.live[data.devId] = this.live[oldDev] || { ppm: null, t: 0, status: 'offline', online: false };
          this.liveSeries[data.devId] = this.liveSeries[oldDev] || [];
          delete this.live[oldDev]; delete this.liveSeries[oldDev];
          if (this.series[oldDev]) { this.series[data.devId] = this.series[oldDev]; delete this.series[oldDev]; }
        }
      } else {
        data.uid = data.uid || util.uid('sn');
        this.sensors.push(data);
        this.live[data.devId] = { ppm: null, temp: null, hum: null, t: 0, status: 'offline', online: false };
        this.liveSeries[data.devId] = [];
      }
      this.saveSensors();
      return data;
    },

    removeSensor(uid) {
      const s = this.sensors.find(x => x.uid === uid);
      if (!s) return;
      this.sensors = this.sensors.filter(x => x.uid !== uid);
      delete this.live[s.devId]; delete this.liveSeries[s.devId]; delete this.series[s.devId];
      this.saveSensors();
    },

    /* --- thresholds --- */
    thresholdsFor(sensor) {
      const t = this.settings.thresholds;
      const warn = (sensor && sensor.warn != null && sensor.warn !== '') ? Number(sensor.warn) : Number(t.warning);
      const danger = (sensor && sensor.danger != null && sensor.danger !== '') ? Number(sensor.danger) : Number(t.danger);
      return { warn, danger };
    },

    statusOf(ppm, sensor) {
      if (ppm == null || isNaN(ppm)) return 'offline';
      const { warn, danger } = this.thresholdsFor(sensor);
      if (ppm >= danger) return 'danger';
      if (ppm >= warn) return 'warning';
      return 'safe';
    },

    /* --- readings --- */
    pushReading(devId, reading) {
      const sensor = this.sensorByDevId(devId);
      if (!sensor) return null;
      const t = reading.t || Date.now();
      let ppm = Number(reading.ppm);
      if (isNaN(ppm)) return null;
      ppm = Math.max(0, Math.round(ppm + (Number(sensor.offset) || 0)));

      const status = this.statusOf(ppm, sensor);
      const rec = {
        ppm, temp: reading.temp != null ? Number(reading.temp) : null,
        hum: reading.hum != null ? Number(reading.hum) : null,
        t, status, online: true
      };
      this.live[devId] = rec;

      const ls = (this.liveSeries[devId] = this.liveSeries[devId] || []);
      ls.push({ t, ppm });
      if (ls.length > LIVE_POINTS) ls.splice(0, ls.length - LIVE_POINTS);

      // เก็บลง series ทุก 5 นาที
      const last = this._lastSeriesWrite[devId] || 0;
      if (t - last >= SERIES_STEP_MS) {
        this._lastSeriesWrite[devId] = t;
        const arr = (this.series[devId] = this.series[devId] || []);
        arr.push([t, ppm]);
        const cutoff = t - SERIES_KEEP_MS;
        while (arr.length && arr[0][0] < cutoff) arr.shift();
        this.saveSeries();
      }

      // สรุปรายวัน
      const key = util.dayKey(t);
      const day = (this.daily[key] = this.daily[key] || { _alerts: 0 });
      const d = (day[devId] = day[devId] || { sum: 0, count: 0, max: 0, min: Infinity, safe: 0, warn: 0, danger: 0 });
      d.sum += ppm; d.count++;
      d.max = Math.max(d.max, ppm);
      d.min = Math.min(d.min === Infinity ? ppm : d.min, ppm);
      if (status === 'danger') d.danger++; else if (status === 'warning') d.warn++; else d.safe++;
      this.saveDaily();

      bus.emit('reading', { devId, sensor, rec });
      return rec;
    },

    markOffline(devId) {
      const l = this.live[devId];
      if (l && l.online) { l.online = false; l.status = 'offline'; bus.emit('reading', { devId, sensor: this.sensorByDevId(devId), rec: l }); }
    },

    checkOffline() {
      const timeout = (Number(this.settings.thresholds.offlineTimeout) || 30) * 1000;
      const now = Date.now();
      let changed = false;
      this.enabledSensors().forEach(s => {
        const l = this.live[s.devId];
        if (l && l.online && now - l.t > timeout) { this.markOffline(s.devId); changed = true; }
      });
      return changed;
    },

    /* --- events --- */
    addEvent(ev) {
      const e = Object.assign({ id: util.uid('ev'), t: Date.now(), read: false, level: 'system' }, ev);
      this.events.unshift(e);
      if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
      if (e.level === 'danger' || e.level === 'warning') {
        const key = util.dayKey(e.t);
        this.daily[key] = this.daily[key] || { _alerts: 0 };
        this.daily[key]._alerts = (this.daily[key]._alerts || 0) + 1;
        this.saveDaily();
      }
      this.saveEvents();
      bus.emit('event', e);
      return e;
    },

    unreadCount() { return this.events.filter(e => !e.read).length; },
    markAllRead() { this.events.forEach(e => (e.read = true)); this.saveEvents(); bus.emit('event', null); },
    clearEvents() { this.events = []; this.saveEvents(); bus.emit('event', null); },

    alertsToday() {
      const key = util.dayKey(Date.now());
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const fromEvents = this.events.filter(e => e.t >= start.getTime() && (e.level === 'danger' || e.level === 'warning')).length;
      const fromDaily = (this.daily[key] && this.daily[key]._alerts) || 0;
      return Math.max(fromEvents, fromDaily);
    },

    /* --- pruning --- */
    pruneSeries() {
      const cutoff = Date.now() - SERIES_KEEP_MS;
      Object.keys(this.series).forEach(k => {
        const arr = this.series[k];
        if (!Array.isArray(arr)) { delete this.series[k]; return; }
        this.series[k] = arr.filter(p => Array.isArray(p) && p[0] >= cutoff);
      });
    },

    pruneDaily() {
      const keys = Object.keys(this.daily).sort();
      while (keys.length > DAILY_KEEP) { delete this.daily[keys.shift()]; }
    },

    /* --- aggregation for statistics --- */
    weeklyStats(days) {
      days = days || 7;
      const out = [];
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now); d.setDate(now.getDate() - i);
        const key = util.dayKey(d);
        const day = this.daily[key];
        const perSensor = {};
        let sum = 0, count = 0, max = 0, min = Infinity, safe = 0, warn = 0, danger = 0;
        if (day) {
          Object.keys(day).forEach(devId => {
            if (devId === '_alerts') return;
            const s = day[devId];
            perSensor[devId] = s.count ? Math.round(s.sum / s.count) : 0;
            sum += s.sum; count += s.count;
            max = Math.max(max, s.max);
            min = Math.min(min, s.min === Infinity ? 0 : s.min);
            safe += s.safe; warn += s.warn; danger += s.danger;
          });
        }
        out.push({
          date: new Date(d), key,
          label: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'][d.getDay()] + ' ' + util.formatDateShort(d),
          avg: count ? Math.round(sum / count) : 0,
          max: max || 0, min: min === Infinity ? 0 : min,
          safe, warn, danger, count,
          alerts: (day && day._alerts) || 0,
          perSensor
        });
      }
      return out;
    },

    /* --- backup --- */
    exportBackup() {
      return JSON.stringify({
        app: 'GasGuard', version: 2, exportedAt: new Date().toISOString(),
        settings: this.settings, sensors: this.sensors,
        events: this.events, series: this.series, daily: this.daily
      }, null, 2);
    },

    importBackup(json) {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      if (!data || data.app !== 'GasGuard') throw new Error('ไฟล์สำรองไม่ถูกต้อง');
      if (data.settings) this.settings = deepMerge(DEFAULT_SETTINGS, data.settings);
      if (Array.isArray(data.sensors) && data.sensors.length) this.sensors = data.sensors;
      if (Array.isArray(data.events)) this.events = data.events;
      if (data.series) this.series = data.series;
      if (data.daily) this.daily = data.daily;
      this.flush();
      return true;
    },

    resetAll() {
      Object.values(K).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    },

    storageUsage() {
      let bytes = 0;
      Object.values(K).forEach(k => { const v = localStorage.getItem(k); if (v) bytes += v.length * 2; });
      return bytes;
    }
  };

  store.saveEvents = util.debounce(() => writeJSON(K.events, store.events), 800);
  store.saveSeries = util.debounce(() => writeJSON(K.series, store.series), 2000);
  store.saveDaily = util.debounce(() => writeJSON(K.daily, store.daily), 3000);

  GG.store = store;
  GG.KEYS = K;
  GG.DEFAULTS = { settings: DEFAULT_SETTINGS, sensors: DEFAULT_SENSORS };

  window.addEventListener('beforeunload', () => store.flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); });
})();
