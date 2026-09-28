'use strict';
const {createDevServer,resolveServerConfig}=require('../server/dev-server.js');
const env={...process.env,GASGUARD_HOST:process.env.GASGUARD_HOST||'0.0.0.0'};
const config=resolveServerConfig(env);
createDevServer({env}).listen(config.port,config.host,()=>console.log(`GasGuard LAN server: http://${config.host}:${config.port}`));
