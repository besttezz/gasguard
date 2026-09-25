(function (root, factory) {
  'use strict';
  const measurement = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = measurement;
  else root.GasGuardMeasurement = measurement;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';

  const RAW_SENSOR_TYPES = Object.freeze(['MQ3', 'MQ6']);
  const CALIBRATION_STATUS = 'CALIBRATION_NOT_CONFIGURED';
  const result = (ok, code, data = {}) => ({ ok, code, ...data });
  const nonEmpty = value => typeof value === 'string' && Boolean(value.trim());
  const checkFinite = (object, key, path, errors) => {
    if (object?.[key] != null && !Number.isFinite(object[key])) errors.push(`${path} must be a finite number`);
  };

  function validateRaw(input) {
    const errors=[];
    if (!input || typeof input !== 'object' || Array.isArray(input)) return result(false, 'INVALID_MEASUREMENT', { errors:['measurement must be an object'] });
    for (const key of ['deviceId','sensorId','bootId']) if (!nonEmpty(input[key])) errors.push(`${key} is required`);
    if (!RAW_SENSOR_TYPES.includes(input.sensorType)) errors.push('sensorType must be MQ3 or MQ6');
    if (!Number.isInteger(input.sequence) || input.sequence < 0) errors.push('sequence must be an integer >= 0');
    if (!nonEmpty(input.timestamp) || Number.isNaN(Date.parse(input.timestamp))) errors.push('timestamp must be parseable');
    if (!input.raw || typeof input.raw !== 'object' || Array.isArray(input.raw)) errors.push('raw must be an object');
    else { checkFinite(input.raw,'adc','raw.adc',errors); checkFinite(input.raw,'sensorVoltage','raw.sensorVoltage',errors); }
    if (input.upstreamPpm != null && !Number.isFinite(input.upstreamPpm)) errors.push('upstreamPpm must be a finite number');
    checkFinite(input.environment,'temperature','environment.temperature',errors);
    checkFinite(input.environment,'humidity','environment.humidity',errors);
    return errors.length ? result(false, 'INVALID_MEASUREMENT', { errors }) : result(true, 'VALID_RAW_MEASUREMENT', { value:input });
  }

  const adapter = sensorType => Object.freeze({
    sensorType,
    getCalibrationStatus() { return CALIBRATION_STATUS; },
    convertRawToPpm() { return result(false, 'NOT_IMPLEMENTED', { ppm:null, calibrationStatus:CALIBRATION_STATUS }); }
  });
  const adapters = Object.freeze({ MQ3:adapter('MQ3'), MQ6:adapter('MQ6') });

  function diagnostics(sensorType, conversionStatus, ppmSource) {
    return { sensorType, conversionStatus, ppmSource, calibrationStatus:adapters[sensorType]?.getCalibrationStatus() || CALIBRATION_STATUS };
  }

  function toTelemetry(input) {
    const validated=validateRaw(input);
    if(!validated.ok)return validated;
    const selected=adapters[input.sensorType];
    if(input.upstreamPpm == null)return result(false,'CALIBRATION_REQUIRED',{ telemetry:null, diagnostics:diagnostics(input.sensorType,'CALIBRATION_REQUIRED','NONE') });
    const data=root.GasGuardData;
    if(!data?.validateTelemetry)return result(false,'TELEMETRY_CONTRACT_UNAVAILABLE');
    const telemetry={
      schemaVersion:data.TELEMETRY_SCHEMA_VERSION,
      deviceId:input.deviceId.trim(), sensorId:input.sensorId.trim(), sensorType:selected.sensorType, bootId:input.bootId.trim(), sequence:input.sequence, timestamp:input.timestamp,
      gas:{ rawAdc:input.raw.adc ?? null, sensorVoltage:input.raw.sensorVoltage ?? null, rsR0:null, ppm:input.upstreamPpm },
      environment:{ temperature:input.environment?.temperature ?? 30, humidity:input.environment?.humidity ?? 65 },
      system:{ connection:'online' }
    };
    const contractCheck=data.validateTelemetry(telemetry);
    if(!contractCheck.ok)return result(false,'TELEMETRY_CONTRACT_REJECTED',{ errors:contractCheck.errors, telemetry:null });
    return result(true,'TELEMETRY_READY',{ telemetry, diagnostics:diagnostics(input.sensorType,'PASSTHROUGH','UPSTREAM') });
  }

  function ingest(input, engine = root.GasGuardEngine) {
    const converted=toTelemetry(input);
    if(!converted.ok)return converted;
    if(!engine?.ingest)return result(false,'ENGINE_UNAVAILABLE',{ telemetry:converted.telemetry, diagnostics:converted.diagnostics });
    const accepted=engine.ingest(converted.telemetry);
    return accepted ? result(true,'INGESTED',{ telemetry:converted.telemetry, diagnostics:converted.diagnostics }) : result(false,'ENGINE_REJECTED',{ telemetry:converted.telemetry, diagnostics:converted.diagnostics, engineError:engine.state?.lastIngestError || null });
  }

  return Object.freeze({ RAW_SENSOR_TYPES, CALIBRATION_STATUS, adapters, validateRaw, toTelemetry, ingest });
});
