const assert = require('node:assert/strict');
const fs = require('node:fs');

global.window = global;
eval(fs.readFileSync('js/data.js', 'utf8'));
eval(fs.readFileSync('js/engine.js', 'utf8'));

const engine = global.GasGuardEngine;
assert.equal(engine.analysis.safety, 'safe', 'baseline mock data starts in a safe state');
assert.notEqual(engine.analysis.risk, null, 'online data has an explainable risk score');
assert.ok(Number.isFinite(engine.analysis.correctedGas), 'analysis retains an environment-corrected LPG value');
assert.ok(Number.isFinite(engine.analysis.current.gas.rawAdc), 'mock contract preserves raw sensor ADC data');
assert.equal(engine.analysis.current.quality.warmupComplete, true, 'mock contract exposes warm-up quality state');
assert.ok(engine.analysis.features.movingAverages.avg1m > 0, 'feature store exposes moving averages');
assert.equal(engine.analysis.features.fusion.sensors.length, 3, 'mock fleet exposes multi-sensor topology');
assert.ok(engine.analysis.reliability.connectivityHealth > 0, 'analysis exposes connectivity health');

engine.setScenario('rise');
for (let i = 0; i < 24; i++) engine.tick();
assert.equal(engine.analysis.safety, 'critical', 'sustained rise becomes critical');
assert.ok(engine.analysis.rate > 0, 'sustained rise has a positive rate');
assert.ok(engine.analysis.anomaly >= 50, 'sustained rise has a material anomaly score');

engine.setScenario('unknown');
engine.tick();
assert.equal(engine.analysis.safety, 'unknown', 'offline telemetry is unknown, never safe');
assert.equal(engine.analysis.risk, null, 'offline telemetry cannot produce a safety risk score');

engine.setScenario('valveFailure');
engine.tick();
assert.equal(engine.analysis.valveMismatch, true, 'command-feedback mismatch is surfaced as actuator evidence');
assert.ok(engine.analysis.reliability.valveHealth < 50, 'valve mismatch reduces actuator health');

const validation = engine.validation;
assert.equal(validation.length, 4, 'validation lab provides four controlled scenarios');
assert.ok(validation.every(item => item.pass), 'mock scenarios meet their declared prototype expectations');
assert.equal(validation.find(item => item.id === 'offline').contextual, 'unknown', 'missing telemetry remains unknown in validation');
assert.equal(validation.find(item => item.id === 'leak').contextual, 'critical', 'sustained closed-valve rise becomes critical in validation');

const validationRun = engine.runValidation();
assert.equal(validationRun.passed, validationRun.total, 'test runner reports all mock cases passing');
const failSafe = engine.runFailSafeDrill();
assert.equal(failSafe.checks.find(item => item.id === 'offline').result, 'PASS', 'offline fail-safe check passes');
assert.equal(failSafe.checks.find(item => item.id === 'malformed').result, 'PASS', 'malformed payload is rejected');
const evidence = engine.incidentEvidence();
assert.equal(evidence.schemaVersion, 'gasguard-incident-evidence-v0.2', 'incident evidence uses a stable schema');
assert.equal(evidence.analysis.safetyState, engine.analysis.safety, 'incident evidence retains the current safety state');

const labelTarget = engine.state.events.find(event => event.type === 'critical' || event.type === 'warning');
assert.ok(labelTarget, 'safety transitions create a label-ready event');
assert.equal(engine.labelEvent(labelTarget.id, 'cooking', 'engineer', 'confirmed'), true, 'engineer can label an event outcome');
assert.ok(engine.alarmQuality.labelled >= 1, 'alarm quality includes labelled events');

// Sprint 2 lifecycle tests use deterministic mock readings only. They exercise
// lifecycle aggregation and never change the safety score/threshold formula.
engine.state.readings = global.GasGuardData.history.slice();
engine.clearEvents();
const lifecycleReading = (value, overrides={}) => ({
  gas:{ value, calculatedPpm:value }, locationId:'site-a', zoneId:'kitchen-a', deviceId:'GG-KITCHEN-01', sensorId:'LPG-01',
  system:{ connection:'online', valve:'open', commandedValveState:'open', actualValveState:'open', activity:'active', ...(overrides.system||{}) }, ...overrides
});
assert.equal(engine.ingest(lifecycleReading(120)), true, 'first abnormal mock reading is accepted');
let gasEvent = engine.state.events.find(event=>event.eventType==='gas_risk');
assert.ok(gasEvent, 'first abnormal reading creates one gas event');
const firstEventId = gasEvent.eventId;
assert.equal(gasEvent.lifecycleStatus, 'open', 'new gas event starts open');
assert.equal(gasEvent.readingCount, 1, 'first event retains its first reading');
assert.equal(gasEvent.severity, 'attention', 'watch state is retained as event severity');

engine.ingest(lifecycleReading(140));
gasEvent = engine.state.events.find(event=>event.eventId===firstEventId);
assert.equal(engine.state.events.filter(event=>event.eventType==='gas_risk').length, 1, 'continuous abnormal readings update one event');
assert.equal(gasEvent.readingCount, 2, 'continuous reading increments reading count');
assert.equal(gasEvent.updateCount, 1, 'continuous reading increments update count');

engine.ingest(lifecycleReading(200));
gasEvent = engine.state.events.find(event=>event.eventId===firstEventId);
assert.equal(gasEvent.peakSeverity, 'critical', 'watch to danger escalates the existing event');
assert.ok(gasEvent.evidence.timeline.some(item=>item.type==='escalated'), 'severity escalation is retained in the event timeline');
assert.ok(gasEvent.peakLpgPpm >= gasEvent.latestReading.lpgPpm, 'event keeps the highest LPG value');
assert.ok(gasEvent.peakRiskScore >= gasEvent.latestReading.riskScore, 'event keeps the highest risk score');

engine.ingest(lifecycleReading(90));
gasEvent = engine.state.events.find(event=>event.eventId===firstEventId);
assert.equal(gasEvent.lifecycleStatus, 'resolved', 'safe transition resolves the gas detection event');
assert.ok(gasEvent.resolvedAt, 'resolved event stores resolvedAt');

engine.ingest(lifecycleReading(200));
const reopenedEvent = engine.state.events.find(event=>event.eventType==='gas_risk' && event.lifecycleStatus==='open');
assert.ok(reopenedEvent && reopenedEvent.eventId!==firstEventId, 'new abnormal state after resolution creates a new event');

engine.ingest(lifecycleReading(200, { system:{connection:'offline',valve:'unknown',commandedValveState:'unknown',actualValveState:'unknown',activity:'unknown'} }));
const faultEvent = engine.state.events.find(event=>event.eventType==='system_fault' && event.lifecycleStatus==='system_fault');
assert.ok(faultEvent, 'unknown telemetry creates a separate system fault event');
assert.equal(reopenedEvent.lifecycleStatus, 'open', 'unknown telemetry never resolves an open gas event');
assert.equal(engine.analysis.safety, 'unknown', 'unknown telemetry is never interpreted as safe');

engine.state.readings = global.GasGuardData.history.slice();
engine.clearEvents();
engine.ingest(lifecycleReading(200, { zoneId:'kitchen-a' }));
engine.ingest(lifecycleReading(200, { zoneId:'storage-a' }));
assert.equal(engine.state.events.filter(event=>event.eventType==='gas_risk').length, 2, 'different zones are not deduplicated together');
engine.ingest(lifecycleReading(200, { zoneId:'storage-a', system:{connection:'offline',valve:'unknown',commandedValveState:'unknown',actualValveState:'unknown',activity:'unknown'} }));
assert.equal(engine.state.events.filter(event=>event.eventType==='system_fault').length, 1, 'different event types are not deduplicated together');

engine.state.events.push({ id:'old-event', type:'warning', title:'Old event', detail:'old record', t:Date.now() });
engine.normalizeLegacyEvents();
const legacy = engine.state.events.find(event=>event.eventId==='old-event');
assert.ok(legacy && legacy.legacy, 'legacy event is normalized without deleting history');
assert.equal(legacy.siteId, null, 'legacy event with no context keeps an explicit empty site');
const workflowEvent = engine.state.events.find(event=>event.eventType==='gas_risk');
const lifecycleBeforeWorkflow = workflowEvent.lifecycleStatus;
assert.equal(engine.acknowledgeEvent(workflowEvent.eventId), true, 'technician can acknowledge an incident workflow');
assert.equal(engine.startInvestigation(workflowEvent.eventId), true, 'technician can start an investigation workflow');
assert.equal(engine.saveTechnicianNote(workflowEvent.eventId, 'mock inspection note'), true, 'technician note is retained');
assert.equal(engine.markTechnicianResolved(workflowEvent.eventId, 'mock workflow complete'), true, 'technician can complete workflow');
assert.equal(workflowEvent.lifecycleStatus, lifecycleBeforeWorkflow, 'technician workflow never overwrites detection lifecycle');

console.log('engine tests passed');
