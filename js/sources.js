/* ============================================================
   GasGuard v2 — sources.js
   แหล่งข้อมูล: โหมดจำลอง / REST API / MQTT over WebSocket
   ============================================================ */
(function () {
  'use strict';

  const GG = window.GG;
  const { store, bus, util } = GG;

  const MQTT_CDN = 'https://unpkg.com/mqtt@5.3.5/dist/mqtt.min.js';

  const sources = {
    mode: 'sim',
    status: 'idle',        // idle | connecting | connected | error
    lastMessage: 0,
    logs: [],
    _simTimer: null,
    _restTimer: null,
    _mqttClient: null,
    _paused: false,
    _simState: {},

    /* ---------- logging ---------- */
    log(msg, kind) {
      const line = { t: Date.now(), msg, kind: kind || 'info' };
      this.logs.unshift(line);
      if (this.logs.length > 40) this.logs.length = 40;
      bus.emit('conn-log', line);
    },

    setStatus(status, message) {
      this.status = status;
      bus.emit('conn', { status, mode: this.mode, message: message || '' });
      if (message) this.log(message, status === 'error' ? 'error' : 'info');
    },

    /* ---------- lifecycle ---------- */
    start() {
      this.stop();
      this.mode = store.settings.source.mode || 'sim';
      if (this.mode === 'sim') this.startSim();
      else if (this.mode === 'rest') this.startRest();
      else if (this.mode === 'mqtt') this.startMqtt();
    },

    stop() {
      clearInterval(this._simTimer); this._simTimer = null;
      clearInterval(this._restTimer); this._restTimer = null;
      if (this._mqttClient) {
        try { this._mqttClient.end(true); } catch (e) {}
        this._mqttClient = null;
      }
      this.setStatus('idle');
    },

    pause(v) { this._paused = !!v; },

    /* ---------- ingest ---------- */
    ingest(devId, payload) {
      if (!devId) return;
      let sensor = store.sensorByDevId(devId);
      if (!sensor) {
        // อุปกรณ์ใหม่ที่ยังไม่ได้ลงทะเบียน -> เพิ่มให้อัตโนมัติ
        sensor = store.upsertSensor({
          uid: util.uid('sn'), devId, name: 'เซ็นเซอร์ ' + devId, location: 'ยังไม่ระบุตำแหน่ง',
          type: 'LPG', warn: null, danger: null, offset: 0, simLevel: 'low', enabled: true
        });
        store.addEvent({ level: 'system', title: 'พบอุปกรณ์ใหม่', text: `ลงทะเบียนเซ็นเซอร์ "${devId}" อัตโนมัติ — แก้ไขชื่อ/ตำแหน่งได้ที่หน้าจัดการเซ็นเซอร์`, sensorId: devId });
      }
      this.lastMessage = Date.now();
      const rec = store.pushReading(devId, payload);
      if (rec) GG.alerts.evaluate(sensor, rec);
    },

    normalize(obj, topicId) {
      if (obj == null) return null;
      if (typeof obj === 'number') return { id: topicId, ppm: obj };
      if (typeof obj === 'string') {
        const n = parseFloat(obj);
        if (!isNaN(n)) return { id: topicId, ppm: n };
        try { obj = JSON.parse(obj); } catch (e) { return null; }
      }
      const id = obj.id || obj.deviceId || obj.device_id || obj.sensor || obj.sensorId || obj.name || topicId;
      const ppm = obj.ppm != null ? obj.ppm
        : obj.value != null ? obj.value
        : obj.gas != null ? obj.gas
        : obj.reading != null ? obj.reading
        : obj.level != null ? obj.level : null;
      if (id == null || ppm == null) return null;
      return {
        id: String(id),
        ppm: Number(ppm),
        temp: obj.temp != null ? Number(obj.temp) : (obj.temperature != null ? Number(obj.temperature) : null),
        hum: obj.hum != null ? Number(obj.hum) : (obj.humidity != null ? Number(obj.humidity) : null),
        t: obj.t || obj.time || obj.timestamp ? new Date(obj.t || obj.time || obj.timestamp).getTime() : Date.now()
      };
    },

    ingestPayload(raw, topicId) {
      let data = raw;
      if (typeof raw === 'string') {
        try { data = JSON.parse(raw); } catch (e) { data = raw; }
      }
      let list = [];
      if (Array.isArray(data)) list = data;
      else if (data && Array.isArray(data.sensors)) list = data.sensors;
      else if (data && Array.isArray(data.data)) list = data.data;
      else if (data && Array.isArray(data.readings)) list = data.readings;
      else if (data && typeof data === 'object' && !data.id && !data.ppm && !data.value) {
        // รูปแบบ { "kitchen-01": 142, "boiler-01": {ppm: 700} }
        list = Object.keys(data).map(k => {
          const v = data[k];
          return (typeof v === 'object') ? Object.assign({ id: k }, v) : { id: k, ppm: v };
        });
      } else list = [data];

      let n = 0;
      list.forEach(item => {
        const norm = this.normalize(item, topicId);
        if (norm && !isNaN(norm.ppm)) { this.ingest(norm.id, norm); n++; }
      });
      return n;
    },

    /* ---------- SIMULATION ---------- */
    startSim() {
      this.mode = 'sim';
      this.setStatus('connected', 'เริ่มโหมดจำลองข้อมูล');
      const tick = () => {
        if (this._paused || document.hidden && false) return;
        const scenario = (store.settings.source.sim || {}).scenario || 'normal';
        store.enabledSensors().forEach((s, idx) => {
          const st = (this._simState[s.devId] = this._simState[s.devId] || { v: null, drift: 0, leakUntil: 0 });
          const th = store.thresholdsFor(s);
          let base;
          if (scenario === 'calm') base = th.warn * 0.25;
          else if (s.simLevel === 'high') base = th.danger * 0.82;
          else if (s.simLevel === 'mid') base = th.warn * 1.1;
          else base = th.warn * 0.35;

          if (st.v == null) st.v = base;

          // เหตุการณ์รั่วสุ่ม (โหมด leak ถี่, โหมดปกตินาน ๆ ครั้ง)
          const leakChance = scenario === 'leak' ? 0.02 : scenario === 'normal' ? 0.002 : 0;
          if (leakChance && Date.now() > st.leakUntil && Math.random() < leakChance) {
            st.leakUntil = Date.now() + util.randomInRange(20, 45) * 1000;
          }
          const leaking = Date.now() < st.leakUntil;
          const target = leaking ? th.danger * util.randomInRange(105, 140) / 100 : base;

          st.v += (target - st.v) * 0.15 + (Math.random() - 0.5) * base * 0.12;
          st.v = Math.max(5, st.v);

          this.ingest(s.devId, {
            ppm: Math.round(st.v),
            temp: Math.round((26 + idx * 2 + Math.random() * 4) * 10) / 10,
            hum: Math.round(50 + idx * 4 + Math.random() * 10),
            t: Date.now()
          });
        });
      };
      tick();
      this._simTimer = setInterval(tick, 2000);
    },

    /* ---------- REST ---------- */
    async fetchRest(silent) {
      const cfg = store.settings.source.rest || {};
      if (!cfg.url) { this.setStatus('error', 'ยังไม่ได้ตั้งค่า URL ของ API'); return 0; }
      const headers = { 'Accept': 'application/json' };
      if (cfg.key) headers['X-API-Key'] = cfg.key;
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(cfg.url, { headers, signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(to);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        const n = this.ingestPayload(text);
        if (n > 0) {
          if (this.status !== 'connected') this.setStatus('connected', `เชื่อมต่อ API สำเร็จ (${n} เซ็นเซอร์)`);
        } else if (!silent) {
          this.setStatus('error', 'เชื่อมต่อได้ แต่อ่านข้อมูลไม่ได้ — ตรวจรูปแบบ JSON');
        }
        return n;
      } catch (err) {
        const msg = err.name === 'AbortError' ? 'หมดเวลารอ API' : ('เชื่อมต่อ API ไม่สำเร็จ: ' + err.message);
        this.setStatus('error', msg);
        return 0;
      }
    },

    startRest() {
      this.mode = 'rest';
      const cfg = store.settings.source.rest || {};
      const interval = Math.max(1, Number(cfg.interval) || 5) * 1000;
      this.setStatus('connecting', 'กำลังเชื่อมต่อ REST API…');
      this.fetchRest();
      this._restTimer = setInterval(() => { if (!this._paused) this.fetchRest(true); }, interval);
    },

    /* ---------- MQTT ---------- */
    loadMqttLib() {
      if (window.mqtt) return Promise.resolve(window.mqtt);
      if (this._mqttLibPromise) return this._mqttLibPromise;
      this._mqttLibPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = MQTT_CDN;
        s.onload = () => resolve(window.mqtt);
        s.onerror = () => reject(new Error('โหลดไลบรารี MQTT ไม่สำเร็จ (ตรวจอินเทอร์เน็ต)'));
        document.head.appendChild(s);
      });
      return this._mqttLibPromise;
    },

    async startMqtt() {
      this.mode = 'mqtt';
      const cfg = store.settings.source.mqtt || {};
      if (!cfg.url) { this.setStatus('error', 'ยังไม่ได้ตั้งค่า Broker URL'); return; }
      this.setStatus('connecting', 'กำลังเชื่อมต่อ MQTT…');
      let mqttLib;
      try { mqttLib = await this.loadMqttLib(); }
      catch (e) { this.setStatus('error', e.message); return; }

      try {
        const opts = {
          clientId: 'gasguard-web-' + Math.random().toString(16).slice(2, 8),
          reconnectPeriod: 5000, connectTimeout: 10000, clean: true
        };
        if (cfg.user) opts.username = cfg.user;
        if (cfg.pass) opts.password = cfg.pass;

        const client = mqttLib.connect(cfg.url, opts);
        this._mqttClient = client;

        client.on('connect', () => {
          this.setStatus('connected', 'เชื่อมต่อ MQTT broker สำเร็จ');
          client.subscribe(cfg.topic || 'gasguard/+/reading', { qos: 0 }, (err) => {
            if (err) this.setStatus('error', 'subscribe ไม่สำเร็จ: ' + err.message);
            else this.log('subscribe: ' + (cfg.topic || 'gasguard/+/reading'));
          });
        });
        client.on('reconnect', () => this.setStatus('connecting', 'กำลังเชื่อมต่อใหม่…'));
        client.on('offline', () => this.setStatus('error', 'MQTT offline'));
        client.on('error', (err) => this.setStatus('error', 'MQTT: ' + (err && err.message ? err.message : 'ผิดพลาด')));
        client.on('message', (topic, message) => {
          if (this._paused) return;
          const parts = String(topic).split('/');
          const topicId = parts.length >= 2 ? parts[1] : topic;
          const n = this.ingestPayload(message.toString(), topicId);
          if (n && this.status !== 'connected') this.setStatus('connected', 'รับข้อมูลจาก MQTT แล้ว');
        });
      } catch (e) {
        this.setStatus('error', 'MQTT ผิดพลาด: ' + e.message);
      }
    },

    /* ---------- test helpers ---------- */
    async testRest() {
      this.log('ทดสอบเรียก API…');
      const n = await this.fetchRest();
      return n;
    }
  };

  GG.sources = sources;
})();
