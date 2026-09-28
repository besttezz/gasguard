const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = name => fs.readFileSync(`js/${name}.js`, 'utf8');
const storage = { getItem:() => null, setItem:() => {}, removeItem:() => {} };
const context = { console, Date, Math, JSON, localStorage:storage };
context.window=context;
vm.createContext(context);
['data','engine','measurement'].forEach(name => vm.runInContext(source(name),context));
const measurement=context.GasGuardMeasurement, engine=context.GasGuardEngine;
const raw = (overrides={}) => ({
  deviceId:'ESP32-RAW-01', sensorId:'MQ-RAW-01', sensorType:'MQ6', bootId:'boot-raw-1', sequence:0,
  timestamp:new Date().toISOString(), raw:{ adc:2048, sensorVoltage:1.65 }, environment:{ temperature:30, humidity:65 }, ...overrides
});

assert.equal(measurement.validateRaw(raw({sensorType:'MQ3'})).ok,true,'valid MQ3 raw shape');
assert.equal(measurement.validateRaw(raw({sensorType:'MQ6'})).ok,true,'valid MQ6 raw shape');
assert.equal(measurement.validateRaw(raw({deviceId:undefined})).ok,false,'missing identity rejected');
assert.equal(measurement.validateRaw(raw({raw:{adc:NaN}})).ok,false,'invalid raw number rejected');
assert.equal(measurement.validateRaw(raw({sensorType:'MQ5'})).ok,false,'unsupported sensor rejected');

const mq3RawOnly=measurement.toTelemetry(raw({sensorType:'MQ3'}));
assert.equal(mq3RawOnly.ok,false); assert.equal(mq3RawOnly.code,'CALIBRATION_REQUIRED');
assert.equal(mq3RawOnly.telemetry,null); assert.equal(mq3RawOnly.diagnostics.ppmSource,'NONE');
const mq6RawOnly=measurement.toTelemetry(raw({sensorType:'MQ6'}));
assert.equal(mq6RawOnly.ok,false); assert.equal(mq6RawOnly.code,'CALIBRATION_REQUIRED');
assert.equal(measurement.adapters.MQ3.convertRawToPpm().code,'NOT_IMPLEMENTED');
assert.equal(measurement.adapters.MQ6.convertRawToPpm().ppm,null,'no fake ppm generated');

const passthrough=measurement.toTelemetry(raw({upstreamPpm:145}));
assert.equal(passthrough.ok,true); assert.equal(passthrough.telemetry.schemaVersion,'gasguard.telemetry.v1.1');
assert.equal(passthrough.telemetry.gas.ppm,145); assert.equal(passthrough.diagnostics.conversionStatus,'PASSTHROUGH');
assert.equal(passthrough.diagnostics.ppmSource,'UPSTREAM');
assert.equal('receivedAt' in passthrough.telemetry,false,'derived receive time is not accepted from hardware');
assert.equal(context.GasGuardData.validateTelemetry(passthrough.telemetry).ok,true,'generated telemetry matches V1.1');

const ingested=measurement.ingest(raw({upstreamPpm:151,sequence:1}),engine);
assert.equal(ingested.ok,true); assert.equal(engine.analysis.current.gas.ppm,151);

console.log('measurement tests passed');
