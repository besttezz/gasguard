(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GasGuardDemoData=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const LABEL='SIMULATION / PROTOTYPE';
  const DEFAULT_SCENARIO='NORMAL';
  const scenarios=Object.freeze({
    NORMAL:Object.freeze({engineScenario:'normal',steps:0}),
    ATTENTION:Object.freeze({engineScenario:'rise',steps:2}),
    CRITICAL:Object.freeze({engineScenario:'critical',steps:3}),
    RECOVERY:Object.freeze({engineScenario:'recovery',steps:1}),
    OFFLINE:Object.freeze({engineScenario:'unknown',steps:1})
  });
  const defaultEvents=()=>[
    {id:'demo-event-inspection-complete',eventId:'demo-event-inspection-complete',type:'system',eventType:'legacy',title:'ตรวจสอบระบบจำลองตามรอบแล้ว',detail:'SIMULATION / PROTOTYPE · ไม่มีงานค้าง',status:'resolved',lifecycleStatus:'resolved',severity:'safe',startedAt:'2026-01-15T09:30:00.000Z',lastUpdatedAt:'2026-01-15T09:35:00.000Z',resolvedAt:'2026-01-15T09:35:00.000Z',source:'simulation',deviceIds:['GG-KITCHEN-01'],evidence:{timeline:[],missingDataPeriods:[],alerts:[]},acknowledgement:{acknowledgedAt:null,acknowledgedBy:null},technicianReview:{status:'completed'},prototypeRuleVersion:'UNVALIDATED_PROTOTYPE/demo-v1',label:'maintenance',labelSource:'system',labelConfidence:'confirmed',t:Date.parse('2026-01-15T09:35:00.000Z')},
    {id:'demo-event-session-ready',eventId:'demo-event-session-ready',type:'system',eventType:'legacy',title:'Demo Site พร้อมสาธิต',detail:'SIMULATION / PROTOTYPE · deterministic default dataset',status:'resolved',lifecycleStatus:'resolved',severity:'safe',startedAt:'2026-01-15T09:00:00.000Z',lastUpdatedAt:'2026-01-15T09:00:00.000Z',resolvedAt:'2026-01-15T09:00:00.000Z',source:'simulation',deviceIds:['GG-KITCHEN-01'],evidence:{timeline:[],missingDataPeriods:[],alerts:[]},acknowledgement:{acknowledgedAt:null,acknowledgedBy:null},technicianReview:{status:'completed'},prototypeRuleVersion:'UNVALIDATED_PROTOTYPE/demo-v1',label:'normal',labelSource:'system',labelConfidence:'confirmed',t:Date.parse('2026-01-15T09:00:00.000Z')}
  ];
  const defaultServiceState=()=>({version:'service-workflow-v0.2',requests:[{requestId:'demo-request-complete',siteId:'demo-site',incidentId:null,zoneId:'kitchen',deviceIds:['GG-KITCHEN-01'],source:'simulation',requestType:'inspection',title:'ตรวจสอบ Demo Site ตามรอบ',description:'SIMULATION / PROTOTYPE',priority:'normal',status:'completed',submittedAt:'2026-01-14T08:00:00.000Z',completedAt:'2026-01-14T09:00:00.000Z',requester:null,requesterRole:'general',assignedTechnician:null,technicianNotes:[],relatedMaintenanceTaskIds:['demo-task-complete'],serviceReportId:'demo-report-complete',history:[],createdFrom:'general',mock:true}],tasks:[{maintenanceTaskId:'demo-task-complete',requestId:'demo-request-complete',incidentId:null,siteId:'demo-site',zoneId:'kitchen',deviceId:'GG-KITCHEN-01',actionType:'prototype_inspection',description:'SIMULATION / PROTOTYPE inspection example',status:'completed',actorRole:'technician',performedBy:null,startedAt:'2026-01-14T08:30:00.000Z',completedAt:'2026-01-14T08:50:00.000Z',result:'prototype check complete',notes:null,evidence:[],mock:true}],verifications:[{verificationId:'demo-verification-complete',requestId:'demo-request-complete',incidentId:null,performedAt:'2026-01-14T08:55:00.000Z',actorRole:'technician',performedBy:null,testType:'simulation_follow_up',expectedResult:'normal simulation state',observedResult:'normal simulation state',result:'passed',evidence:[],notes:'SIMULATION / PROTOTYPE',mock:true}],reports:[{reportId:'demo-report-complete',requestId:'demo-request-complete',incidentId:null,siteId:'demo-site',zoneId:'kitchen',deviceIds:['GG-KITCHEN-01'],reportedIssue:'Scheduled prototype inspection',incidentSummary:null,diagnosticSummary:'SIMULATION / PROTOTYPE',actionsPerformed:['demo-task-complete'],partsReplaced:[],verificationResult:'passed',detectionStatusAtCompletion:null,technicianWorkflowResult:'completed',createdAt:'2026-01-14T09:00:00.000Z',completedAt:'2026-01-14T09:00:00.000Z',nextAction:null,technicianIdentity:null,actorRole:'technician',evidenceReferences:[],mock:true}],warning:null,migration:null});
  const allowed=workspaceId=>workspaceId==='demo-site';
  function runScenario(name,{workspaceId,engine}){
    const scenario=scenarios[name];if(!allowed(workspaceId))return{ok:false,code:'WORKSPACE_DENIED'};if(!scenario||!engine)return{ok:false,code:'SCENARIO_UNAVAILABLE'};
    engine.clearEvents();
    if(name==='RECOVERY'){engine.restartSimulation('critical');for(let i=0;i<3;i+=1)engine.tick();engine.setScenario('normal');for(let i=0;i<3;i+=1)engine.tick();}
    else{engine.restartSimulation(scenario.engineScenario);for(let i=0;i<scenario.steps;i+=1)engine.tick();}
    engine.saveSource({mode:'simulation',restUrl:'',mqttUrl:'',topic:''});
    return{ok:true,code:'SCENARIO_READY',scenario:name,label:LABEL,safety:engine.analysis.safety};
  }
  function reset({workspaceId,engine,service}){
    if(!allowed(workspaceId))return{ok:false,code:'WORKSPACE_DENIED'};
    const scenario=runScenario(DEFAULT_SCENARIO,{workspaceId,engine});if(!scenario.ok)return scenario;
    engine.state.events.splice(0,engine.state.events.length,...defaultEvents());engine.saveSource({mode:'simulation',restUrl:'',mqttUrl:'',topic:''});
    if(service?.resetDemoState)service.resetDemoState(defaultServiceState());
    return{ok:true,code:'DEMO_RESET_COMPLETE',scenario:DEFAULT_SCENARIO,label:LABEL};
  }
  return Object.freeze({LABEL,DEFAULT_SCENARIO,scenarios,defaultEvents,defaultServiceState,runScenario,reset});
});
