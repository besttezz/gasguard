(function (root, factory) {
  'use strict';
  const lab = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = lab;
  else root.GasGuardHardwareLab = lab;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const sampleDefinitions = Object.freeze({
    mq6_upstream: { label:'MQ6 upstream ppm', payload:{ deviceId:'ESP32-LAB-01', sensorId:'MQ6-LAB-01', sensorType:'MQ6', bootId:'boot-demo-1', sequence:1, raw:{adc:1830,sensorVoltage:1.47}, upstreamPpm:164, environment:{temperature:30,humidity:64} } },
    mq3_upstream: { label:'MQ3 upstream ppm', payload:{ deviceId:'ESP32-LAB-02', sensorId:'MQ3-LAB-01', sensorType:'MQ3', bootId:'boot-demo-1', sequence:1, raw:{adc:1310,sensorVoltage:1.06}, upstreamPpm:72, environment:{temperature:29,humidity:61} } },
    mq6_raw: { label:'MQ6 raw only', payload:{ deviceId:'ESP32-LAB-03', sensorId:'MQ6-LAB-02', sensorType:'MQ6', bootId:'boot-demo-1', sequence:1, raw:{adc:2010,sensorVoltage:1.62}, environment:{temperature:31,humidity:66} } },
    missing_device: { label:'Missing deviceId', payload:{ sensorId:'MQ6-LAB-03', sensorType:'MQ6', bootId:'boot-demo-1', sequence:1, raw:{adc:1740}, upstreamPpm:142 } },
    duplicate: { label:'Duplicate sequence', payload:{ deviceId:'ESP32-LAB-01', sensorId:'MQ6-LAB-01', sensorType:'MQ6', bootId:'boot-demo-1', sequence:1, raw:{adc:1830,sensorVoltage:1.47}, upstreamPpm:164 } },
    reboot: { label:'New bootId, sequence reset', payload:{ deviceId:'ESP32-LAB-01', sensorId:'MQ6-LAB-01', sensorType:'MQ6', bootId:'boot-demo-2', sequence:0, raw:{adc:1810,sensorVoltage:1.46}, upstreamPpm:160 } }
  });
  const clone = value => JSON.parse(JSON.stringify(value));
  const identity = payload => ({ sensorType:payload?.sensorType ?? null, deviceId:payload?.deviceId ?? null, sensorId:payload?.sensorId ?? null, bootId:payload?.bootId ?? null, sequence:payload?.sequence ?? null });
  const parse = text => { try { const payload=JSON.parse(text); return {ok:true,payload}; } catch(error) { return {ok:false,code:'INVALID_JSON',errors:[error.message]}; } };
  const decorate = (result,payload) => ({ ...result, identity:identity(payload), diagnostics:{ ...identity(payload), ...(result.diagnostics || {}) }, errors:result.errors || [] });

  function samplePayload(id) {
    const selected=sampleDefinitions[id] || sampleDefinitions.mq6_upstream;
    return { ...clone(selected.payload), timestamp:new Date().toISOString() };
  }
  function validateOnly(text, measurement=root.GasGuardMeasurement) {
    const parsed=parse(text);
    if(!parsed.ok)return decorate(parsed,null);
    if(!measurement?.toTelemetry)return decorate({ok:false,code:'MEASUREMENT_LAYER_UNAVAILABLE'},parsed.payload);
    return decorate(measurement.toTelemetry(parsed.payload),parsed.payload);
  }
  function validateAndIngest(text, measurement=root.GasGuardMeasurement, engine=root.GasGuardEngine) {
    const parsed=parse(text);
    if(!parsed.ok)return decorate(parsed,null);
    if(!measurement?.ingest)return decorate({ok:false,code:'MEASUREMENT_LAYER_UNAVAILABLE'},parsed.payload);
    const result=decorate(measurement.ingest(parsed.payload,engine),parsed.payload);
    if(!result.ok)return result;
    const analysis=engine.analysis, current=analysis.current;
    return { ...result, accepted:true, timing:{timestamp:current.timestamp,receivedAt:current.receivedAt,clockSkewMs:current.clockSkewMs,sequence:current.sequence,bootId:current.bootId}, engineAnalysis:{gasPpm:current.gas.ppm ?? current.gas.value,connection:current.system.connection,safety:analysis.safety,risk:analysis.risk} };
  }
  return Object.freeze({ sampleDefinitions, samplePayload, validateOnly, validateAndIngest });
});
