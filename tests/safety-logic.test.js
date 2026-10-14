'use strict';

const assert = require('node:assert');
const logic = require('../js/safety-logic.js');

console.log('Running SAFE-1 safety logic tests...\n');

const now = Date.parse('2026-10-14T10:00:00Z');
const at = s => new Date(now - s * 1000).toISOString();
const series = values => values.map((ppm, i) => ({ t: now - (values.length - 1 - i) * 10e3, ppm }));

// [1] Thresholds: 4 colour levels, shared with firmware (5 / 10 / 20 % LEL of 18,000 ppm)
assert.strictEqual(logic.LEL_PPM, 18000);
assert.deepStrictEqual({ ...logic.THRESHOLDS }, { watch: 900, warning: 1800, danger: 3600 });
assert.strictEqual(logic.classify(null).key, 'unknown');
assert.strictEqual(logic.classify(0).key, 'safe');
assert.strictEqual(logic.classify(899).key, 'safe');
assert.strictEqual(logic.classify(900).key, 'watch');
assert.strictEqual(logic.classify(1800).key, 'warning');
assert.strictEqual(logic.classify(3600).key, 'danger');
for (const key of logic.ORDER) assert.ok(logic.LEVELS[key].actions.length >= 2, `${key} has action guidance`);
assert.match(logic.LEVELS.safe.headline, /จุดเตาได้/);
assert.match(logic.LEVELS.warning.actions.join(' '), /ห้ามเปิด-ปิดสวิตช์ไฟ/);
assert.match(logic.LEVELS.watch.actions.join(' '), /เปิดประตูและหน้าต่าง/, 'ventilate first when gas starts to build up');
assert.match(logic.LEVELS.danger.actions.join(' '), /199/);
console.log('  [1] Four levels with action guidance at 900 / 1,800 / 3,600 ppm: PASS');

// [2] Pattern: spike vs slow accumulation vs stable/falling
assert.strictEqual(logic.pattern(series([150, 160]), now).key, 'none');
assert.strictEqual(logic.pattern(series([150, 155, 150, 152, 151]), now).key, 'stable');
assert.strictEqual(logic.pattern(series([150, 160, 170, 2600]), now).key, 'spike');
assert.strictEqual(logic.pattern(series([100, 130, 160, 190, 220, 250, 280]), now).key, 'accumulating');
assert.strictEqual(logic.pattern(series([3000, 2600, 2200, 1800, 1400]), now).key, 'falling');
console.log('  [2] Pattern detects spike, accumulation, stable and falling: PASS');

// [3] Trend escalation: a spike is warned one level early, accumulation in clean air asks to ventilate
assert.strictEqual(logic.levelWithTrend(2600, { key: 'spike' }).level.key, 'danger');
assert.strictEqual(logic.levelWithTrend(4000, { key: 'spike' }).level.key, 'danger');
assert.strictEqual(logic.levelWithTrend(400, { key: 'accumulating' }).level.key, 'watch');
assert.strictEqual(logic.levelWithTrend(400, { key: 'stable' }).level.key, 'safe');
console.log('  [3] Spike escalates one level, accumulation in safe range becomes watch: PASS');

// [4] Sensor health: wiring fault (ADC ~0), stale, saturated, flat-lined
assert.strictEqual(logic.sensorHealth({ rawAdc: 3, receivedAt: at(2) }, [], now).key, 'low');
assert.strictEqual(logic.sensorHealth({ rawAdc: 1500, receivedAt: at(45) }, [], now).key, 'stale');
assert.strictEqual(logic.sensorHealth({ rawAdc: 4095, receivedAt: at(2) }, [], now).key, 'saturated');
const flat = Array.from({ length: 12 }, () => ({ rawAdc: 1200 }));
assert.strictEqual(logic.sensorHealth({ rawAdc: 1200, receivedAt: at(2) }, flat, now).key, 'flat');
assert.strictEqual(logic.sensorHealth({ rawAdc: 1200, gasPpm: 150, receivedAt: at(2) }, [], now).key, 'ok');
console.log('  [4] Sensor health flags wiring, stale, saturated and stuck sensors: PASS');

// [5] Whole-site assessment and the pre-cook check
const reading = (id, ppm, s, adc = 1200) => ({ sensorId: id, gasPpm: ppm, rawAdc: adc, calibrationStatus: 'CALIBRATED', receivedAt: at(s) });
const history = [30, 20, 10, 2].flatMap(s => [reading('MQ6-01', 150, s), reading('MQ2-01', 90, s + 1)]);
const ok = logic.assess({ connection: 'ONLINE', history, sensorLatest: { 'MQ6-01': reading('MQ6-01', 150, 2), 'MQ2-01': reading('MQ2-01', 90, 3) } }, now);
assert.strictEqual(ok.level.key, 'safe');
assert.strictEqual(ok.readyToCook, true);
const hot = logic.assess({ connection: 'ONLINE', history, sensorLatest: { 'MQ6-01': reading('MQ6-01', 2000, 2), 'MQ2-01': reading('MQ2-01', 90, 3) } }, now);
assert.strictEqual(hot.level.key, 'warning');
assert.strictEqual(hot.worst.id, 'MQ6-01');
assert.strictEqual(hot.readyToCook, false);
const offline = logic.assess({ connection: 'OFFLINE', history, sensorLatest: { 'MQ6-01': reading('MQ6-01', 150, 2) } }, now);
assert.strictEqual(offline.level.key, 'unknown', 'no colour is claimed when the board is offline');
const wiring = logic.assess({ connection: 'ONLINE', history, sensorLatest: { 'MQ6-01': reading('MQ6-01', 2, 2, 3) } }, now);
assert.strictEqual(wiring.readyToCook, false, 'a wiring fault blocks the pre-cook check');
assert.strictEqual(logic.assess({ connection: 'ONLINE', history: [], sensorLatest: { 'MQ6-01': { sensorId: 'MQ6-01', rawAdc: 1800, calibrationStatus: 'CALIBRATION_REQUIRED', receivedAt: at(2) } } }, now).level.key, 'unknown', 'raw ADC alone is never turned into a colour');
console.log('  [5] Assessment picks the worst sensor; pre-cook check needs online, healthy, green, no trend: PASS');

// [6] Simulator: one reading per sensor per tick; the default scenario walks through every colour
const sim = logic.createSimulator({ scenario: 'cycle', seed: 7 });
const seen = new Set();
let simHistory = [];
for (let i = 0; i < 24; i++) {
  const t = now + i * 10e3;
  const ticks = sim.tick(t);
  assert.strictEqual(ticks.length, 2);
  assert.ok(ticks.every(r => r.calibrationStatus === 'SIMULATED' && Number.isFinite(r.gasPpm)));
  simHistory = simHistory.concat(ticks);
  const a = logic.assess({ connection: 'ONLINE', history: simHistory, sensorLatest: { 'MQ6-01': ticks[0], 'MQ2-01': ticks[1] } }, t);
  seen.add(a.level.key);
}
assert.deepStrictEqual([...seen].sort(), ['danger', 'safe', 'warning', 'watch']);
const leak = logic.createSimulator({ scenario: 'leak', seed: 3 });
let leakHistory = [], leakLevels = [];
for (let i = 0; i < 9; i++) {
  const t = now + i * 10e3, r = leak.tick(t);
  leakHistory = leakHistory.concat(r);
  leakLevels.push(logic.assess({ connection: 'ONLINE', history: leakHistory, sensorLatest: { 'MQ6-01': r[0], 'MQ2-01': r[1] } }, t).level.key);
}
assert.strictEqual(leakLevels[5], 'safe');
assert.strictEqual(leakLevels[6], 'danger', 'a sudden leak jumps straight to red through the spike rule');
assert.ok(Object.keys(logic.SCENARIOS).length >= 4);
console.log('  [6] Simulator cycles green → yellow → orange → red; leak scenario spikes to red: PASS');

console.log('\nALL SAFE-1 SAFETY LOGIC TESTS PASSED!');
