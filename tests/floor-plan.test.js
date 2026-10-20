'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const plan = require('../js/floor-plan.js');
const logic = require('../js/safety-logic.js');
global.GasGuardSafetyLogic = logic;
const consoleView = require('../js/safety-console.js');

console.log('Running PLAN-1 floor plan and safety console tests...\n');

// [1] 3-5 standard templates, each with a marked entrance and default stove / tank / sensor pins
assert.ok(plan.TEMPLATES.length >= 3 && plan.TEMPLATES.length <= 5);
for (const t of plan.TEMPLATES) {
  assert.ok(t.doors.some(d => d.main), `${t.id} marks the entrance`);
  const types = t.pins.map(p => p.type);
  assert.ok(types.includes('stove') && types.includes('tank') && types.includes('sensor'), `${t.id} has stove, tank and sensor pins`);
  for (const p of t.pins) assert.ok(p.x >= 0 && p.x <= plan.W && p.y >= 0 && p.y <= plan.H, `${t.id} pin inside the plan`);
  const svg = plan.stageSvg(plan.defaultPlan(t.id), {});
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(svg, /class="fp-entry"/, `${t.id} draws the entry arrow`);
}
console.log(`  [1] ${plan.TEMPLATES.length} templates with entrance, stove, tank and sensor pins: PASS`);

// [2] Stored plans are validated; unknown pin types and foreign image URLs are dropped
const dirty = plan.normalizePlan({ template: 'nope', image: 'https://evil.example/x.png', pins: [{ type: 'sensor', label: 'ABCD', sensorId: 'MQ6-01', x: 5000, y: -3 }, { type: 'bomb', x: 1, y: 1 }] });
assert.strictEqual(dirty.template, plan.TEMPLATES[0].id);
assert.strictEqual(dirty.image, null);
assert.strictEqual(dirty.pins.length, 1);
assert.deepStrictEqual([dirty.pins[0].x, dirty.pins[0].y, dirty.pins[0].label], [plan.W, 0, 'ABC']);
assert.strictEqual(plan.normalizePlan(null).template, plan.TEMPLATES[0].id);
assert.strictEqual(plan.nextSensorLabel([{ type: 'sensor', label: 'A' }, { type: 'sensor', label: 'B' }]), 'C');
console.log('  [2] Stored plans are sanitised and new sensors get the next free letter: PASS');

// [3] IDW heat map: equals the sensor at the sensor, lies between two sensors, fades with distance,
//     counts a sensor in another room less, coloured by level band. Red pulses; unbound sensors are dashed.
assert.strictEqual(plan.heatRadius(0), 0);
const p = plan.defaultPlan('kitchen');
const two = { 'MQ6-01': { ppm: 4200, level: logic.classify(4200) }, 'MQ2-01': { ppm: 200, level: logic.classify(200) } };
const grid = plan.idwGrid(p, two);
assert.strictEqual(grid.points.length, 2);
const [sa, sb] = grid.points;
const atA = plan.idwValue(sa.x, sa.y, grid.points, null), atB = plan.idwValue(sb.x, sb.y, grid.points, null);
assert.ok(atA > 3800 && atA <= 4200, 'value at sensor A is close to its reading');
assert.ok(atB < 900, 'value at sensor B stays low');
const mid = plan.idwValue((sa.x + sb.x) / 2, (sa.y + sb.y) / 2, grid.points, null);
assert.ok(mid > atB && mid < atA, 'midpoint lies between the two sensors');
assert.ok(plan.idwValue(sa.x + 400, sa.y, [sa], null) < plan.idwValue(sa.x + 60, sa.y, [sa], null), 'value fades with distance');
const rooms = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 100, h: 100 }];
const lone = [{ x: 90, y: 50, v: 3000, room: 0 }];
assert.ok(plan.idwValue(110, 50, lone, rooms) < plan.idwValue(110, 50, lone, null), 'a wall between cell and sensor lowers the estimate');
assert.ok(Number.isNaN(grid.values[0]), 'cells outside the building stay empty');
assert.strictEqual(plan.heatColor(4000)[4], logic.LEVELS.danger.color);
assert.strictEqual(plan.heatColor(1000)[4], logic.LEVELS.watch.color);
assert.ok(plan.heatColor(5)[3] < plan.heatColor(3000)[3], 'clean air is a lighter tint');
const heat = plan.heatSvg(p, two);
assert.match(heat, new RegExp(`fill="${logic.LEVELS.danger.color}"`));
assert.match(heat, new RegExp(`fill="${logic.LEVELS.safe.color}"`));
assert.match(heat, /fp-pulse is-danger/);
assert.match(heat, /stroke-dasharray="5 6"/, 'sensor C is not bound to a device yet');
assert.match(plan.heatSvg(p, {}), /data-sensors="0"/, 'no data, no invented heat');
const overlay = plan.overlayHtml(p, { 'MQ6-01': { ppm: 4200, level: logic.classify(4200) } }, {});
assert.match(overlay, /4,200 ppm · อันตราย/);
assert.match(overlay, /ทางเข้า-ออก/);
assert.match(overlay, /ยังไม่ผูก/);
assert.ok(!plan.overlayHtml({ ...p, pins: [{ id: 'x', type: 'sensor', label: '<b>', sensorId: '', x: 1, y: 1 }] }, {}, {}).includes('<b>'), 'labels are escaped');
console.log('  [3] IDW heat map interpolates between sensors, fades with distance, respects walls: PASS');

// [3b] 3D view: built from the same template, gas colours on the floor, clearly labelled as a simulation
for (const t of plan.TEMPLATES) {
  const iso = plan.isoSvg(plan.defaultPlan(t.id), { 'MQ6-01': { ppm: 2400, level: logic.classify(2400) } });
  assert.match(iso, /^<svg class="fp-svg fp-iso"[\s\S]*<\/svg>$/);
  assert.ok(!/NaN|undefined/.test(iso), `${t.id} 3D has no broken coordinates`);
  assert.match(iso, new RegExp(`fill="${logic.LEVELS.warning.color}"`), `${t.id} 3D shows the gas level colour`);
  assert.match(iso, />LPG</, `${t.id} 3D shows the LPG tank`);
  assert.match(iso, /ไม่ใช่ภาพถ่ายจริง/, 'the 3D view says it is not a photo');
}
console.log('  [3b] 3D simulated view renders every template with tank, sensors and gas colours: PASS');

// [4] Safety console blocks render the status, actions, pre-cook check and scale
const now = Date.now();
const r = (id, ppm, s) => ({ sensorId: id, gasPpm: ppm, rawAdc: 1500, calibrationStatus: 'CALIBRATED', receivedAt: new Date(now - s * 1000).toISOString() });
const a = logic.assess({ connection: 'ONLINE', history: [r('MQ6-01', 2000, 20), r('MQ6-01', 2100, 10), r('MQ6-01', 2200, 1)], sensorLatest: { 'MQ6-01': r('MQ6-01', 2200, 1) } }, now);
const hero = consoleView.heroHtml(a, { sensorInfo: { 'MQ6-01': { name: 'MQ-6' } }, alarming: true });
assert.match(hero, /sg-hero is-warning/);
assert.match(hero, /ห้ามเปิด-ปิดสวิตช์ไฟ/);
assert.match(hero, /ยังไม่ควรจุดเตา/);
assert.match(hero, /data-sg-ack/);
assert.match(consoleView.checksHtml(a), /ตรวจก่อนจุดเตา/);
assert.match(consoleView.scaleHtml(), /900 ppm[\s\S]*1,800[\s\S]*3,600/);
assert.match(consoleView.timelineHtml([]), /ยังไม่มีการเปลี่ยนระดับ/);
console.log('  [4] Safety console shows colour status, actions, pre-cook check and thresholds: PASS');

// [5] Wiring: scripts load in the page, technician view is out of the user-facing landing for now
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const f of ['safety-logic', 'floor-plan', 'safety-console']) assert.match(html, new RegExp(`<script src="js/${f}\\.js"></script>`));
assert.match(html, /id="role-tab-technician" hidden/);
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
assert.match(app, /GasGuardSafetyConsole\.create\(/);
assert.match(app, /href="#sg-plan"/);
console.log('  [5] Scripts wired, device menu links to plan, technician tab hidden: PASS');

console.log('\nALL PLAN-1 FLOOR PLAN TESTS PASSED!');
