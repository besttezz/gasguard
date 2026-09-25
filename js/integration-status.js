(function(root,factory){'use strict';const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.GasGuardIntegrationStatus=model;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const STATES=Object.freeze({NOT_CONFIGURED:'NOT_CONFIGURED',READY_FOR_DEVICE:'READY_FOR_DEVICE',WAITING_FOR_DEVICE:'WAITING_FOR_DEVICE',RECEIVING:'RECEIVING',STALE:'STALE',ERROR:'ERROR'});
  function connection(workspaceStatus){
    if(!workspaceStatus)return STATES.WAITING_FOR_DEVICE;
    if(workspaceStatus.telemetry==='STALE'||workspaceStatus.connection==='OFFLINE')return STATES.STALE;
    if(workspaceStatus.telemetry==='AVAILABLE'&&workspaceStatus.connection==='ONLINE')return STATES.RECEIVING;
    if(workspaceStatus.connection==='WAITING_FOR_DEVICE'||workspaceStatus.telemetry==='NO DATA')return STATES.WAITING_FOR_DEVICE;
    return STATES.ERROR;
  }
  function readiness(input={}){
    if(input.error)return STATES.ERROR;
    return input.server&&input.ingress&&input.registry&&input.realDeviceKey?STATES.READY_FOR_DEVICE:STATES.NOT_CONFIGURED;
  }
  return Object.freeze({STATES,connection,readiness});
});
