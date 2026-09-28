(function(root,factory){'use strict';const profiles=factory();if(typeof module==='object'&&module.exports)module.exports=profiles;else root.GasGuardIntegrationProfiles=profiles;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  return Object.freeze({
    hardwarePilotUser:Object.freeze({displayName:'Hardware Pilot User',role:'developer',defaultWorkspaceId:'hardware-pilot',authType:'USER_AUTH'}),
    deviceTestUser:Object.freeze({displayName:'Device Test User',role:'developer',defaultWorkspaceId:'device-test',authType:'USER_AUTH'})
  });
});
