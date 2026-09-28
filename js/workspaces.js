(function (root, factory) {
  'use strict';
  const workspaces = factory();
  if (typeof module === 'object' && module.exports) module.exports = workspaces;
  else root.GasGuardWorkspaces = workspaces;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const definitions = Object.freeze({
    'demo-site': Object.freeze({
      id:'demo-site', name:'Demo Site / พื้นที่ตัวอย่าง', mode:'SIMULATION',
      label:'ข้อมูลจำลอง · Prototype', expectedDevice:null, expectedSensors:Object.freeze([])
    }),
    'hardware-pilot': Object.freeze({
      id:'hardware-pilot', name:'Hardware Pilot', mode:'DEVICE', source:'REAL_DEVICE',
      label:'Waiting for device', expectedDevice:'ESP32-KITCHEN-01',
      expectedSensors:Object.freeze(['MQ3-01','MQ6-01'])
    }),
    'device-test': Object.freeze({
      id:'device-test', name:'Device Test', mode:'DEVICE', source:'TEST_DEVICE',
      label:'TEST DATA / VIRTUAL DEVICE', expectedDevice:'SIM-ESP32-KITCHEN-01',
      expectedSensors:Object.freeze(['MQ3-01','MQ6-01'])
    })
  });
  const get = id => definitions[id] || definitions['demo-site'];
  const sourceFor = workspace => workspace?.mode === 'SIMULATION' ? 'simulation' : null;
  function presentation(workspace, telemetry = null) {
    const selected=get(workspace?.id || workspace);
    if(selected.mode==='DEVICE' && !telemetry) return Object.freeze({ workspace:selected, status:'WAITING_FOR_DEVICE', telemetry:'NO DATA', safety:'UNKNOWN', gasPpm:null, source:selected.source, canUseSimulation:false, isTest:selected.source==='TEST_DEVICE' });
    if(selected.mode==='SIMULATION') return Object.freeze({ workspace:selected, status:'SIMULATION', telemetry:telemetry?'AVAILABLE':'PROTOTYPE DATA', safety:telemetry?.safety || 'N/A', gasPpm:telemetry?.gasPpm ?? null, source:'simulation', canUseSimulation:true });
    return Object.freeze({ workspace:selected, status:selected.source==='TEST_DEVICE'?'TEST DATA':'DEVICE DATA', telemetry:'AVAILABLE', safety:telemetry.safety || 'UNKNOWN', gasPpm:telemetry.gasPpm ?? null, source:selected.source, canUseSimulation:false, isTest:selected.source==='TEST_DEVICE' });
  }
  return Object.freeze({ definitions, get, sourceFor, presentation, defaultWorkspaceId:'demo-site' });
});
