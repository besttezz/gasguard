(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GasGuardDeviceDashboard = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  // Real-device dashboard. Renders only what the device actually sent (via /api/v1/device/status);
  // there is no simulated fallback. Raw MQ readings are shown as ADC/voltage until calibration exists.

  const SENSOR_INFO = Object.freeze({
    'MQ6-01': { name: 'MQ-6', role: 'แก๊ส LPG · เซ็นเซอร์หลัก', color: 'var(--series-1)' },
    'MQ2-01': { name: 'MQ-2', role: 'แก๊ส LPG / ควัน · เซ็นเซอร์เสริม', color: 'var(--series-2)' },
    'MQ3-01': { name: 'MQ-3', role: 'ไอระเหย / แอลกอฮอล์ · เซ็นเซอร์เสริม', color: 'var(--series-3)' }
  });
  const SENSOR_ORDER = ['MQ6-01', 'MQ2-01', 'MQ3-01'];
  const CLASSIFICATION = Object.freeze({
    DEVICE_DATA: 'ข้อมูลจริงจากเซ็นเซอร์',
    SYNTHETIC_HANDSHAKE: 'ค่าทดสอบการเชื่อมต่อ (ไม่ใช่ค่าเซ็นเซอร์)',
    VIRTUAL_TEST_DATA: 'บอร์ดจำลองสำหรับทดสอบ'
  });
  const GAP_MS = 60 * 1000;
  const WINDOW_MS = 60 * 60 * 1000;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const info = id => SENSOR_INFO[id] || { name: id, role: 'เซ็นเซอร์', color: 'var(--series-3)' };
  const sortSensors = ids => [...ids].sort((a, b) => (SENSOR_ORDER.indexOf(a) + 1 || 99) - (SENSOR_ORDER.indexOf(b) + 1 || 99));
  const clock = ms => new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function ago(iso, now) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return 'ไม่ทราบเวลา';
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 60) return `${s} วินาทีที่แล้ว`;
    if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
    return `เมื่อ ${clock(ms)}`;
  }

  function statusOf(state) {
    if (state?.ingress === 'UNAVAILABLE') return { key: 'error', label: 'เชื่อมต่อระบบไม่ได้', hint: 'โหลดสถานะไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ' };
    if (state?.connection === 'ONLINE') return { key: 'online', label: 'ออนไลน์', hint: `ได้รับข้อมูลล่าสุด ${ago(state.lastTelemetry, Date.now())}` };
    if (state?.connection === 'OFFLINE') return { key: 'offline', label: 'ออฟไลน์', hint: `ไม่มีข้อมูลเข้ามาเกิน 30 วินาที · ล่าสุด ${ago(state.lastTelemetry, Date.now())}` };
    return { key: 'waiting', label: 'รอข้อมูลจากอุปกรณ์', hint: 'ยังไม่เคยได้รับข้อมูลจากบอร์ดนี้' };
  }

  function sensorCard(id, reading, stale, now) {
    const meta = info(id);
    if (!reading) {
      return `<article class="device-sensor is-empty"><header><span class="device-sensor-swatch" style="background:${meta.color}"></span><div><strong>${esc(meta.name)}</strong><small>${esc(meta.role)}</small></div></header><p class="device-sensor-empty">ยังไม่มีข้อมูลจากเซ็นเซอร์นี้</p></article>`;
    }
    const adc = Number.isFinite(reading.rawAdc) ? reading.rawAdc : null;
    const pct = adc == null ? 0 : Math.round((adc / 4095) * 100);
    const volts = Number.isFinite(reading.sensorVoltage) ? `${Number(reading.sensorVoltage).toFixed(2)} V` : '—';
    const calibrated = reading.calibrationStatus === 'CALIBRATED';
    return `<article class="device-sensor${stale ? ' is-stale' : ''}">
      <header><span class="device-sensor-swatch" style="background:${meta.color}"></span><div><strong>${esc(meta.name)}</strong><small>${esc(meta.role)}</small></div></header>
      <div class="device-sensor-value"><strong>${adc == null ? '—' : adc}</strong><span>ADC</span></div>
      <div class="device-sensor-bar" role="img" aria-label="ระดับสัญญาณ ${pct}% ของช่วง ADC"><i style="width:${pct}%;background:${meta.color}"></i></div>
      <dl><div><dt>แรงดัน</dt><dd>${esc(volts)}</dd></div><div><dt>สถานะ</dt><dd>${calibrated ? 'คาลิเบรตแล้ว' : 'ค่าดิบ · ยังไม่คาลิเบรต'}</dd></div><div><dt>อัปเดต</dt><dd>${esc(ago(reading.receivedAt, now))}</dd></div></dl>
    </article>`;
  }

  // Line chart of raw ADC per sensor over the last hour; lines break where data has gaps.
  function chart(history, now) {
    const points = history.filter(p => Number.isFinite(p.rawAdc) && Number.isFinite(Date.parse(p.receivedAt)));
    if (!points.length) return '<div class="device-chart-empty">ยังไม่มีข้อมูลใน 60 นาทีที่ผ่านมา</div>';
    const W = 720, H = 240, L = 48, R = 12, T = 12, B = 28;
    const start = now - WINDOW_MS;
    let min = Math.min(...points.map(p => p.rawAdc)), max = Math.max(...points.map(p => p.rawAdc));
    const pad = Math.max(20, (max - min) * 0.15);
    min = Math.max(0, Math.floor((min - pad) / 10) * 10); max = Math.min(4095, Math.ceil((max + pad) / 10) * 10);
    if (max <= min) max = min + 10;
    const x = t => L + ((t - start) / WINDOW_MS) * (W - L - R);
    const y = v => T + (1 - (v - min) / (max - min)) * (H - T - B);
    const grid = [0, 1, 2, 3, 4].map(i => {
      const v = min + ((max - min) * i) / 4;
      return `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="device-chart-grid"/><text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="device-chart-label">${Math.round(v)}</text>`;
    }).join('');
    const ticks = [60, 45, 30, 15, 0].map(m => {
      const t = now - m * 60000;
      return `<text x="${x(t).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="device-chart-label">${m === 0 ? 'ตอนนี้' : `-${m} นาที`}</text>`;
    }).join('');
    const bySensor = {};
    for (const p of points) (bySensor[p.sensorId] = bySensor[p.sensorId] || []).push(p);
    const ids = sortSensors(Object.keys(bySensor));
    const lines = ids.map(id => {
      let d = '', prev = null;
      for (const p of bySensor[id]) {
        const t = Date.parse(p.receivedAt);
        if (t < start) continue;
        d += `${prev == null || t - prev > GAP_MS ? 'M' : 'L'}${x(t).toFixed(1)},${y(p.rawAdc).toFixed(1)} `;
        prev = t;
      }
      const last = bySensor[id][bySensor[id].length - 1];
      return `<path d="${d.trim()}" fill="none" stroke="${info(id).color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(Date.parse(last.receivedAt)).toFixed(1)}" cy="${y(last.rawAdc).toFixed(1)}" r="3.5" fill="${info(id).color}"/>`;
    }).join('');
    const legend = ids.map(id => `<span><i style="background:${info(id).color}"></i>${esc(info(id).name)}</span>`).join('');
    return `<div class="device-chart-legend">${legend}</div><svg class="device-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="กราฟค่า ADC ของเซ็นเซอร์ย้อนหลัง 60 นาที">${grid}${ticks}${lines}</svg>`;
  }

  function table(history) {
    const rows = history.slice(-10).reverse();
    if (!rows.length) return '<p class="device-muted">ยังไม่มีข้อมูล</p>';
    return `<table class="device-table"><thead><tr><th>เวลา</th><th>เซ็นเซอร์</th><th>ADC</th><th>แรงดัน</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(clock(Date.parse(r.receivedAt)))}</td><td>${esc(info(r.sensorId).name)}</td><td>${Number.isFinite(r.rawAdc) ? r.rawAdc : '—'}</td><td>${Number.isFinite(r.sensorVoltage) ? `${Number(r.sensorVoltage).toFixed(2)} V` : '—'}</td></tr>`).join('')}</tbody></table>`;
  }

  function waitingGuide() {
    return `<section class="device-panel device-guide"><h3>ยังไม่มีข้อมูลจากบอร์ด</h3><ol>
      <li>แฟลชโค้ด <code>firmware/esp32-handshake</code> พร้อมไฟล์ <code>secrets.h</code> ที่มี device key</li>
      <li>ใส่ชื่อและรหัส Wi-Fi ที่บอร์ดจะใช้ แล้วเปิดบอร์ด</li>
      <li>ดู Serial Monitor (115200) ถ้าขึ้น <code>HTTP=202</code> หน้านี้จะแสดงข้อมูลภายในไม่กี่วินาที</li>
    </ol></section>`;
  }

  function render(container, state, options = {}) {
    if (!container) return;
    const now = options.now || Date.now();
    const status = statusOf(state);
    const stale = status.key !== 'online';
    const latest = state?.sensorLatest || state?.latestMeasurementsBySensor || {};
    const expected = options.workspace?.expectedSensors || [];
    const ids = sortSensors(new Set([...Object.keys(latest), ...expected.filter(id => id !== 'MQ3-01' || latest[id])]));
    const history = Array.isArray(state?.history) ? state.history : [];
    const deviceId = state?.deviceId || options.workspace?.expectedDevice || 'ESP32';
    const classification = CLASSIFICATION[state?.dataClassification];
    const raw = Object.values(latest).some(r => r && r.calibrationStatus !== 'CALIBRATED');
    const switchLink = options.canSwitchWorkspace
      ? `<a class="device-link" href="?workspace=${options.workspace?.id === 'device-test' ? 'hardware-pilot' : 'device-test'}">${options.workspace?.id === 'device-test' ? 'ดูบอร์ดจริง' : 'ดูบอร์ดจำลอง (ทดสอบ)'}</a>`
      : '';
    const signOut = options.showSignOut ? '<button class="button button-secondary" type="button" data-device-sign-out>ออกจากระบบ</button>' : '';

    container.innerHTML = `
      <header class="device-head">
        <div><p class="device-eyebrow">${options.workspace?.id === 'device-test' ? 'บอร์ดจำลอง' : 'อุปกรณ์จริง'}</p><h2>${esc(deviceId)}</h2><p class="device-muted">Restaurant A · Kitchen${classification ? ` · ${esc(classification)}` : ''}</p></div>
        <div class="device-head-side"><div class="device-status is-${status.key}"><span class="device-dot"></span><div><strong>${esc(status.label)}</strong><small>${esc(status.hint)}</small></div></div>${switchLink}${signOut}</div>
      </header>
      ${raw ? '<p class="device-note">ค่าที่แสดงเป็น <strong>ค่าดิบจากเซ็นเซอร์ (ADC 0–4095)</strong> ยังไม่ใช่ ppm เพราะยังไม่ได้คาลิเบรต ใช้ดูแนวโน้มขึ้น-ลงได้ แต่ยังใช้ประเมินความเข้มข้นแก๊สไม่ได้</p>' : ''}
      ${state?.connection === 'WAITING_FOR_DEVICE' && !history.length ? waitingGuide() : ''}
      <div class="device-sensors">${ids.map(id => sensorCard(id, latest[id], stale, now)).join('')}</div>
      <section class="device-panel"><div class="device-panel-head"><h3>ค่าเซ็นเซอร์ย้อนหลัง 60 นาที</h3><span class="device-muted">อัปเดตทุก 5 วินาที</span></div>${chart(history, now)}</section>
      <section class="device-panel"><div class="device-panel-head"><h3>ข้อมูลล่าสุด</h3><span class="device-muted">${history.length} รายการใน 60 นาที</span></div>${table(history)}</section>`;

    const button = container.querySelector('[data-device-sign-out]');
    if (button && options.onSignOut) button.addEventListener('click', options.onSignOut);
  }

  return Object.freeze({ render, statusOf, SENSOR_INFO });
});
