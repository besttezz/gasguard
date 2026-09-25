(function () {
  'use strict';
  const { history, scenarios, reading, contract, sensorFleet, validateTelemetry, TELEMETRY_STALE_MS } = window.GasGuardData;
  const mean = a => a.reduce((s, n) => s + n, 0) / (a.length || 1);
  const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(n => (n - m) ** 2))); };
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const round = (n, d = 0) => Number(n.toFixed(d));
  const correctedPpm = reading => {
    const gas = reading.gas.calculatedPpm ?? reading.gas.value;
    const temp = reading.environment.temperature ?? 30;
    const humidity = reading.environment.humidity ?? 65;
    const factor = 1 + (temp - 30) * .003 + (humidity - 65) * .0015;
    return Math.max(0, gas / factor);
  };
  const average = values => values.length ? mean(values) : 0;
  const timeValue = reading => new Date(reading.timestamp).getTime();

  const STORE_KEY = 'gasguard-v2-draft';
  const PROTOTYPE_RULE_VERSION = 'UNVALIDATED_PROTOTYPE/event-lifecycle-v0.1';
  const storage = typeof localStorage === 'undefined' ? null : localStorage;
  function load() { const raw=storage&&storage.getItem(STORE_KEY); if(raw==null)return{saved:{},integrityFault:null};try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('invalid schema');return{saved:parsed,integrityFault:null};}catch(e){return{saved:{},integrityFault:{at:new Date().toISOString(),code:'storage_corrupt',message:'พบข้อมูลเดิมเสียหาย ระบบไม่สามารถยืนยันสถานะได้',raw}};} }
  const loaded = load(), saved = loaded.saved;
  const state = { scenario: saved.scenario || 'normal', paused: false, initializing: false, readings: Array.isArray(saved.readings) && saved.readings.length ? saved.readings : history.slice(), events: Array.isArray(saved.events) && saved.events.length ? saved.events : [{ id:'evt-system-start', type: 'system', title: 'เริ่ม Data Analysis Engine', detail: 'Mock provider เชื่อมต่อกับ Feature Engine แล้ว', status:'resolved', label:'maintenance', labelSource:'system', labelConfidence:'confirmed', t: Date.now() - 8 * 60000 }], index: history.length, source: saved.source || { mode: 'simulation', restUrl: '', mqttUrl: '', topic: 'gasguard/+/reading' }, integrityFault:loaded.integrityFault, recoveryTransition:null, lastIngestError:null };
  state.index=Math.max(state.index,...state.readings.filter(item=>Number.isInteger(item.sequence)).map(item=>item.sequence+1));
  const severityRank = { safe:0, attention:1, critical:2, unknown:0 };
  const eventTime = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(); };
  const eventContext = f => ({ siteId:f.current.locationId ?? null, zoneId:f.current.zoneId ?? null, deviceIds:[f.current.deviceId,f.current.sensorId].filter(Boolean) });
  const readingSummary = f => ({ timestamp:f.current.timestamp || null, lpgPpm:f.correctedGas ?? null, riskScore:f.risk ?? null, anomalyScore:f.anomaly ?? null, safety:f.safety, valveCommand:f.current.system.commandedValveState ?? null, valveFeedback:f.current.system.actualValveState ?? f.current.system.valve ?? null, connection:f.current.system.connection ?? null });
  const titleFor = (type,severity) => type === 'system_fault' ? 'ไม่สามารถยืนยันการติดตามระบบได้' : severity === 'critical' ? 'ความเสี่ยง LPG ระดับสูง' : 'พบแนวโน้ม LPG ผิดปกติ';
  const normalizeEvent = (event,index) => {
    if (event.eventId) return { ...event, id:event.id || event.eventId, eventType:event.legacy&&event.type==='system'?'legacy':event.eventType, lifecycleStatus:event.legacy&&event.type==='system'?'resolved':event.lifecycleStatus, resolvedAt:event.legacy&&event.type==='system'?(event.resolvedAt||eventTime(event.t||Date.now())):event.resolvedAt, deviceIds:Array.isArray(event.deviceIds)?event.deviceIds:[], evidence:event.evidence || { timeline:[], missingDataPeriods:[], alerts:[] }, acknowledgement:event.acknowledgement || { acknowledgedAt:null, acknowledgedBy:null }, technicianReview:event.technicianReview || { status:'not_started', startedAt:null, updatedAt:null, resolvedAt:null, note:null }, prototypeRuleVersion:event.prototypeRuleVersion || PROTOTYPE_RULE_VERSION };
    const at = eventTime(event.t || Date.now());
    return { eventId:event.id || `legacy-event-${index}-${event.t||Date.now()}`, id:event.id || `legacy-event-${index}-${event.t||Date.now()}`, siteId:null, zoneId:null, deviceIds:[], eventType:event.type === 'system' ? 'legacy' : 'gas_risk', source:'legacy', lifecycleStatus:event.status === 'resolved' || event.type === 'system' ? 'resolved' : 'open', severity:event.type === 'critical' ? 'critical' : event.type === 'warning' ? 'attention' : 'unknown', peakSeverity:event.type === 'critical' ? 'critical' : event.type === 'warning' ? 'attention' : 'unknown', startedAt:at, lastUpdatedAt:at, resolvedAt:event.status === 'resolved' || event.type === 'system' ? at : null, firstReading:null, latestReading:null, peakLpgPpm:null, peakRiskScore:null, peakAnomalyScore:null, readingCount:0, updateCount:0, acknowledgement:{ acknowledgedAt:null, acknowledgedBy:null }, technicianReview:{ status:'not_started', startedAt:null, updatedAt:null, resolvedAt:null, note:null }, resolutionSummary:null, prototypeRuleVersion:PROTOTYPE_RULE_VERSION, evidence:{ timeline:[{ at, type:'legacy_import', detail:'Legacy event has no recoverable reading context' }], missingDataPeriods:[], alerts:[] }, legacy:true, type:event.type || 'system', title:event.title || 'Legacy event', detail:event.detail || 'ยังไม่มีข้อมูล', label:event.label || 'unknown', labelSource:event.labelSource || null, labelConfidence:event.labelConfidence || 'low', t:event.t || Date.now() };
  };
  state.events = state.events.map(normalizeEvent);
  function retainedEvents(){const protectedIds=window.GasGuardService?.protectedIncidentIds?.()||new Set(),keep=[],eligible=[];state.events.forEach(event=>{const id=event.eventId||event.id,protectedEvent=event.lifecycleStatus!=='resolved'||(event.technicianReview&&event.technicianReview.status!=='completed')||protectedIds.has(id);(protectedEvent?keep:eligible).push(event)});const limit=80,result=keep.length>=limit?[...keep,...eligible]:[...keep,...eligible.slice(0,limit-keep.length)];state.retentionWarning=keep.length>=limit?'มี Incident หรืองานบริการที่ต้องเก็บเกินขีดจำกัดปกติ จึงเก็บทั้งหมดไว้ก่อน; localStorage อาจเต็ม':result.length<state.events.length?'เก็บ Incident ที่เปิดอยู่และงานบริการที่ยังไม่เสร็จก่อน; รายการเก่าที่ปิดครบแล้วถูกจำกัดตาม localStorage':null;return result;}
  function persist() {
    try {
      if (storage) storage.setItem(STORE_KEY, JSON.stringify({ scenario: state.scenario, readings: state.readings.slice(-360), events: retainedEvents(), source: state.source }));
    } catch (e) {}
  }
  function recoverIntegrityFromValidReading() {
    const fault=state.integrityFault;
    if(!fault)return;
    const at=new Date().toISOString();
    try { if(storage&&fault.raw!=null)storage.setItem(`${STORE_KEY}-corrupt-backup`,fault.raw); } catch(e) {}
    state.integrityFault=null;
    state.recoveryTransition={at,type:'storage_recovery',code:'storage_recovery',previousFaultCode:fault.code,message:'รับข้อมูล telemetry ที่ตรวจรูปแบบได้แล้ว; เริ่มสถานะในเครื่องใหม่โดยเก็บ raw ที่เสียหายไว้เป็น backup'};
    state.events.unshift(normalizeEvent({
      id:`evt-storage-recovery-${Date.now()}`,
      type:'system',title:'กู้คืนการติดตามจากข้อมูลในเครื่องที่เสียหาย',
      detail:'พบ telemetry รูปแบบถูกต้องแล้ว แต่ข้อมูลเดิมถูกเก็บไว้เป็น backup เพื่อการตรวจสอบ',
      status:'resolved',t:Date.now(),label:'unknown',labelSource:'system',labelConfidence:'confirmed'
    },0));
  }

  function feature(readings) {
    const latest = readings.at(-1), receivedTime=new Date(latest.receivedAt).getTime();
    const stale = !Number.isFinite(receivedTime) || Date.now() - receivedTime > TELEMETRY_STALE_MS;
    const current = stale ? { ...latest, system:{ ...latest.system, connection:'offline' } } : latest;
    const values = readings.map(correctedPpm);
    const baselinePool = values.slice(-90, -10);
    const baseline = mean(baselinePool);
    const short = values.slice(-6);
    const rate = (short.at(-1) - short[0]) / Math.max(1, short.length - 1);
    const variance = std(baselinePool);
    const exposure = readings.slice(-30).reduce((sum, r) => sum + Math.max(0, correctedPpm(r) - baseline), 0) * 2;
    const humidityPenalty = Math.max(0, current.environment.humidity - 72) * .7;
    const temperaturePenalty = Math.max(0, Math.abs(current.environment.temperature - 30) - 6) * 1.2;
    const warmupPenalty = current.quality && current.quality.warmupComplete === false ? 42 : 0;
    const agePenalty = 3;
    const connection = current.system.connection;
    const confidence = connection !== 'online' ? 0 : clamp(96 - humidityPenalty - temperaturePenalty - warmupPenalty - agePenalty - Math.min(20, variance / 2), 0, 98);
    const currentCorrected = correctedPpm(current);
    const z = variance ? Math.abs((currentCorrected - baseline) / variance) : 0;
    const valveMismatch = current.system.commandedValveState && current.system.actualValveState && current.system.commandedValveState !== current.system.actualValveState;
    const anomaly = connection !== 'online' ? 0 : clamp(z * 16 + Math.max(0, rate) * 4 + (current.system.valve === 'closed' && currentCorrected > baseline + 55 ? 18 : 0) + (valveMismatch ? 20 : 0), 0, 100);
    const risk = connection !== 'online' ? null : clamp(
      Math.max(0, currentCorrected - 130) * .075 + Math.max(0, rate) * 4.1 + Math.min(24, exposure / 125) + anomaly * .24 + (current.system.valve === 'closed' && currentCorrected > baseline + 65 ? 14 : 0) + (valveMismatch ? 18 : 0) + (100 - confidence) * .1, 0, 100);
    const drift = baseline - 84;
    const sensorHealth = connection !== 'online' ? 42 : clamp(100 - Math.abs(drift) * .55 - Math.max(0, 100 - confidence) * .45 - Math.min(15, variance / 4), 45, 99);
    let classification = 'Expected operating pattern';
    if (connection !== 'online') classification = 'Monitoring unavailable';
    else if (valveMismatch) classification = 'Valve command-feedback mismatch';
    else if (current.system.valve === 'closed' && currentCorrected > baseline + 55) classification = 'Possible residual or downstream LPG accumulation';
    else if (rate > 3 && current.system.activity === 'inactive') classification = 'Abnormal LPG rise outside expected activity';
    else if (rate > 3 && current.system.activity === 'active') classification = 'Elevated LPG during active operation';
    let safety = 'safe';
    if (connection !== 'online') safety = 'unknown'; else if (risk >= 72) safety = 'critical'; else if (risk >= 38) safety = 'attention';
    const currentTime = timeValue(current);
    const rateFor = seconds => { const before=readings.filter(r=>timeValue(r)<=currentTime-seconds*1000).at(-1); if(!before)return null; const minutes=Math.max(.01,(currentTime-timeValue(before))/60000); return round((currentCorrected-correctedPpm(before))/minutes,2); };
    const valuesFor = seconds => { const selected=readings.filter(r=>timeValue(r)>=currentTime-seconds*1000).map(correctedPpm); return selected.length?selected:values.slice(-Math.min(values.length,6)); };
    const rate1m=rateFor(60), rate5m=rateFor(300), rate30s=rateFor(30), rate5s=rateFor(5);
    const avg1m=average(valuesFor(60)),avg5m=average(valuesFor(300)),avg15m=average(valuesFor(900)),avg1h=average(valuesFor(3600));
    const oneMinute=valuesFor(60),fiveMinute=valuesFor(300),oneHour=valuesFor(3600),peak=Math.max(...fiveMinute),peakIndex=fiveMinute.lastIndexOf(peak);
    const fleet=(sensorFleet?sensorFleet(current):[]).filter(x=>x.online),fusionMean=average(fleet.map(x=>x.ppm)),fusionSpread=fleet.length?Math.max(...fleet.map(x=>Math.abs(x.ppm-fusionMean))):0,fusionConfidence=fleet.length?round(clamp(average(fleet.map(x=>x.health))-fusionSpread*.55,0,99)):0;
    const valveHealth=current.system.actualValveState!==current.system.commandedValveState?20:round(clamp(100-current.system.valveFailedCommandCount*25-Math.max(0,current.system.valveResponseTimeMs-800)/20,0,100));
    const connectivityHealth=current.system.connection!=='online'?0:round(clamp(100-Math.max(0,-current.system.rssi-55)*1.5-current.system.packetLossPct*3-current.system.reconnectCount*4,0,100));
    const batteryHealth=round(clamp((current.system.battery||0)-Math.max(0,3.7-(current.system.batteryVoltage||4))*60,0,100));
    const peakDurationSec=peakIndex>=0?(fiveMinute.length-1-peakIndex)*2:0;
    const recoveryRate=currentCorrected<peak&&peakDurationSec?round((peak-currentCorrected)/Math.max(1,peakDurationSec/60),2):0;
    const integrityUnknown=Boolean(state.integrityFault)||Boolean(state.initializing);return { current, rawGas: round(current.gas.calculatedPpm ?? current.gas.value), correctedGas: round(currentCorrected), compensation: { temperature: round((current.environment.temperature - 30) * .003, 4), humidity: round((current.environment.humidity - 65) * .0015, 4), formulaVersion: 'prototype-comp-v0.1' }, baseline: round(baseline), rate: round(rate * 0.5, 1), variance: round(variance, 1), exposure: round(exposure), confidence: integrityUnknown?0:round(confidence), anomaly: round(anomaly), risk: integrityUnknown?null:(risk == null ? null : round(risk)), safety:integrityUnknown?'unknown':safety, stale, telemetryAgeMs:Number.isFinite(receivedTime)?Math.max(0,Date.now()-receivedTime):null, clockSkewMs:Number.isFinite(receivedTime)?receivedTime-timeValue(latest):null, z: round(z, 2), drift: round(drift, 1), sensorHealth: round(sensorHealth), valveMismatch, classification:state.initializing?'Initializing: waiting for a valid reading':integrityUnknown?'Data integrity fault':classification, integrityFault:state.integrityFault, initializing:Boolean(state.initializing), features:{rates:{rate5s,rate30s,rate1m,rate5m},movingAverages:{avg1m:round(avg1m),avg5m:round(avg5m),avg15m:round(avg15m),avg1h:round(avg1h)},stability:{std1m:round(std(oneMinute),2),std5m:round(std(fiveMinute),2),std1h:round(std(oneHour),2)},eventShape:{peakValue:round(peak),peakDurationSec,recoveryRate,timeAboveBaselineSec:readings.slice(-30).filter(r=>correctedPpm(r)>baseline).length*2,areaUnderCurve:round(exposure)},fusion:{sensors:fleet,mean:round(fusionMean),spread:round(fusionSpread),confidence:fusionConfidence}},reliability:{valveHealth,connectivityHealth,batteryHealth} };
  }

  function describe(f) {
    if (f.safety === 'unknown') return { title: 'สถานะความปลอดภัยไม่ทราบ', text: 'ไม่มีข้อมูลใหม่จากเซ็นเซอร์ จึงไม่สามารถยืนยันความปลอดภัยของพื้นที่ได้', action: 'ตรวจสอบการเชื่อมต่อของอุปกรณ์และสถานะไฟเลี้ยงก่อนตัดสินใจด้านความปลอดภัย' };
    if (f.safety === 'critical') return { title: 'ตรวจพบความเสี่ยงสูง', text: `LPG เพิ่ม ${f.rate > 0 ? 'อย่างรวดเร็ว' : 'สูงกว่าปกติ'} จาก baseline ${f.baseline} ppm และมี anomaly score ${f.anomaly}`, action: 'ตรวจพื้นที่ทันที, ตรวจวาล์วและระบบระบายอากาศ, ยืนยันค่าเซ็นเซอร์ก่อนการดำเนินการอัตโนมัติ' };
    if (f.safety === 'attention') return { title: 'พบรูปแบบที่ต้องเฝ้าระวัง', text: `ค่าปัจจุบันต่างจาก baseline และอัตราการเพิ่มอยู่ที่ ${f.rate} ppm/min`, action: 'ติดตามแนวโน้มอย่างใกล้ชิด และตรวจสอบบริบทการใช้งานครัว' };
    return { title: 'รูปแบบการใช้งานอยู่ในเกณฑ์คาดหมาย', text: `ค่า LPG ยังคงใกล้ baseline ${f.baseline} ppm, ไม่มีการเพิ่มขึ้นผิดปกติ`, action: 'เฝ้าระวังต่อเนื่องตามรอบการทำงานปกติ' };
  }

  function activeEvent(context,eventType) { return state.events.find(event => !event.legacy && event.eventType === eventType && event.siteId === context.siteId && event.zoneId === context.zoneId && event.lifecycleStatus !== 'resolved'); }
  function appendTransition(event,type,detail,at) { event.evidence.timeline.push({ at, type, detail }); if (event.evidence.timeline.length > 40) event.evidence.timeline.shift(); }
  function createEvent(f,eventType) {
    const at = eventTime(f.current.timestamp), context = eventContext(f), severity = eventType === 'system_fault' ? 'unknown' : f.safety, summary = readingSummary(f), id = `evt-${Date.now()}-${Math.random().toString(16).slice(2,6)}`;
    const event = { eventId:id, id, ...context, eventType, source:state.source.mode || 'simulation', lifecycleStatus:eventType === 'system_fault' ? 'system_fault' : 'open', severity, peakSeverity:severity, startedAt:at, lastUpdatedAt:at, resolvedAt:null, firstReading:summary, latestReading:summary, peakLpgPpm:summary.lpgPpm, peakRiskScore:summary.riskScore, peakAnomalyScore:summary.anomalyScore, readingCount:1, updateCount:0, acknowledgement:{ acknowledgedAt:null, acknowledgedBy:null }, technicianReview:{ status:'not_started', startedAt:null, updatedAt:null, resolvedAt:null, note:null }, resolutionSummary:null, prototypeRuleVersion:PROTOTYPE_RULE_VERSION, evidence:{ timeline:[{ at, type:'detected', detail:eventType === 'system_fault' ? 'Monitoring state is unknown; safety cannot be confirmed' : `Detected ${severity} gas-risk state` }], missingDataPeriods:[], alerts:[] }, type:eventType === 'system_fault' ? 'system' : severity === 'critical' ? 'critical' : 'warning', title:titleFor(eventType,severity), detail:eventType === 'system_fault' ? 'ข้อมูล sensor หรือ network ไม่พร้อม จึงไม่สามารถยืนยันสถานะความปลอดภัยได้' : `LPG ${summary.lpgPpm ?? 'ยังไม่มีข้อมูล'} ppm · Risk ${summary.riskScore ?? 'ยังไม่มีข้อมูล'} / 100`, label:'unknown', labelSource:null, labelConfidence:'low', triggerReason:f.classification, t:new Date(at).getTime() };
    state.events.unshift(event); state.events = state.events.slice(0,80); return event;
  }
  function updateEvent(event,f) {
    const at = eventTime(f.current.timestamp), summary = readingSummary(f), previousSeverity = event.severity;
    event.lastUpdatedAt=at; event.latestReading=summary; event.readingCount+=1; event.updateCount+=1;
    event.peakLpgPpm=Math.max(event.peakLpgPpm ?? -Infinity, summary.lpgPpm ?? -Infinity); if (event.peakLpgPpm===-Infinity) event.peakLpgPpm=null;
    event.peakRiskScore=Math.max(event.peakRiskScore ?? -Infinity, summary.riskScore ?? -Infinity); if (event.peakRiskScore===-Infinity) event.peakRiskScore=null;
    event.peakAnomalyScore=Math.max(event.peakAnomalyScore ?? -Infinity, summary.anomalyScore ?? -Infinity); if (event.peakAnomalyScore===-Infinity) event.peakAnomalyScore=null;
    if (severityRank[f.safety] > severityRank[event.peakSeverity]) { event.peakSeverity=f.safety; appendTransition(event,'escalated',`${previousSeverity} → ${f.safety}`,at); }
    if (f.safety !== 'unknown') { event.severity=f.safety; event.type=f.safety === 'critical' ? 'critical' : 'warning'; event.title=titleFor('gas_risk',f.safety); }
    event.detail=event.eventType === 'system_fault' ? 'ข้อมูล sensor หรือ network ไม่พร้อม จึงไม่สามารถยืนยันสถานะความปลอดภัยได้' : `ล่าสุด LPG ${summary.lpgPpm ?? 'ยังไม่มีข้อมูล'} ppm · Risk ${summary.riskScore ?? 'ยังไม่มีข้อมูล'} / 100`;
    appendTransition(event,'reading_update',`Reading ${event.readingCount} retained in incident`,at);
  }
  function resolveEvent(event,at,summary) { event.lifecycleStatus='resolved'; event.resolvedAt=at; event.lastUpdatedAt=at; if(summary) event.latestReading=summary; appendTransition(event,'resolved','Engine returned to its existing normal/safe state',at); }
  function syncLifecycle(f) {
    const context=eventContext(f), at=eventTime(f.current.timestamp), summary=readingSummary(f);
    if (f.safety === 'unknown') {
      const fault=activeEvent(context,'system_fault');
      if(fault) { updateEvent(fault,f); fault.lifecycleStatus='system_fault'; fault.evidence.missingDataPeriods.push({ at, reason:'unknown monitoring state' }); if(fault.evidence.missingDataPeriods.length>20) fault.evidence.missingDataPeriods.shift(); }
      else createEvent(f,'system_fault');
      return;
    }
    const fault=activeEvent(context,'system_fault'); if(fault) resolveEvent(fault,at,summary);
    if (f.safety === 'safe') { state.events.filter(event=>!event.legacy&&event.eventType==='gas_risk'&&event.siteId===context.siteId&&event.zoneId===context.zoneId&&event.lifecycleStatus!=='resolved').forEach(event=>resolveEvent(event,at,summary)); return; }
    const gas=activeEvent(context,'gas_risk'); if(gas) updateEvent(gas,f); else createEvent(f,'gas_risk');
  }

  function normalizeIncoming(input) {
    const validated=validateTelemetry(input);
    if(!validated.ok){state.lastIngestError={code:'invalid_telemetry',errors:validated.errors};return null;}
    const canonical=validated.value, simulated=input.sensorType==='SIMULATED', receivedAt=new Date().toISOString();
    return {
      ...contract, ...canonical,
      locationId:simulated ? input.locationId ?? contract.locationId : null, zoneId:simulated ? input.zoneId ?? contract.zoneId : null,
      gas:{ ...contract.gas, ...canonical.gas, value:canonical.gas.ppm, calculatedPpm:canonical.gas.ppm, correctedPpm:canonical.gas.ppm },
      environment:{ ...contract.environment, ...canonical.environment },
      quality:{ ...contract.quality, ...(simulated ? input.quality || {} : {}) },
      system:{ ...contract.system, ...(simulated ? input.system || {} : {}), connection:canonical.system.connection },
      timestamp:canonical.timestamp, receivedAt, clockSkewMs:new Date(receivedAt).getTime()-new Date(canonical.timestamp).getTime()
    };
  }

  function thresholdState(reading) {
    if (reading.system.connection !== 'online') return 'unknown';
    if (reading.gas.value >= 300) return 'critical';
    if (reading.gas.value >= 180) return 'attention';
    return 'safe';
  }

  const validationCases = [
    { id:'normal', title:'การทำงานปกติ', expected:'safe', context:'Valve open · kitchen active', values:[88,92,96,91,98], note:'ไม่ควรแจ้งเตือนเมื่อค่าอยู่ในช่วง baseline ปกติ' },
    { id:'transient', title:'Peak สั้นระหว่างทำอาหาร', expected:'safe', context:'Valve open · kitchen active', values:[92,116,158,142,101], note:'ใช้ rate และบริบทเพื่อแยก peak ชั่วคราวออกจากการรั่วต่อเนื่อง' },
    { id:'leak', title:'LPG เพิ่มต่อเนื่องผิดคาด', expected:'critical', context:'Valve closed · kitchen inactive', values:[91,126,188,276,390], note:'contextual model ต้องยกระดับจาก pattern ที่เพิ่มต่อเนื่อง แม้ก่อนแตะ threshold สูงสุด' },
    { id:'offline', title:'Sensor / network ไม่พร้อม', expected:'unknown', context:'Connection offline', values:[94], note:'ต้องไม่สรุปว่า safe เมื่อไม่มี telemetry ใหม่' }
  ];

  function validateCase(item) {
    const system = item.id === 'offline' ? { connection:'offline', valve:'unknown', activity:'unknown' } : item.id === 'leak' ? { connection:'online', valve:'closed', activity:'inactive' } : { connection:'online', valve:'open', activity:'active' };
    const sequence = history.slice(-90).concat(item.values.map((value, index) => reading(0, value, { system: { ...system } }))); 
    const assessed = feature(sequence);
    const baseline = assessed.baseline;
    const contextualStep = item.values.findIndex((_, index) => {
      const partial = feature(history.slice(-90).concat(item.values.slice(0,index+1).map(value => reading(0,value,{system:{...system}}))));
      return partial.safety !== 'safe';
    });
    const thresholdStep = item.values.findIndex(value => thresholdState({ gas:{ value }, system }) !== 'safe');
    return { ...item, contextual: assessed.safety, threshold: thresholdState({ gas:{value:item.values.at(-1)},system }), contextualStep, thresholdStep, pass: assessed.safety === item.expected, baseline };
  }

  function failSafeChecks() {
    const last = state.readings.at(-1);
    const offline = feature(state.readings.slice(-90).concat([{ ...last, system:{ ...last.system, connection:'offline', valve:'unknown', activity:'unknown' } } ]));
    return [
      { id:'offline', title:'Telemetry disconnect', result:offline.safety === 'unknown' && offline.risk === null ? 'PASS' : 'FAIL', detail:'ต้องแสดง Unknown และไม่สร้าง risk score' },
      { id:'malformed', title:'Malformed payload', result:normalizeIncoming({ value:'not-a-number' }) === null ? 'PASS' : 'FAIL', detail:'payload ที่ไม่มีค่า LPG ถูกปฏิเสธก่อนเข้า engine' },
      { id:'actuation', title:'Remote actuation boundary', result:'MANUAL', detail:'prototype ไม่มีคำสั่งตัดวาล์วจากเว็บ, ต้องยืนยัน edge fail-safe และ manual override บนอุปกรณ์จริง' }
    ];
  }

  const engine = {
    state,
    retainedEventPreview() { return retainedEvents(); },
    normalizeLegacyEvents() { state.events=state.events.map(normalizeEvent); persist(); return state.events; },
    get analysis() { return feature(state.readings); },
    get explanation() { return describe(this.analysis); },
    setScenario(s) { state.scenario = s; persist(); },
    setInitializing(value) { state.initializing = Boolean(value); },
    restartSimulation(scenario) { state.scenario = scenario || state.scenario; state.readings = history.slice(); state.index = history.length; state.paused = false; state.initializing = false; state.lastIngestError=null; persist(); return this.analysis; },
    togglePause() { state.paused = !state.paused; },
    clearEvents() { state.events = []; persist(); },
    saveSource(source) { state.source = { ...state.source, ...source }; persist(); },
    exportData() { return JSON.stringify({ version: 'draft-1', exportedAt: new Date().toISOString(), readings: state.readings, events: state.events, source: state.source }, null, 2); },
    get validation() { return validationCases.map(validateCase); },
    runValidation() { const results=this.validation; return { ranAt:new Date().toISOString(), results, passed:results.filter(x=>x.pass).length, total:results.length }; },
    runFailSafeDrill() { return { ranAt:new Date().toISOString(), checks:failSafeChecks() }; },
    incidentEvidence() { const f=this.analysis; return { schemaVersion:'gasguard-incident-evidence-v0.2', prototypeRuleVersion:PROTOTYPE_RULE_VERSION, generatedAt:new Date().toISOString(), scope:'Prototype analytics evidence. Not a certified safety record or actuator command.', currentReading:f.current, analysis:{ baseline:f.baseline, ratePpmPerMinute:f.rate, exposurePpmMinute:f.exposure, anomalyScore:f.anomaly, riskScore:f.risk, safetyState:f.safety, confidence:f.confidence, classification:f.classification }, integrity:{ status:f.integrityFault?'unknown':'verified_from_current_session', fault:f.integrityFault, recoveryTransition:state.recoveryTransition }, explanation:this.explanation, recentEvents:state.events.slice(0,10), source:{ mode:state.source.mode, providerBoundary:'Web data layer only. Edge safety controller validation required.' } }; },
    labelEvent(eventId, label, source='engineer', confidence='medium') { const event=state.events.find(x=>(x.eventId||x.id)===eventId); if(!event)return false; event.label=label;event.labelSource=source;event.labelConfidence=confidence;persist();return true; },
    acknowledgeEvent(eventId, by='technician') { const event=state.events.find(x=>(x.eventId||x.id)===eventId); if(!event)return false; const at=new Date().toISOString();event.acknowledgement={acknowledgedAt:at,acknowledgedBy:by};event.technicianReview={...event.technicianReview,status:event.technicianReview.status==='not_started'?'acknowledged':event.technicianReview.status,updatedAt:at};appendTransition(event,'acknowledged',`Acknowledged by ${by}`,at);persist();return true; },
    startInvestigation(eventId, by='technician') { const event=state.events.find(x=>(x.eventId||x.id)===eventId); if(!event)return false; const at=new Date().toISOString();event.technicianReview={...event.technicianReview,status:'investigating',startedAt:event.technicianReview.startedAt||at,updatedAt:at,startedBy:by};appendTransition(event,'investigating',`Investigation started by ${by}`,at);persist();return true; },
    saveTechnicianNote(eventId,note) { const event=state.events.find(x=>(x.eventId||x.id)===eventId); if(!event)return false; const at=new Date().toISOString();event.technicianReview={...event.technicianReview,note:String(note||'').trim()||null,updatedAt:at};appendTransition(event,'technician_note',event.technicianReview.note||'No note supplied',at);persist();return true; },
    markTechnicianResolved(eventId,summary='') { const event=state.events.find(x=>(x.eventId||x.id)===eventId); if(!event)return false; const at=new Date().toISOString();event.technicianReview={...event.technicianReview,status:'resolved',resolvedAt:at,updatedAt:at};event.resolutionSummary=String(summary||'').trim()||event.resolutionSummary||null;appendTransition(event,'technician_workflow_resolved','Technician workflow completed; engine detection lifecycle is unchanged',at);persist();return true; },
    get alarmQuality() { const safetyEvents=state.events.filter(x=>x.eventType==='gas_risk'), labelled=safetyEvents.filter(x=>x.label&&x.label!=='unknown'), falseAlarms=labelled.filter(x=>['normal','cooking','sensor_noise','environmental_effect'].includes(x.label));return { total:safetyEvents.length,labelled:labelled.length,falseAlarmCount:falseAlarms.length,falseAlarmRate:labelled.length?round(falseAlarms.length/labelled.length*100):null }; },
    ingest(input) { const next = normalizeIncoming(input); if (!next) return false; const previous=state.readings.filter(item=>item.deviceId===next.deviceId&&item.sensorId===next.sensorId&&item.bootId===next.bootId&&Number.isInteger(item.sequence)).at(-1);if(previous&&next.sequence<=previous.sequence){state.lastIngestError={code:next.sequence===previous.sequence?'duplicate_sequence':'out_of_order_sequence',bootId:next.bootId,previousSequence:previous.sequence,receivedSequence:next.sequence};return false;}state.lastIngestError=null;recoverIntegrityFromValidReading(); state.readings.push(next); if (state.readings.length > 360) state.readings.shift(); syncLifecycle(this.analysis); persist(); return true; },
    tick() {
      if (state.paused) return this.analysis;
      state.initializing = false;
      const last = state.readings.at(-1).gas.value;
      const cfg = scenarios[state.scenario];
      const next = reading(0, cfg.next(last, state.index), { sequence:state.index++, system: cfg.system });
      this.ingest(next); if (state.readings.length > 180) state.readings.shift(); return this.analysis;
    }
  };
  window.GasGuardEngine = engine;
})();
