const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context={window:{},console,Date,setTimeout,clearTimeout};
context.window.window=context.window;
vm.createContext(context);
for(const file of ['js/data.js','js/engine.js','js/measurement.js','js/hardware-lab.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
const {GasGuardEngine:engine,GasGuardMeasurement:measurement,GasGuardHardwareLab:lab}=context.window;
const json=id=>JSON.stringify(lab.samplePayload(id));

const count=engine.state.readings.length;
const checked=lab.validateOnly(json('mq6_upstream'),measurement);
assert.equal(checked.ok,true);
assert.equal(checked.diagnostics.conversionStatus,'PASSTHROUGH');
assert.equal(checked.diagnostics.ppmSource,'UPSTREAM');
assert.equal(engine.state.readings.length,count,'validate-only must not ingest');

const invalid=lab.validateOnly(json('missing_device'),measurement);
assert.equal(invalid.ok,false);
assert.equal(invalid.code,'INVALID_MEASUREMENT');
const rawOnly=lab.validateAndIngest(json('mq6_raw'),measurement,engine);
assert.equal(rawOnly.ok,false);
assert.equal(rawOnly.code,'CALIBRATION_REQUIRED');

const accepted=lab.validateAndIngest(json('mq6_upstream'),measurement,engine);
assert.equal(accepted.ok,true);
assert.equal(accepted.code,'INGESTED');
assert.equal(accepted.timing.bootId,'boot-demo-1');
assert.ok(accepted.timing.receivedAt);
assert.equal(typeof accepted.timing.clockSkewMs,'number');
assert.equal(typeof accepted.engineAnalysis.gasPpm,'number');

const duplicate=lab.validateAndIngest(json('duplicate'),measurement,engine);
assert.equal(duplicate.ok,false);
assert.equal(duplicate.engineError.code,'duplicate_sequence');
const reboot=lab.validateAndIngest(json('reboot'),measurement,engine);
assert.equal(reboot.ok,true,'new bootId permits sequence reset');
assert.equal(reboot.timing.sequence,0);

console.log('hardware lab tests passed');
