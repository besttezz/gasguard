'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const dashboard = require('../js/device-dashboard.js');

console.log('Running DASH-1 real-device dashboard tests...\n');

const root = path.join(__dirname, '..');
const now = Date.parse('2026-09-29T10:00:00Z');
const at = secondsAgo => new Date(now - secondsAgo * 1000).toISOString();
const container = () => ({ innerHTML: '', querySelector: () => null });
const workspace = { id: 'hardware-pilot', expectedDevice: 'ESP32-KITCHEN-01', expectedSensors: ['MQ2-01', 'MQ3-01', 'MQ6-01'] };

// [1] Waiting: guide shown, no invented numbers, expected MQ-6/MQ-2 cards stay empty, unused MQ-3 hidden
let c = container();
dashboard.render(c, { connection: 'WAITING_FOR_DEVICE', history: [], sensorLatest: {} }, { workspace, now });
assert.match(c.innerHTML, /รอข้อมูลจากอุปกรณ์/);
assert.match(c.innerHTML, /ยังไม่มีข้อมูลจากบอร์ด/);
assert.match(c.innerHTML, /MQ-6[\s\S]*ยังไม่มีข้อมูลจากเซ็นเซอร์นี้/);
assert.match(c.innerHTML, /MQ-2/);
assert.ok(!/MQ-3/.test(c.innerHTML), 'MQ-3 card only appears once that sensor reports');
assert.ok(!/ppm/.test(c.innerHTML.replace(/ยังไม่ใช่ ppm/g, '')), 'no ppm shown without data');
console.log('  [1] Waiting state shows setup guide and empty sensor cards, no fake values: PASS');

// [2] Online: per-sensor raw values, raw-data notice, chart series and recent table
const history = [];
for (let s = 600; s >= 5; s -= 10) {
  history.push({ sensorId: 'MQ6-01', rawAdc: 1800 + (600 - s) / 10, sensorVoltage: 1.45, receivedAt: at(s) });
  history.push({ sensorId: 'MQ2-01', rawAdc: 1450, sensorVoltage: 1.17, receivedAt: at(s - 1) });
}
const sensorLatest = {
  'MQ6-01': { sensorId: 'MQ6-01', rawAdc: 1859, sensorVoltage: 1.45, calibrationStatus: 'CALIBRATION_REQUIRED', receivedAt: at(5) },
  'MQ2-01': { sensorId: 'MQ2-01', rawAdc: 1450, sensorVoltage: 1.17, calibrationStatus: 'CALIBRATION_REQUIRED', receivedAt: at(4) }
};
const online = { connection: 'ONLINE', lastTelemetry: at(4), dataClassification: 'DEVICE_DATA', deviceId: 'ESP32-KITCHEN-01', history, sensorLatest };
c = container();
dashboard.render(c, online, { workspace, now });
assert.match(c.innerHTML, /ออนไลน์/);
assert.match(c.innerHTML, /ข้อมูลจริงจากเซ็นเซอร์/);
assert.match(c.innerHTML, /<strong>1859<\/strong><span>ADC<\/span>/);
assert.match(c.innerHTML, /<strong>1450<\/strong><span>ADC<\/span>/);
assert.match(c.innerHTML, /ค่าดิบจากเซ็นเซอร์ \(ADC 0–4095\)/);
assert.strictEqual((c.innerHTML.match(/<path d="M/g) || []).length, 2, 'one chart line per sensor');
assert.strictEqual((c.innerHTML.match(/<tr><td>/g) || []).length, 10, 'recent table lists 10 rows');
assert.ok(c.innerHTML.indexOf('MQ-6') < c.innerHTML.indexOf('MQ-2'), 'MQ-6 (primary) listed before MQ-2');
console.log('  [2] Online state renders MQ-6/MQ-2 raw values, notice, 2-series chart and latest table: PASS');

// [3] Gaps break the line; offline dims cards; injected text is escaped
c = container();
const gappy = [{ sensorId: 'MQ6-01', rawAdc: 1800, receivedAt: at(900) }, { sensorId: 'MQ6-01', rawAdc: 1810, receivedAt: at(890) }, { sensorId: 'MQ6-01', rawAdc: 1820, receivedAt: at(300) }];
dashboard.render(c, { ...online, connection: 'OFFLINE', deviceId: '<img onerror=x>', history: gappy }, { workspace, now });
assert.match(c.innerHTML, /<path d="M[^"]*M/, 'a gap over 60 s starts a new segment');
assert.match(c.innerHTML, /device-sensor is-stale/);
assert.match(c.innerHTML, /ออฟไลน์/);
assert.ok(!c.innerHTML.includes('<img onerror'), 'device id is HTML-escaped');
console.log('  [3] Data gaps split the line, offline cards dim, untrusted text escaped: PASS');

// [4] Status mapping used by the sidebar and header
assert.strictEqual(dashboard.statusOf({ connection: 'ONLINE', lastTelemetry: at(3) }).key, 'online');
assert.strictEqual(dashboard.statusOf({ connection: 'OFFLINE' }).key, 'offline');
assert.strictEqual(dashboard.statusOf({ ingress: 'UNAVAILABLE', connection: 'ONLINE' }).key, 'error');
assert.strictEqual(dashboard.statusOf({}).key, 'waiting');
console.log('  [4] Status mapping online/offline/error/waiting: PASS');

// [5] App wiring: signed-in default is the real device, mock pages and menus hidden in device mode
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
assert.match(app, /workspaces\.get\(workspaceRequest\|\|'hardware-pilot'\)/);
assert.match(app, /if\(!token\)return;headers\.authorization=/, 'status is only polled with a session');
assert.match(app, /setInterval\(refreshDeviceWorkspaceStatus,5000\)/);
const theme = fs.readFileSync(path.join(root, 'css/app-theme.css'), 'utf8');
assert.match(theme, /body\.has-device-dashboard \.mobile-navigation,/);
assert.match(app, /function renderDeviceNavigation\(target\)/, 'device workspaces get their own sidebar menu instead of an empty sidebar');
assert.match(app, /page-title'\)\.textContent=activeWorkspace\.mode==='DEVICE'\?deviceTitle\(\)/, 'device title is set on first paint');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /id="device-dashboard" hidden/);
assert.match(html, /<script src="js\/device-dashboard\.js"><\/script>/);
console.log('  [5] Signed-in default is the real device; demo menus hidden; dashboard wired: PASS');

// [6] Calibrated device ppm becomes the headline value and the chart switches to ppm
c = container();
const ppmHistory = [
  { sensorId: 'MQ6-01', rawAdc: 1100, sensorVoltage: 1.05, gasPpm: 3.2, receivedAt: at(20) },
  { sensorId: 'MQ6-01', rawAdc: 1120, sensorVoltage: 1.06, gasPpm: 3.4, receivedAt: at(10) },
  { sensorId: 'MQ2-01', rawAdc: 195, sensorVoltage: 0.31, gasPpm: 2.4, receivedAt: at(9) }
];
const ppmLatest = {
  'MQ6-01': { ...ppmHistory[1], calibrationStatus: 'CALIBRATED' },
  'MQ2-01': { ...ppmHistory[2], calibrationStatus: 'CALIBRATED' }
};
dashboard.render(c, { ...online, history: ppmHistory, sensorLatest: ppmLatest }, { workspace, now });
assert.match(c.innerHTML, /<strong>3\.4<\/strong><span>ppm \(ประมาณ\)<\/span>/);
assert.match(c.innerHTML, /<strong>2\.4<\/strong><span>ppm \(ประมาณ\)<\/span>/);
assert.match(c.innerHTML, /หน่วย: ppm/);
assert.match(c.innerHTML, /ค่าประมาณ/);
assert.ok(!/ค่าดิบจากเซ็นเซอร์ \(ADC 0–4095\)/.test(c.innerHTML), 'raw-only notice hidden once ppm arrives');
console.log('  [6] Calibrated ppm shown as headline value, chart in ppm, estimate notice: PASS');

console.log('\nALL DASH-1 DEVICE DASHBOARD TESTS PASSED!');
