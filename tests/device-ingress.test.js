'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const registry=require('../server/device-registry.js');
const {createDeviceIngress}=require('../server/device-ingress.js');
const {createPipeline}=require('../server/pipeline-runtime.js');
const {createDevServer,resolveServerConfig}=require('../server/dev-server.js');
const virtual=require('../js/virtual-esp32.js');

const root=path.resolve(__dirname,'..');
const pipelines={'hardware-pilot':createPipeline(root),'device-test':createPipeline(root)};
let clock=Date.parse('2026-09-24T00:00:00.000Z');
const keys={'ESP32-KITCHEN-01':'test-real-key-fixture','SIM-ESP32-KITCHEN-01':'test-virtual-key-fixture'};
const ingress=createDeviceIngress({registry,credentials:keys,pipelines,staleMs:1000,now:()=>clock});
const raw=(deviceId,sequence=0,bootId='boot-a')=>({deviceId,sensorId:'MQ6-01',sensorType:'MQ6',bootId,sequence,timestamp:'2026-09-24T00:00:00.000Z',raw:{adc:1800,sensorVoltage:1.45},upstreamPpm:120,environment:{temperature:30,humidity:64}});
const auth=key=>({'x-device-key':key});
const firmware=fs.readFileSync(path.join(root,'firmware/esp32-handshake/esp32-handshake.ino'),'utf8');
assert.match(firmware,/ESP32-KITCHEN-01/);
assert.match(firmware,/MQ6-01/);
assert.match(firmware,/MQ3-01/);
assert.match(firmware,/x-device-key/);
assert.match(firmware,/SYNTHETIC_HANDSHAKE/);
assert.equal(firmware.includes(keys['ESP32-KITCHEN-01']),false,'firmware must not contain test or real device keys');
assert.deepEqual(resolveServerConfig({}),{host:'127.0.0.1',port:5567,lanMode:false});
assert.deepEqual(resolveServerConfig({GASGUARD_HOST:'0.0.0.0',GASGUARD_PORT:'8080'}),{host:'0.0.0.0',port:8080,lanMode:true});
assert.throws(()=>resolveServerConfig({GASGUARD_PORT:'invalid'}));

let result=ingress.ingest({headers:auth(keys['ESP32-KITCHEN-01']),payload:raw('ESP32-KITCHEN-01')});
assert.equal(result.status,202,'valid real device auth');
assert.equal(result.body.workspaceId,'hardware-pilot');
assert.equal(result.body.source,'REAL_DEVICE');
assert.equal(ingress.ingest({headers:{},payload:raw('ESP32-KITCHEN-01',1)}).body.code,'INVALID_DEVICE_KEY');
assert.equal(ingress.ingest({headers:auth('invalid'),payload:raw('ESP32-KITCHEN-01',1)}).body.code,'INVALID_DEVICE_KEY');
assert.equal(ingress.ingest({headers:auth(keys['SIM-ESP32-KITCHEN-01']),payload:raw('ESP32-KITCHEN-01',1)}).body.code,'DEVICE_KEY_MISMATCH');

result=ingress.ingest({headers:auth(keys['SIM-ESP32-KITCHEN-01']),payload:{...raw('SIM-ESP32-KITCHEN-01'),workspaceId:'hardware-pilot'}});
assert.equal(result.status,202);
assert.equal(result.body.workspaceId,'device-test','workspace comes from registry, not payload');
assert.equal(pipelines['hardware-pilot'].engine.state.readings.length,1,'test packet cannot enter hardware workspace');
assert.equal(pipelines['device-test'].engine.state.readings.length,1);

assert.equal(ingress.ingest({headers:auth(keys['SIM-ESP32-KITCHEN-01']),payload:raw('SIM-ESP32-KITCHEN-01')}).body.code,'ENGINE_REJECTED','duplicate rejected within boot');
assert.equal(ingress.ingest({headers:auth(keys['SIM-ESP32-KITCHEN-01']),payload:raw('SIM-ESP32-KITCHEN-01',2)}).status,202);
assert.equal(ingress.ingest({headers:auth(keys['SIM-ESP32-KITCHEN-01']),payload:raw('SIM-ESP32-KITCHEN-01',1)}).body.code,'ENGINE_REJECTED','out of order rejected');
assert.equal(ingress.ingest({headers:auth(keys['SIM-ESP32-KITCHEN-01']),payload:raw('SIM-ESP32-KITCHEN-01',0,'boot-b')}).status,202,'new bootId resets sequence');
assert.equal(ingress.ingest({headers:auth(keys['SIM-ESP32-KITCHEN-01']),payload:virtual.packets('INVALID_PAYLOAD')[0]}).body.code,'INVALID_MEASUREMENT');
clock+=1501;
assert.equal(ingress.status('device-test').connection,'OFFLINE');
assert.equal(ingress.status('device-test').safety,'UNKNOWN');

(async()=>{
  const httpPipelines={'hardware-pilot':createPipeline(root),'device-test':createPipeline(root)};
  const httpIngress=createDeviceIngress({registry,credentials:keys,pipelines:httpPipelines});
  const server=createDevServer({ingress:httpIngress});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const port=server.address().port,before=httpPipelines['device-test'].engine.state.readings.length;
    const health=await (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).json();
    assert.equal(health.readiness.ingress,'AVAILABLE');
    assert.equal(health.workspaces['hardware-pilot'].safety,'UNKNOWN');
    assert.equal(JSON.stringify(health).includes(keys['ESP32-KITCHEN-01']),false,'health endpoint must not expose real key');
    assert.equal(JSON.stringify(health).includes(keys['SIM-ESP32-KITCHEN-01']),false,'health endpoint must not expose test key');
    const realReply=await fetch(`http://127.0.0.1:${port}/api/v1/device/telemetry`,{method:'POST',headers:{'content-type':'application/json','x-device-key':keys['ESP32-KITCHEN-01'],'x-gasguard-data-classification':'SYNTHETIC_HANDSHAKE'},body:JSON.stringify(raw('ESP32-KITCHEN-01'))});
    assert.equal(realReply.status,202,'valid real request works over HTTP');
    const realBody=await realReply.json();
    assert.equal(realBody.dataClassification,'SYNTHETIC_HANDSHAKE');
    assert.equal(realBody.packetStatus,'SYNTHETIC HANDSHAKE ACCEPTED');
    const missingKey=await fetch(`http://127.0.0.1:${port}/api/v1/device/telemetry`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(raw('ESP32-KITCHEN-01',1))});
    assert.equal(missingKey.status,401);
    const wrongDeviceKey=await fetch(`http://127.0.0.1:${port}/api/v1/device/telemetry`,{method:'POST',headers:{'content-type':'application/json','x-device-key':keys['SIM-ESP32-KITCHEN-01']},body:JSON.stringify(raw('ESP32-KITCHEN-01',1))});
    assert.equal(wrongDeviceKey.status,403);
    const malformed=await fetch(`http://127.0.0.1:${port}/api/v1/device/telemetry`,{method:'POST',headers:{'content-type':'application/json','x-device-key':keys['ESP32-KITCHEN-01']},body:'{'});
    assert.equal(malformed.status,400);
    const hardwareBeforeVirtual=httpPipelines['hardware-pilot'].engine.state.readings.length;
    const sent=await virtual.send({baseUrl:`http://127.0.0.1:${port}`,scenario:'NORMAL',deviceKey:keys['SIM-ESP32-KITCHEN-01'],options:{startTime:'2026-09-24T00:00:00.000Z'}});
    assert.ok(sent.results.every(packet=>packet.status===202),'virtual board posts through HTTP ingress');
    assert.equal(sent.results.at(-1).body.scenario,'NORMAL');
    assert.equal(httpPipelines['device-test'].engine.state.readings.length,before+3,'HTTP path reaches measurement, telemetry and engine');
    assert.equal(httpPipelines['hardware-pilot'].engine.state.readings.length,hardwareBeforeVirtual,'HTTP test path remains isolated');
    assert.equal(virtual.send.toString().includes('.ingest('),false,'virtual tool has no direct engine injection');
  }finally{await new Promise(resolve=>server.close(resolve));}
  console.log('device ingress tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
