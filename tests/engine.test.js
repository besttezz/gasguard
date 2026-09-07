const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = name => fs.readFileSync(`js/${name}.js`, 'utf8');
function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return { getItem:key => data.has(key) ? data.get(key) : null, setItem:(key,value) => data.set(key, String(value)), removeItem:key => data.delete(key), dump:() => Object.fromEntries(data) };
}
function runtime(storage = memoryStorage()) {
  const context = { console, Date, Math, JSON, setTimeout, clearTimeout, localStorage:storage };
  context.window = context;
  vm.createContext(context);
  ['data','engine','service'].forEach(name => vm.runInContext(source(name), context));
  return { context, engine:context.GasGuardEngine, service:context.GasGuardService, storage };
}
function prepareCompleted(service, incidentId = null) {
  const created = service.create({ incidentId, requestType:'inspection', description:'test request' });
  assert.equal(created.ok, true, 'request is created');
  const id = created.request.requestId;
  assert.equal(service.transition(id, 'acknowledged').ok, true);
  assert.equal(service.transition(id, 'in_progress').ok, true);
  assert.equal(service.transition(id, 'awaiting_verification').ok, true);
  assert.equal(service.verify(id, { result:'passed', observedResult:'mock pass' }).ok, true);
  assert.equal(service.transition(id, 'completed').ok, true);
  return id;
}

// Engine regression: formulas and deterministic scenarios remain unchanged.
let { engine, service, storage } = runtime();
assert.equal(engine.analysis.safety, 'safe');
assert.notEqual(engine.analysis.risk, null);
engine.setScenario('rise'); for (let i=0;i<24;i++) engine.tick();
assert.equal(engine.analysis.safety, 'critical');
engine.setScenario('unknown'); engine.tick();
assert.equal(engine.analysis.safety, 'unknown');
assert.equal(engine.analysis.risk, null);
assert.ok(engine.validation.every(item => item.pass));
assert.equal(engine.runFailSafeDrill().checks.find(item => item.id === 'malformed').result, 'PASS');

// 1. completed request is immutable: note/task/verification/general transition are rejected.
let completedId = prepareCompleted(service);
const beforeCompleted = JSON.stringify(service.state);
for (const outcome of [service.note(completedId,'late note'), service.task(completedId), service.verify(completedId,{result:'passed'}), service.transition(completedId,'in_progress')]) {
  assert.equal(outcome.ok, false); assert.equal(outcome.code, 'request_completed');
}
assert.equal(JSON.stringify(service.state), beforeCompleted, 'completed state never mutates after rejected operations');

// 2. cancelled request is immutable and cannot report.
const cancelled = service.create({description:'cancel me'}).request;
assert.equal(service.transition(cancelled.requestId,'cancelled').ok, true);
const beforeCancelled = JSON.stringify(service.state);
for (const outcome of [service.note(cancelled.requestId,'late'), service.task(cancelled.requestId), service.verify(cancelled.requestId,{result:'passed'}), service.transition(cancelled.requestId,'acknowledged'), service.report(cancelled.requestId)]) {
  assert.equal(outcome.ok, false); assert.equal(outcome.code, 'request_cancelled');
}
assert.equal(JSON.stringify(service.state), beforeCancelled, 'cancelled state never mutates');

// 3. reports require completed + passed verification, are idempotent, and do not alter detection.
const gated = service.create({description:'report gate'}).request;
assert.equal(service.report(gated.requestId).code, 'request_not_completed');
assert.equal(service.transition(gated.requestId,'acknowledged').ok, true);
assert.equal(service.transition(gated.requestId,'in_progress').ok, true);
assert.equal(service.transition(gated.requestId,'awaiting_verification').ok, true);
assert.equal(service.verify(gated.requestId,{result:'failed'}).ok, true);
assert.equal(service.transition(gated.requestId,'completed').code, 'verification_required');
assert.equal(service.report(gated.requestId).code, 'request_not_completed');
const incidentBefore = JSON.stringify(engine.state.events);
assert.equal(service.verify(gated.requestId,{result:'passed'}).ok, true);
assert.equal(service.transition(gated.requestId,'completed').ok, true);
const firstReport = service.report(gated.requestId);
assert.equal(firstReport.ok, true); assert.equal(firstReport.code, 'report_created');
const sameReport = service.report(gated.requestId);
assert.equal(sameReport.ok, true); assert.equal(sameReport.code, 'report_exists');
assert.equal(sameReport.report.reportId, firstReport.report.reportId);
assert.equal(JSON.stringify(engine.state.events), incidentBefore, 'service workflow never changes incident detection lifecycle');

// 4. no technician identity is fabricated in created records.
const records = [firstReport.report, ...service.state.tasks, ...service.state.verifications];
assert.ok(records.every(record => record.technicianIdentity == null && record.performedBy == null));

// 5. relation snapshot has schema, labels, all associations, and local/mock source.
const relation = service.relationSnapshot(`request:${gated.requestId}`);
assert.equal(relation.version, 'service-workflow-v0.2');
assert.equal(relation.source, 'LOCAL_BROWSER_DATA');
assert.equal(relation.mock, true);
assert.equal(relation.requests[0].requestId, gated.requestId);
assert.equal(relation.reports[0].requestId, gated.requestId);

// 6. migration is compatible and idempotent without breaking normal operations.
const legacy = { requests:[{requestId:'old-request',status:'submitted',history:[]}],tasks:[],verifications:[],reports:[] };
const migrated = service.migrate(legacy).state;
assert.equal(migrated.version, 'service-workflow-v0.2');
assert.equal(migrated.requests[0].requestId, 'old-request');
assert.deepEqual(JSON.parse(JSON.stringify(service.migrate(migrated).state)), JSON.parse(JSON.stringify(migrated)));
assert.equal(service.create({description:'migration does not block normal create'}).ok, true);

// 7. persistence transaction does not mutate active state if localStorage writes fail.
const failingStorage = { getItem:() => null, setItem:() => { throw new Error('quota'); } };
({ service } = runtime(failingStorage));
const beforeWriteFailure = JSON.stringify(service.state);
const writeFailure = service.create({description:'must not persist'});
assert.equal(writeFailure.ok, false); assert.equal(writeFailure.code, 'storage_write_failed');
assert.equal(JSON.stringify(service.state), beforeWriteFailure);

// 8. disabled storage returns explicit failure rather than a false success.
const noStorage = { getItem:() => null, setItem:() => { throw new Error('disabled'); } };
({ service } = runtime(noStorage));
assert.equal(service.create({description:'storage unavailable'}).ok, false);

// 9. corrupt engine storage means unknown/not-safe; valid telemetry creates auditable recovery.
const corruptKey = 'gasguard-v2-draft';
({ engine, storage } = runtime(memoryStorage({[corruptKey]:'{broken json'})));
assert.equal(engine.analysis.safety, 'unknown');
assert.equal(engine.analysis.risk, null);
assert.equal(engine.analysis.confidence, 0);
assert.equal(engine.analysis.integrityFault.code, 'storage_corrupt');
const good = engine.analysis.current;
assert.equal(engine.ingest({gas:{value:good.gas.value,calculatedPpm:good.gas.value},environment:good.environment,system:good.system,locationId:good.locationId,zoneId:good.zoneId,deviceId:good.deviceId,sensorId:good.sensorId}), true);
assert.equal(engine.analysis.integrityFault, null);
assert.equal(engine.state.recoveryTransition.code, 'storage_recovery');
assert.ok(engine.state.events.some(event => event.title.includes('กู้คืน')));
assert.ok(storage.dump()['gasguard-v2-draft-corrupt-backup']);
assert.equal(engine.incidentEvidence().integrity.status, 'verified_from_current_session');

// 10. retention preserves incidents linked to open service workflow.
({ engine, service } = runtime());
engine.state.events = Array.from({length:90},(_,i)=>({eventId:`closed-${i}`,id:`closed-${i}`,lifecycleStatus:'resolved',technicianReview:{status:'completed'}}));
engine.state.events.push({eventId:'protected',id:'protected',lifecycleStatus:'resolved',technicianReview:{status:'completed'}});
service.state.requests.push({requestId:'open',incidentId:'protected',status:'submitted'});
assert.ok(engine.retainedEventPreview().some(event => event.eventId === 'protected'));

console.log('engine tests passed');
