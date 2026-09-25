'use strict';
const assert=require('node:assert/strict');
const childProcess=require('node:child_process');
const path=require('node:path');
const status=require('../js/integration-status.js');
const {runPreflight}=require('../tools/integration-preflight.js');

assert.equal(status.readiness({}),status.STATES.NOT_CONFIGURED);
assert.equal(status.readiness({server:true,ingress:true,registry:true,realDeviceKey:true}),status.STATES.READY_FOR_DEVICE);
assert.equal(status.connection({connection:'WAITING_FOR_DEVICE',telemetry:'NO DATA'}),status.STATES.WAITING_FOR_DEVICE);
assert.equal(status.connection({connection:'ONLINE',telemetry:'AVAILABLE'}),status.STATES.RECEIVING);
assert.equal(status.connection({connection:'OFFLINE',telemetry:'STALE'}),status.STATES.STALE);

const health={ok:true,readiness:{ingress:'AVAILABLE'},workspaces:{'hardware-pilot':{telemetry:'NO DATA',safety:'UNKNOWN'}}};
const fakeFetch=async()=>({ok:true,json:async()=>health});
(async()=>{
  const missingOutput=[],missing=await runPreflight({env:{},fetchImpl:fakeFetch,write:line=>missingOutput.push(line)});
  assert.equal(missing.results.find(item=>item.name==='Real device key').level,'WARN');
  assert.equal(missing.results.find(item=>item.name==='Test device key').level,'WARN');
  const real='ready-real-secret-fixture',test='ready-test-secret-fixture',readyOutput=[];
  const ready=await runPreflight({env:{GASGUARD_HOST:'0.0.0.0',GASGUARD_PORT:'5567',GASGUARD_REAL_DEVICE_KEY:real,GASGUARD_TEST_DEVICE_KEY:test},fetchImpl:fakeFetch,write:line=>readyOutput.push(line)});
  assert.equal(ready.exitCode,0);
  assert.equal(ready.results.find(item=>item.name==='Real device key').level,'PASS');
  assert.equal(readyOutput.join('\n').includes(real),false,'preflight must not print real key');
  assert.equal(readyOutput.join('\n').includes(test),false,'preflight must not print test key');
  const verification=childProcess.execFileSync(process.execPath,['tools/integration-verify.js'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  assert.match(verification,/PASS Virtual ESP32/);
  assert.match(verification,/hardware-pilot remained isolated/);
  console.log('integration readiness tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
