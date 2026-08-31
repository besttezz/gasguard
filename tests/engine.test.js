const assert = require('node:assert/strict');
const fs = require('node:fs');

global.window = global;
eval(fs.readFileSync('js/data.js', 'utf8'));
eval(fs.readFileSync('js/engine.js', 'utf8'));

const engine = global.GasGuardEngine;
assert.equal(engine.analysis.safety, 'safe', 'baseline mock data starts in a safe state');
assert.notEqual(engine.analysis.risk, null, 'online data has an explainable risk score');

engine.setScenario('rise');
for (let i = 0; i < 24; i++) engine.tick();
assert.equal(engine.analysis.safety, 'critical', 'sustained rise becomes critical');
assert.ok(engine.analysis.rate > 0, 'sustained rise has a positive rate');
assert.ok(engine.analysis.anomaly >= 50, 'sustained rise has a material anomaly score');

engine.setScenario('unknown');
engine.tick();
assert.equal(engine.analysis.safety, 'unknown', 'offline telemetry is unknown, never safe');
assert.equal(engine.analysis.risk, null, 'offline telemetry cannot produce a safety risk score');

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
assert.equal(evidence.schemaVersion, 'gasguard-incident-evidence-v0.1', 'incident evidence uses a stable schema');
assert.equal(evidence.analysis.safetyState, 'unknown', 'incident evidence retains current safety state');

console.log('engine tests passed');
