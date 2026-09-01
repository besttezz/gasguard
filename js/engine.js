(function () {
  'use strict';
  const { history, scenarios, reading, contract, sensorFleet } = window.GasGuardData;
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
  const storage = typeof localStorage === 'undefined' ? null : localStorage;
  function load() { try { return JSON.parse(storage && storage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  const saved = load();
  const state = { scenario: saved.scenario || 'normal', paused: false, readings: Array.isArray(saved.readings) && saved.readings.length ? saved.readings : history.slice(), events: Array.isArray(saved.events) && saved.events.length ? saved.events : [{ id:'evt-system-start', type: 'system', title: 'เริ่ม Data Analysis Engine', detail: 'Mock provider เชื่อมต่อกับ Feature Engine แล้ว', status:'resolved', label:'maintenance', labelSource:'system', labelConfidence:'confirmed', t: Date.now() - 8 * 60000 }], index: history.length, source: saved.source || { mode: 'simulation', restUrl: '', mqttUrl: '', topic: 'gasguard/+/reading' } };
  state.events = state.events.map((event,index) => ({ id:event.id || `legacy-event-${index}-${event.t||Date.now()}`, status:event.status || 'open', label:event.label || 'unknown', labelSource:event.labelSource || null, labelConfidence:event.labelConfidence || 'low', ...event }));
  function persist() { try { if (storage) storage.setItem(STORE_KEY, JSON.stringify({ scenario: state.scenario, readings: state.readings.slice(-360), events: state.events.slice(0, 80), source: state.source })); } catch (e) {} }

  function feature(readings) {
    const current = readings.at(-1);
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
    return { current, rawGas: round(current.gas.calculatedPpm ?? current.gas.value), correctedGas: round(currentCorrected), compensation: { temperature: round((current.environment.temperature - 30) * .003, 4), humidity: round((current.environment.humidity - 65) * .0015, 4), formulaVersion: 'prototype-comp-v0.1' }, baseline: round(baseline), rate: round(rate * 0.5, 1), variance: round(variance, 1), exposure: round(exposure), confidence: round(confidence), anomaly: round(anomaly), risk: risk == null ? null : round(risk), safety, z: round(z, 2), drift: round(drift, 1), sensorHealth: round(sensorHealth), valveMismatch, classification, features:{rates:{rate5s,rate30s,rate1m,rate5m},movingAverages:{avg1m:round(avg1m),avg5m:round(avg5m),avg15m:round(avg15m),avg1h:round(avg1h)},stability:{std1m:round(std(oneMinute),2),std5m:round(std(fiveMinute),2),std1h:round(std(oneHour),2)},eventShape:{peakValue:round(peak),peakDurationSec,recoveryRate,timeAboveBaselineSec:readings.slice(-30).filter(r=>correctedPpm(r)>baseline).length*2,areaUnderCurve:round(exposure)},fusion:{sensors:fleet,mean:round(fusionMean),spread:round(fusionSpread),confidence:fusionConfidence}},reliability:{valveHealth,connectivityHealth,batteryHealth} };
  }

  function describe(f) {
    if (f.safety === 'unknown') return { title: 'สถานะความปลอดภัยไม่ทราบ', text: 'ไม่มีข้อมูลใหม่จากเซ็นเซอร์ จึงไม่สามารถยืนยันความปลอดภัยของพื้นที่ได้', action: 'ตรวจสอบการเชื่อมต่อของอุปกรณ์และสถานะไฟเลี้ยงก่อนตัดสินใจด้านความปลอดภัย' };
    if (f.safety === 'critical') return { title: 'ตรวจพบความเสี่ยงสูง', text: `LPG เพิ่ม ${f.rate > 0 ? 'อย่างรวดเร็ว' : 'สูงกว่าปกติ'} จาก baseline ${f.baseline} ppm และมี anomaly score ${f.anomaly}`, action: 'ตรวจพื้นที่ทันที, ตรวจวาล์วและระบบระบายอากาศ, ยืนยันค่าเซ็นเซอร์ก่อนการดำเนินการอัตโนมัติ' };
    if (f.safety === 'attention') return { title: 'พบรูปแบบที่ต้องเฝ้าระวัง', text: `ค่าปัจจุบันต่างจาก baseline และอัตราการเพิ่มอยู่ที่ ${f.rate} ppm/min`, action: 'ติดตามแนวโน้มอย่างใกล้ชิด และตรวจสอบบริบทการใช้งานครัว' };
    return { title: 'รูปแบบการใช้งานอยู่ในเกณฑ์คาดหมาย', text: `ค่า LPG ยังคงใกล้ baseline ${f.baseline} ppm, ไม่มีการเพิ่มขึ้นผิดปกติ`, action: 'เฝ้าระวังต่อเนื่องตามรอบการทำงานปกติ' };
  }

  function eventFor(f, prev) {
    if (!prev || f.safety === prev) return;
    const labels = { safe: ['system', 'กลับสู่รูปแบบปกติ'], attention: ['warning', 'พบแนวโน้ม LPG ผิดปกติ'], critical: ['critical', 'ความเสี่ยง LPG ระดับสูง'], unknown: ['warning', 'ไม่สามารถตรวจติดตามเซ็นเซอร์ได้'] };
    const [type, title] = labels[f.safety];
    state.events.unshift({ id:`evt-${Date.now()}`, type, title, detail: f.safety === 'unknown' ? 'Sensor connection offline, safety state is unknown' : `Risk ${f.risk}/100 · Anomaly ${f.anomaly}/100 · LPG ${f.correctedGas} ppm`, status:'open', label:'unknown', labelSource:null, labelConfidence:'low', triggerReason:f.classification, t: Date.now() });
    state.events = state.events.slice(0, 40);
  }

  function normalizeIncoming(input) {
    const last = state.readings.at(-1) || contract;
    const gas = input && input.gas ? input.gas.value : (input && (input.ppm ?? input.value ?? input.reading));
    if (gas == null || Number.isNaN(Number(gas))) return null;
    const environment = input.environment || {};
    const system = input.system || {};
    return {
      ...last, ...input,
      gas: { ...last.gas, ...(input.gas || {}), value: Math.max(0, Math.round(Number(gas))), rawValue: Number(input.rawValue ?? input.raw_value ?? gas) },
      environment: { ...last.environment, ...environment, temperature: Number(environment.temperature ?? input.temperature ?? input.temp ?? last.environment.temperature), humidity: Number(environment.humidity ?? input.humidity ?? input.hum ?? last.environment.humidity) },
      quality: { ...(last.quality || {}), ...(input.quality || {}) },
      system: { ...last.system, ...system, connection: system.connection || 'online' },
      timestamp: input.timestamp || input.t || new Date().toISOString()
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
    get analysis() { return feature(state.readings); },
    get explanation() { return describe(this.analysis); },
    setScenario(s) { state.scenario = s; state.events.unshift({ type: 'system', title: 'เปลี่ยนสถานการณ์จำลอง', detail: scenarios[s].label, t: Date.now() }); persist(); },
    togglePause() { state.paused = !state.paused; },
    clearEvents() { state.events = [{ id:`evt-${Date.now()}`, type: 'system', title: 'เริ่ม Event Timeline ใหม่', detail: 'ล้างเฉพาะเหตุการณ์ที่สร้างจากการจำลอง', status:'resolved', label:'maintenance', labelSource:'system', labelConfidence:'confirmed', t: Date.now() }]; persist(); },
    saveSource(source) { state.source = { ...state.source, ...source }; persist(); },
    exportData() { return JSON.stringify({ version: 'draft-1', exportedAt: new Date().toISOString(), readings: state.readings, events: state.events, source: state.source }, null, 2); },
    get validation() { return validationCases.map(validateCase); },
    runValidation() { const results=this.validation; return { ranAt:new Date().toISOString(), results, passed:results.filter(x=>x.pass).length, total:results.length }; },
    runFailSafeDrill() { return { ranAt:new Date().toISOString(), checks:failSafeChecks() }; },
    incidentEvidence() { const f=this.analysis; return { schemaVersion:'gasguard-incident-evidence-v0.1', generatedAt:new Date().toISOString(), scope:'Prototype analytics evidence. Not a certified safety record or actuator command.', currentReading:f.current, analysis:{ baseline:f.baseline, ratePpmPerMinute:f.rate, exposurePpmMinute:f.exposure, anomalyScore:f.anomaly, riskScore:f.risk, safetyState:f.safety, confidence:f.confidence, classification:f.classification }, explanation:this.explanation, recentEvents:state.events.slice(0,10), source:{ mode:state.source.mode, providerBoundary:'Web data layer only. Edge safety controller validation required.' } }; },
    labelEvent(eventId, label, source='engineer', confidence='medium') { const event=state.events.find(x=>x.id===eventId); if(!event)return false; event.label=label;event.labelSource=source;event.labelConfidence=confidence;event.status=label==='unknown'?'open':'resolved';persist();return true; },
    get alarmQuality() { const safetyEvents=state.events.filter(x=>x.type==='warning'||x.type==='critical'), labelled=safetyEvents.filter(x=>x.label&&x.label!=='unknown'), falseAlarms=labelled.filter(x=>['normal','cooking','sensor_noise','environmental_effect'].includes(x.label));return { total:safetyEvents.length,labelled:labelled.length,falseAlarmCount:falseAlarms.length,falseAlarmRate:labelled.length?round(falseAlarms.length/labelled.length*100):null }; },
    ingest(input) { const prev = this.analysis.safety, next = normalizeIncoming(input); if (!next) return false; state.readings.push(next); if (state.readings.length > 360) state.readings.shift(); const analysis = this.analysis; eventFor(analysis, prev); persist(); return true; },
    tick() {
      if (state.paused) return this.analysis;
      const prev = this.analysis.safety;
      const last = state.readings.at(-1).gas.value;
      const cfg = scenarios[state.scenario];
      const next = reading(0, cfg.next(last, state.index++), { system: cfg.system });
      state.readings.push(next); if (state.readings.length > 180) state.readings.shift();
      const nextAnalysis = this.analysis; eventFor(nextAnalysis, prev); persist(); return nextAnalysis;
    }
  };
  window.GasGuardEngine = engine;
})();
