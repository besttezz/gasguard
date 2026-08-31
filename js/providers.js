(function () {
  'use strict';
  const engine = window.GasGuardEngine;
  const providers = { status: 'simulation', message: 'Mock provider · 2s interval', _lastRest: 0, _mqtt: null, _mqttLoading: null,
    setStatus(status, message) { this.status = status; this.message = message; },
    async tick() {
      const source = engine.state.source;
      if (source.mode === 'simulation') { this.setStatus('simulation', 'Mock provider · 2s interval'); return engine.tick(); }
      if (source.mode === 'rest') return this.fetchRest(source);
      if (source.mode === 'mqtt') return this.ensureMqtt(source);
    },
    async fetchRest(source) {
      if (!source.restUrl) { this.setStatus('error', 'REST endpoint ยังไม่ได้ตั้งค่า'); return engine.analysis; }
      if (Date.now() - this._lastRest < 4500) return engine.analysis;
      this._lastRest = Date.now(); this.setStatus('connecting', 'กำลังอ่าน REST API');
      try {
        const response = await fetch(source.restUrl, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json(); const rows = Array.isArray(data) ? data : (data.readings || data.data || data.sensors || [data]);
        const accepted = rows.some(row => engine.ingest(row));
        this.setStatus(accepted ? 'online' : 'error', accepted ? `REST connected · ${rows.length} reading(s)` : 'REST payload ไม่มี LPG reading ที่ใช้ได้');
      } catch (error) { this.setStatus('error', `REST error · ${error.message}`); }
      return engine.analysis;
    },
    async ensureMqtt(source) {
      if (!source.mqttUrl) { this.setStatus('error', 'MQTT broker URL ยังไม่ได้ตั้งค่า'); return engine.analysis; }
      if (this._mqtt) return engine.analysis;
      this.setStatus('connecting', 'กำลังเชื่อมต่อ MQTT');
      try {
        if (!window.mqtt) {
          if (!this._mqttLoading) this._mqttLoading = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/mqtt@5.3.5/dist/mqtt.min.js'; s.onload = resolve; s.onerror = () => reject(new Error('โหลด MQTT client ไม่สำเร็จ')); document.head.append(s); });
          await this._mqttLoading;
        }
        this._mqtt = window.mqtt.connect(source.mqttUrl, { reconnectPeriod: 5000, connectTimeout: 10000, clean: true, clientId: `gasguard-${Math.random().toString(16).slice(2,8)}` });
        this._mqtt.on('connect', () => { this._mqtt.subscribe(source.topic || 'gasguard/+/reading'); this.setStatus('online', `MQTT subscribed · ${source.topic || 'gasguard/+/reading'}`); });
        this._mqtt.on('message', (_topic, message) => { try { engine.ingest(JSON.parse(message.toString())); } catch (e) {} });
        this._mqtt.on('error', err => this.setStatus('error', `MQTT error · ${err.message}`));
        this._mqtt.on('offline', () => this.setStatus('error', 'MQTT offline'));
      } catch (error) { this.setStatus('error', `MQTT setup · ${error.message}`); }
      return engine.analysis;
    },
    reset() { if (this._mqtt) { try { this._mqtt.end(true); } catch (e) {} this._mqtt = null; } }
  };
  window.GasGuardProviders = providers;
})();
