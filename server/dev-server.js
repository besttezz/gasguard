'use strict';

const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const registry=require('./device-registry.js');
const {createDeviceIngress}=require('./device-ingress.js');
const {createPipeline}=require('./pipeline-runtime.js');
const integrationStatus=require('../js/integration-status.js');

const root=path.resolve(__dirname,'..');
const contentTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const json=(response,status,body)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(body));};
const readJson=request=>new Promise((resolve,reject)=>{let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>65536){reject(Object.assign(new Error('Payload too large'),{status:413}));request.destroy();}});request.on('end',()=>{try{resolve(JSON.parse(raw||'null'));}catch(error){reject(Object.assign(error,{status:400}));}});request.on('error',reject);});
function resolveServerConfig(env=process.env){
  const host=String(env.GASGUARD_HOST||'127.0.0.1').trim()||'127.0.0.1',port=Number(env.GASGUARD_PORT||5567);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('GASGUARD_PORT must be an integer from 1 to 65535');
  return Object.freeze({host,port,lanMode:!['127.0.0.1','localhost','::1'].includes(host)});
}

function createDevServer({env=process.env,ingress}={}){
  const deviceIngress=ingress||createDeviceIngress({registry,credentials:registry.credentialsFromEnv(env),pipelines:{'hardware-pilot':createPipeline(root),'device-test':createPipeline(root)}});
  const config=resolveServerConfig(env),credentials=registry.credentialsFromEnv(env),registryReady=Boolean(registry.resolve('ESP32-KITCHEN-01')&&registry.resolve('SIM-ESP32-KITCHEN-01'));
  return http.createServer(async(request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    if(request.method==='GET'&&url.pathname==='/api/v1/health'){
      const workspaces={'hardware-pilot':deviceIngress.status('hardware-pilot'),'device-test':deviceIngress.status('device-test')};
      const readiness={overall:integrationStatus.readiness({server:true,ingress:true,registry:registryReady,realDeviceKey:Boolean(credentials['ESP32-KITCHEN-01'])}),server:'READY',lan:config.lanMode?'ENABLED':'LOCALHOST_ONLY',ingress:'AVAILABLE',deviceAuth:{realConfigured:Boolean(credentials['ESP32-KITCHEN-01']),testConfigured:Boolean(credentials['SIM-ESP32-KITCHEN-01'])},registry:registryReady?'READY':'ERROR',realDevice:integrationStatus.connection(workspaces['hardware-pilot']),virtualTest:integrationStatus.connection(workspaces['device-test'])};
      json(response,200,{ok:true,service:'gasguard-device-ingress',readiness,workspaces});return;
    }
    if(request.method==='POST'&&url.pathname==='/api/v1/device/telemetry'){
      try{const payload=await readJson(request),result=deviceIngress.ingest({headers:request.headers,payload});json(response,result.status,result.body);}catch(error){json(response,error.status||500,{ok:false,code:error.status===413?'PAYLOAD_TOO_LARGE':'INVALID_JSON'});}return;
    }
    if(request.method==='GET'&&url.pathname==='/api/v1/device/status'){
      const workspaceId=url.searchParams.get('workspace');
      if(!['hardware-pilot','device-test'].includes(workspaceId)){json(response,400,{ok:false,code:'INVALID_WORKSPACE'});return;}
      json(response,200,{ok:true,...deviceIngress.status(workspaceId)});return;
    }
    if(request.method!=='GET'&&request.method!=='HEAD'){json(response,405,{ok:false,code:'METHOD_NOT_ALLOWED'});return;}
    const pathname=decodeURIComponent(url.pathname),relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)&&file!==root){response.writeHead(403);response.end('Forbidden');return;}
    fs.readFile(file,(error,body)=>{if(error){response.writeHead(404);response.end('Not found');return;}response.writeHead(200,{'content-type':contentTypes[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});if(request.method==='HEAD')response.end();else response.end(body);});
  });
}

if(require.main===module){const config=resolveServerConfig();createDevServer().listen(config.port,config.host,()=>console.log(`GasGuard V2 is running at http://${config.host}:${config.port}${config.lanMode?' (LAN mode)':''}`));}
module.exports=Object.freeze({createDevServer,resolveServerConfig});
