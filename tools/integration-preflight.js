'use strict';
const registry=require('../server/device-registry.js');
const {resolveServerConfig}=require('../server/dev-server.js');
const virtual=require('../js/virtual-esp32.js');

const hidden=value=>value?'configured':'missing';
async function runPreflight({env=process.env,fetchImpl=fetch,write=console.log}={}){
  const results=[],add=(level,name,detail)=>results.push({level,name,detail});
  const major=Number(process.versions.node.split('.')[0]);
  add(major>=18?'PASS':'FAIL','Node runtime',`Node ${process.versions.node}`);
  let config;
  try{config=resolveServerConfig(env);add('PASS','Server config',`${config.host}:${config.port} · ${config.lanMode?'LAN':'localhost'} mode`);}catch(error){add('FAIL','Server config',error.message);}
  const credentials=registry.credentialsFromEnv(env);
  add(credentials['ESP32-KITCHEN-01']?'PASS':'WARN','Real device key',hidden(credentials['ESP32-KITCHEN-01']));
  add(credentials['SIM-ESP32-KITCHEN-01']?'PASS':'WARN','Test device key',hidden(credentials['SIM-ESP32-KITCHEN-01']));
  const registryReady=registry.resolve('ESP32-KITCHEN-01')?.workspaceId==='hardware-pilot'&&registry.resolve('SIM-ESP32-KITCHEN-01')?.workspaceId==='device-test';
  add(registryReady?'PASS':'FAIL','Device registry',registryReady?'real/test mappings present':'required mapping missing');
  add(typeof virtual.send==='function'&&virtual.scenarios.includes('NORMAL')?'PASS':'FAIL','Virtual ESP32 path','HTTP sender available');
  if(config){
    const healthUrl=`http://${['0.0.0.0','::'].includes(config.host)?'127.0.0.1':config.host}:${config.port}/api/v1/health`;
    try{const response=await fetchImpl(healthUrl,{headers:{accept:'application/json'}}),body=await response.json(),serialized=JSON.stringify(body);add(response.ok&&body.ingress===undefined&&body.readiness?.ingress==='AVAILABLE'?'PASS':'FAIL','Health endpoint',response.ok?'reachable':'unhealthy');const exposed=Object.values(credentials).filter(Boolean).some(secret=>serialized.includes(secret));add(exposed?'FAIL':'PASS','Secret exposure',exposed?'credential found in health response':'health response sanitized');}catch(error){add('WARN','Health endpoint','server not reachable; start npm run dev or dev:lan');add('WARN','Secret exposure','health response not available for inspection');}
  }
  results.forEach(item=>write(`${item.level} ${item.name}: ${item.detail}`));
  const exitCode=results.some(item=>item.level==='FAIL')?1:0;
  return {results,exitCode};
}
if(require.main===module)runPreflight().then(result=>{process.exitCode=result.exitCode;});
module.exports=Object.freeze({runPreflight});
