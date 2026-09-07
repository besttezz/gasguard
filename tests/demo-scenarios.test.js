const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = name => fs.readFileSync(`js/${name}.js`, 'utf8');
function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
}
function runtime() {
  const context = { console, Date, Math, JSON, localStorage:memoryStorage() };
  context.window = context;
  vm.createContext(context);
  ['data', 'engine', 'demo-scenarios'].forEach(name => vm.runInContext(source(name), context));
  return { engine:context.GasGuardEngine, library:context.GasGuardDemoScenarios };
}

const { engine, library } = runtime();
const ids = library.scenarios.map(item => item.id);
assert.equal(library.scenarios.length, 10, 'the demo library exposes S01–S10');
assert.equal(new Set(ids).size, ids.length, 'scenario IDs are unique');
assert.deepEqual(Array.from(ids), ['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10']);
assert.ok(library.scenarios.every(item => item.title && item.thai && item.purpose && item.expected && item.engineScenario));

// Restart uses the existing Engine input sequence and gives the same first reading.
engine.restartSimulation('critical');
engine.tick();
const firstRun = engine.analysis.current.gas.value;
engine.restartSimulation('critical');
engine.tick();
assert.equal(engine.analysis.current.gas.value, firstRun, 'restart is deterministic at step one');

// Pausing the Engine does not consume readings; a single tick after resuming consumes one.
const beforePause = engine.state.readings.length;
engine.togglePause();
engine.tick();
assert.equal(engine.state.readings.length, beforePause, 'paused simulation retains the reading count');
engine.togglePause();
engine.tick();
assert.equal(engine.state.readings.length, beforePause + 1, 'a resumed tick advances one reading');

// Keep reset narrowly scoped: never erase unrelated browser storage wholesale.
const controller = source('demo-controller');
assert.equal(controller.includes('localStorage.clear('), false, 'demo reset never calls localStorage.clear');
for (const key of ['gasguard-v2-draft','gasguard-v2-service-workflow','gasguard-v2-view-mode','gasguard-v2-demo-role','gasguard-v2-setup-profile','gasguard-v2-managed-sites']) {
  assert.ok(controller.includes(`'${key}'`), `reset allowlist includes ${key}`);
}

// Fault inputs retain the existing fail-safe guarantees through the unchanged Engine.
const safetyRuntime = runtime();
safetyRuntime.engine.restartSimulation('unknown');
safetyRuntime.engine.tick();
assert.equal(safetyRuntime.engine.analysis.safety, 'unknown', 'offline sensor input is never safe');
assert.equal(safetyRuntime.engine.analysis.risk, null, 'offline sensor input has no fabricated risk score');

safetyRuntime.engine.restartSimulation('critical');
for (let index = 0; index < 5; index += 1) safetyRuntime.engine.tick();
const gasIncident = safetyRuntime.engine.state.events.find(item => item.eventType === 'gas_risk' && item.lifecycleStatus === 'open');
assert.ok(gasIncident, 'rapid-rise input opens one gas incident through the Engine');
safetyRuntime.engine.setScenario('network');
safetyRuntime.engine.tick();
assert.equal(safetyRuntime.engine.analysis.safety, 'unknown', 'network offline is never safe');
assert.equal(safetyRuntime.engine.state.events.find(item => item.eventId === gasIncident.eventId).lifecycleStatus, 'open', 'network fault does not close an open gas incident');

const html = fs.readFileSync('index.html', 'utf8');
for (const label of ['UNVALIDATED_PROTOTYPE', 'LOCAL_BROWSER_DATA', 'NOT_A_PRODUCTION_AUDIT_LOG', 'page-demo', 'review-bar']) {
  assert.ok(html.includes(label), `UI contains ${label}`);
}

console.log('demo scenario tests passed');
