'use strict';

const assert = require('node:assert');
const L = require('../js/safety-logic.js');
const I = require('../js/incident.js');

console.log('Running INCIDENT-1 event explanation tests...\n');

const now = Date.parse('2026-11-02T10:00:00Z');
const iso = ms => new Date(ms).toISOString();
const plan = {
  rooms: [{ x: 0, y: 0, w: 500, h: 500, label: 'ห้องครัว' }],
  pins: [{ type: 'tank', x: 100, y: 120 }, { type: 'stove', x: 450, y: 450 },
    { type: 'sensor', label: 'A', sensorId: 'MQ6-01', x: 110, y: 200 }, { type: 'sensor', label: 'B', sensorId: 'MQ2-01', x: 420, y: 60 }]
};
// Builds a status payload: one reading per sensor every 10 s for the given ppm series (oldest first).
function state(a, b) {
  const history = [];
  a.forEach((v, i) => {
    const t = iso(now - (a.length - 1 - i) * 10e3);
    history.push({ sensorId: 'MQ6-01', gasPpm: v, receivedAt: t });
    history.push({ sensorId: 'MQ2-01', gasPpm: b[i], receivedAt: t });
  });
  const latest = {};
  history.forEach(r => { latest[r.sensorId] = r; });
  return { connection: 'ONLINE', history, sensorLatest: latest };
}

// [1] Nothing to explain while the rules say safe
let st = state([150, 160, 150, 155], [90, 95, 90, 92]);
assert.strictEqual(I.facts(L.assess(st, now), st.history, { plan, now }), null);
console.log('  [1] Safe readings produce no event: PASS');

// [2] Sudden leak at A near the tank: spike, escalated, one zone, start reading kept
st = state([150, 160, 150, 2600], [90, 95, 90, 300]);
let a = L.assess(st, now);
let f = I.facts(a, st.history, { plan, now });
assert.strictEqual(f.pattern, 'spike');
assert.strictEqual(f.level, 'danger', 'a spike warns one level early');
assert.strictEqual(f.escalated, true);
assert.deepStrictEqual([f.zone, f.room, f.near], ['A', 'ห้องครัว', 'tank']);
assert.strictEqual(f.start_ppm, 150);
assert.strictEqual(f.sensors_above_watch, 1);
assert.deepStrictEqual(f.others, [{ zone: 'B', ppm: 300, level: 'safe' }]);
let text = I.explain(f);
assert.match(text, /จุด A \(ห้องครัว ใกล้ถังแก๊ส\)/);
assert.match(text, /พุ่งขึ้นเร็วจาก 150 ppm/);
assert.match(text, /รั่วทันที/);
assert.match(text, /แหล่งรั่วน่าจะอยู่ใกล้จุด A/);
assert.ok(!Object.keys(f).some(k => /name|email|address/.test(k)), 'facts carry no personal data');
console.log('  [2] Sudden leak: spike, escalated, zone/room/near tank, plain Thai text: PASS');

// [3] Slow build-up over several minutes in both zones
const ramp = Array.from({ length: 31 }, (_, i) => 300 + i * 25);
st = state(ramp, ramp.map(v => Math.round(v * 0.9)));
a = L.assess(st, now);
f = I.facts(a, st.history, { plan, now });
assert.strictEqual(f.pattern, 'accumulating');
assert.strictEqual(f.level, 'watch');
assert.ok(f.rate_ppm_per_min >= 90);
assert.strictEqual(f.sensors_above_watch, 2);
assert.ok(f.minutes >= 1);
text = I.explain(f);
assert.match(text, /ค่อย ๆ เพิ่มขึ้นราว/);
assert.match(text, /จุดอื่นก็เริ่มพบแก๊ส/);
console.log('  [3] Slow build-up: accumulating, rate and duration, several zones: PASS');

// [4] The story key changes only with level, pattern, zone or spread, not with every reading
const k1 = I.storyKey(f);
st = state(ramp.map(v => v + 5), ramp.map(v => Math.round(v * 0.9) + 5));
assert.strictEqual(I.storyKey(I.facts(L.assess(st, now), st.history, { plan, now })), k1);
assert.notStrictEqual(I.storyKey({ ...f, pattern: 'falling' }), k1);
console.log('  [4] Story key is stable across small changes: PASS');

// [5] Without a floor plan the zone falls back to a letter and the text still reads
st = state([150, 160, 150, 2600], [90, 95, 90, 300]);
f = I.facts(L.assess(st, now), st.history, { plan: null, now });
assert.strictEqual(f.zone, 'A');
assert.strictEqual(f.room, null);
assert.match(I.explain(f), /^ตรวจพบแก๊สที่จุด A \d/);
console.log('  [5] Works without a floor plan: PASS');

console.log('\nALL INCIDENT-1 TESTS PASSED!');
