'use strict';
const crypto=require('node:crypto');
const {createDevServer}=require('../server/dev-server.js');
const virtual=require('../js/virtual-esp32.js');

(async()=>{
  const key=process.env.GASGUARD_TEST_DEVICE_KEY||crypto.randomBytes(24).toString('base64url'),env={...process.env,GASGUARD_HOST:'127.0.0.1',GASGUARD_PORT:'5567',GASGUARD_TEST_DEVICE_KEY:key};
  const server=createDevServer({env});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const baseUrl=`http://127.0.0.1:${server.address().port}`,health=await (await fetch(`${baseUrl}/api/v1/health`)).json();if(health.readiness?.ingress!=='AVAILABLE')throw new Error('Ingress health check failed');if(health.workspaces?.['hardware-pilot']?.telemetry!=='NO DATA')throw new Error('hardware-pilot was not isolated before verification');const sent=await virtual.send({baseUrl,scenario:'NORMAL',deviceKey:key});if(!sent.results.every(item=>item.status===202&&item.body.workspaceId==='device-test'))throw new Error('Virtual ESP32 was not accepted by device-test');const status=await (await fetch(`${baseUrl}/api/v1/device/status?workspace=device-test`)).json(),hardware=await (await fetch(`${baseUrl}/api/v1/device/status?workspace=hardware-pilot`)).json();if(status.telemetry!=='AVAILABLE')throw new Error('device-test did not enter receiving state');if(hardware.telemetry!=='NO DATA'||hardware.safety!=='UNKNOWN')throw new Error('virtual data affected hardware-pilot');console.log('PASS Virtual ESP32 → HTTP ingress → device-test');console.log('PASS hardware-pilot remained isolated');}finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(`FAIL ${error.message}`);process.exitCode=1;});
