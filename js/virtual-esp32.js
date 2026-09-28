(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GasGuardVirtualEsp32=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const values=Object.freeze({NORMAL:[82,84,83],RISING:[95,120,155],ATTENTION:[170,190,205],CRITICAL:[260,340,430],RECOVERY:[310,220,140]});
  function packets(scenario,{bootId='virtual-boot-1',startSequence=0,startTime='2026-01-01T00:00:00.000Z'}={}){
    const key=String(scenario||'NORMAL').toUpperCase(),base={deviceId:'SIM-ESP32-KITCHEN-01',sensorId:'MQ6-01',sensorType:'MQ6',bootId,raw:{adc:1800,sensorVoltage:1.45},environment:{temperature:30,humidity:64}};
    if(key==='INVALID_PAYLOAD')return [{deviceId:'SIM-ESP32-KITCHEN-01',sensorId:'MQ6-01'}];
    if(key==='REBOOT')return [{...base,bootId:'virtual-boot-before',sequence:9,timestamp:startTime,upstreamPpm:110},{...base,bootId:'virtual-boot-after',sequence:0,timestamp:new Date(Date.parse(startTime)+1000).toISOString(),upstreamPpm:90}];
    const ppm=values[key]||values.NORMAL,list=ppm.map((value,index)=>({...base,sequence:startSequence+index,timestamp:new Date(Date.parse(startTime)+index*1000).toISOString(),upstreamPpm:value}));
    if(key==='DUPLICATE')return [list[0],{...list[0]}];
    if(key==='OUT_OF_ORDER')return [{...list[0],sequence:2},{...list[1],sequence:1}];
    return list;
  }
  async function send({baseUrl='http://127.0.0.1:5567',scenario='NORMAL',deviceKey,fetchImpl=fetch,options={}}){
    if(!deviceKey)throw new Error('Device key is required outside frontend source');
    if(String(scenario).toUpperCase()==='OFFLINE'||String(scenario).toUpperCase()==='STALE')return {scenario,status:'NO PACKETS SENT'};
    const results=[];for(const payload of packets(scenario,options)){const reply=await fetchImpl(`${baseUrl}/api/v1/device/telemetry`,{method:'POST',headers:{'content-type':'application/json','x-device-key':deviceKey,'x-test-scenario':String(scenario).toUpperCase()},body:JSON.stringify(payload)});results.push({status:reply.status,body:await reply.json()});}return {scenario,results};
  }
  return Object.freeze({scenarios:Object.freeze(['NORMAL','RISING','ATTENTION','CRITICAL','RECOVERY','OFFLINE','STALE','DUPLICATE','OUT_OF_ORDER','REBOOT','INVALID_PAYLOAD']),packets,send});
});
