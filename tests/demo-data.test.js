const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = name => fs.readFileSync(`js/${name}.js`, 'utf8');
function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem:key => data.has(key) ? data.get(key) : null, setItem:(key,value) => data.set(key,String(value)), removeItem:key => data.delete(key), snapshot:() => Object.fromEntries(data) };
}
function runtime(seed = {}) {
  const localStorage = memoryStorage(seed);
  const context = { console, Date, Math, JSON, localStorage };
  context.window = context;
  vm.createContext(context);
  ['data','engine','demo-data'].forEach(name => vm.runInContext(source(name), context));
  let serviceState = null;
  const service = { resetDemoState:state => { serviceState = JSON.parse(JSON.stringify(state)); } };
  return { engine:context.GasGuardEngine, demo:context.GasGuardDemoData, localStorage, service, serviceState:() => serviceState };
}

const first = runtime({ 'supabase-auth-token':'keep-session' });
const reset = first.demo.reset({ workspaceId:'demo-site', engine:first.engine, service:first.service });
assert.equal(reset.code, 'DEMO_RESET_COMPLETE');
assert.equal(first.engine.analysis.safety, 'safe', 'default demo starts safe');
assert.equal(first.engine.analysis.current.deviceId, 'GG-KITCHEN-01', 'default includes the simulated device');
assert.ok(first.engine.state.events.length > 0 && first.engine.state.events.every(event => event.lifecycleStatus === 'resolved'), 'default has recent events without open critical alerts');
assert.equal(first.localStorage.getItem('supabase-auth-token'), 'keep-session', 'reset does not affect auth storage');
assert.ok(first.serviceState().requests.every(item => item.siteId === 'demo-site' && item.mock), 'default service state is demo-only');

const second = runtime();
second.demo.reset({ workspaceId:'demo-site', engine:second.engine, service:second.service });
assert.equal(JSON.stringify(first.demo.defaultEvents()), JSON.stringify(second.demo.defaultEvents()), 'default events are deterministic');
assert.equal(JSON.stringify(first.demo.defaultServiceState()), JSON.stringify(second.demo.defaultServiceState()), 'default service workflow is deterministic');

const expected = { NORMAL:'safe', ATTENTION:'attention', CRITICAL:'critical', RECOVERY:'safe', OFFLINE:'unknown' };
for (const [name, safety] of Object.entries(expected)) {
  const result = first.demo.runScenario(name, { workspaceId:'demo-site', engine:first.engine });
  assert.equal(result.ok, true, `${name} can run`);
  assert.equal(result.scenario, name, `${name} remains selected in the UI contract`);
  assert.equal(result.safety, safety, `${name} produces the expected safety state`);
  assert.equal(result.label, 'SIMULATION / PROTOTYPE');
}

first.demo.runScenario('CRITICAL', { workspaceId:'demo-site', engine:first.engine });
first.demo.reset({ workspaceId:'demo-site', engine:first.engine, service:first.service });
assert.equal(first.engine.analysis.safety, 'safe', 'reset restores NORMAL');
assert.equal(first.engine.state.events.some(event => event.lifecycleStatus === 'open'), false, 'reset clears active demo alerts/events');

const hardware = { status:'WAITING_FOR_DEVICE', history:['real-sentinel'] };
const deviceTest = { status:'RECEIVING', history:['test-sentinel'] };
const before = JSON.stringify({ hardware, deviceTest });
assert.equal(first.demo.reset({ workspaceId:'hardware-pilot', engine:first.engine, service:first.service }).code, 'WORKSPACE_DENIED');
assert.equal(first.demo.reset({ workspaceId:'device-test', engine:first.engine, service:first.service }).code, 'WORKSPACE_DENIED');
first.demo.runScenario('ATTENTION', { workspaceId:'demo-site', engine:first.engine });
assert.equal(JSON.stringify({ hardware, deviceTest }), before, 'demo scenarios cannot mutate real/test workspace state');

const html = fs.readFileSync('index.html', 'utf8');
assert.ok(html.includes('SIMULATION / PROTOTYPE'), 'demo UI carries the simulation/prototype label');
assert.equal(/page-demo[\s\S]*?(LIVE DEVICE|REAL DATA|CALIBRATED)/.test(html), false, 'demo page makes no real-device claims');
console.log('demo data and reset tests passed');
