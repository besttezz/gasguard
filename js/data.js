(function () {
  'use strict';
  const now = Date.now();
  const TELEMETRY_SCHEMA_VERSION = 'gasguard.telemetry.v1.1';
  const configuredStaleMs = Number(window.GASGUARD_TELEMETRY_CONFIG?.TELEMETRY_STALE_MS);
  const TELEMETRY_STALE_MS = Number.isFinite(configuredStaleMs) && configuredStaleMs > 0 ? configuredStaleMs : 15000;
  const SENSOR_TYPES = Object.freeze(['MQ3', 'MQ6', 'SIMULATED']);
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round = (n, d = 0) => Number(n.toFixed(d));
  // Simulation inputs must replay predictably; this only replaces mock noise, never safety rules.
  const mockNoise = (index, amplitude) => ((Math.sin((index + 1) * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1 * amplitude;

  const contract = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION, deviceId: 'GG-KITCHEN-01', sensorId: 'LPG-01', sensorType:'SIMULATED', bootId:'simulation-boot-1', sequence:0, locationId: 'restaurant-a', zoneId: 'kitchen',
    gas: { value: 0, unit: 'ppm', rawValue: null, rawAdc: null, sensorVoltage: null, sensorResistance: null, rsR0: null, ppm:0, calculatedPpm: 0, correctedPpm: 0 },
    environment: { temperature: 0, humidity: 0, ventilationState: 'mechanical', fanState: 'on', doorState: 'open' },
    quality: { confidence: 0, warmupComplete: true, timeSinceBootSec: 0, continuousOperatingHours: 0, qualityFlags: [] },
    system: { valve: 'open', commandedValveState: 'open', actualValveState: 'open', valveResponseTimeMs: 620, valveFailedCommandCount: 0, valveCycleCount: 1248, connection: 'online', mqttConnectionState: 'connected', battery: 96, batteryVoltage: 4.08, inputVoltage: 5.02, powerSource: 'AC', backupActive: false, rssi: -58, latencyMs: 38, packetLossPct: 0.3, reconnectCount: 0, activity: 'active', operatingState: 'active', deviceUptimeSec: 152480, bootCount: 3, resetReason: 'power_on', firmwareVersion: 'prototype-v0.2' },
    timestamp: new Date().toISOString()
  };

  const telemetryContract = Object.freeze({
    schemaVersion:TELEMETRY_SCHEMA_VERSION,
    required:Object.freeze(['schemaVersion','deviceId','sensorId','sensorType','bootId','sequence','timestamp','gas.ppm']),
    optional:Object.freeze(['gas.rawAdc','gas.sensorVoltage','gas.rsR0','environment.temperature','environment.humidity','system.connection']),
    derived:Object.freeze(['receivedAt','clockSkewMs','gas.value','gas.calculatedPpm','gas.correctedPpm'])
  });
  const finiteOptional = (object, key, path, errors) => { if (object?.[key] != null && !Number.isFinite(object[key])) errors.push(`${path} must be a finite number`); };
  function validateTelemetry(input) {
    const errors=[];
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok:false, errors:['payload must be an object'], value:null };
    if (input.schemaVersion !== TELEMETRY_SCHEMA_VERSION) errors.push(`schemaVersion must be ${TELEMETRY_SCHEMA_VERSION}`);
    for (const key of ['deviceId','sensorId','bootId']) if (typeof input[key] !== 'string' || !input[key].trim()) errors.push(`${key} is required`);
    if (!SENSOR_TYPES.includes(input.sensorType)) errors.push('sensorType is not supported');
    if (!Number.isInteger(input.sequence) || input.sequence < 0) errors.push('sequence must be an integer >= 0');
    if (typeof input.timestamp !== 'string' || !input.timestamp.trim() || Number.isNaN(Date.parse(input.timestamp))) errors.push('timestamp must be parseable');
    if (!input.gas || typeof input.gas !== 'object' || !Number.isFinite(input.gas.ppm)) errors.push('gas.ppm must be a finite number');
    finiteOptional(input.gas,'rawAdc','gas.rawAdc',errors); finiteOptional(input.gas,'sensorVoltage','gas.sensorVoltage',errors); finiteOptional(input.gas,'rsR0','gas.rsR0',errors);
    finiteOptional(input.environment,'temperature','environment.temperature',errors); finiteOptional(input.environment,'humidity','environment.humidity',errors);
    if (input.system?.connection != null && !['online','offline','unknown'].includes(input.system.connection)) errors.push('system.connection is invalid');
    if (errors.length) return { ok:false, errors, value:null };
    return { ok:true, errors:[], value:{
      schemaVersion:input.schemaVersion, deviceId:input.deviceId.trim(), sensorId:input.sensorId.trim(), sensorType:input.sensorType, bootId:input.bootId.trim(), sequence:input.sequence, timestamp:input.timestamp,
      gas:{ rawAdc:input.gas.rawAdc ?? null, sensorVoltage:input.gas.sensorVoltage ?? null, rsR0:input.gas.rsR0 ?? null, ppm:input.gas.ppm },
      environment:{ temperature:input.environment?.temperature ?? 30, humidity:input.environment?.humidity ?? 65 },
      system:{ connection:input.system?.connection ?? 'online' }
    } };
  }

  function reading(minute, value, extra = {}) {
    const ppm=round(value), timestamp=extra.timestamp || new Date(Date.now() - minute * 60000).toISOString(), receivedAt=new Date().toISOString();
    return {
      ...contract,
      schemaVersion:TELEMETRY_SCHEMA_VERSION, sensorType:extra.sensorType || 'SIMULATED', bootId:extra.bootId || 'simulation-boot-1', sequence:extra.sequence ?? 0,
      gas: { ...contract.gas, ...(extra.gas || {}), value:ppm, ppm, calculatedPpm:ppm, correctedPpm:ppm },
      environment: { ...contract.environment, temperature: round(30.8 + Math.sin(minute / 17) * 1.1, 1), humidity: round(66 + Math.cos(minute / 22) * 4) },
      quality: { ...contract.quality, timeSinceBootSec: Math.max(0, 152480 - minute * 60), continuousOperatingHours: round((152480 - minute * 60) / 3600, 1) },
      system: { ...contract.system, ...extra.system }, timestamp, receivedAt, clockSkewMs:new Date(receivedAt).getTime()-new Date(timestamp).getTime()
    };
  }

  const history = Array.from({ length: 120 }, (_, i) => {
    const minute = 119 - i;
    const pattern = 92 + Math.sin(i / 9) * 9 + Math.cos(i / 19) * 6 + (i % 13 === 0 ? 5 : 0);
    return reading(minute, pattern, { sequence:i });
  });

  const dailyPattern = [
    ['00:00', 61, 63, 58, 60, 64, 70, 68], ['04:00', 55, 56, 54, 53, 57, 61, 59],
    ['08:00', 104, 116, 108, 112, 119, 135, 128], ['12:00', 151, 165, 158, 160, 172, 196, 188],
    ['16:00', 92, 98, 94, 96, 102, 118, 110], ['20:00', 128, 142, 133, 138, 146, 170, 159]
  ];

  const locations = [{ id:'LOC-001', name:'Restaurant A', type:'restaurant', status:'online', zones:[{id:'ZONE-KITCHEN',name:'Main Kitchen'},{id:'ZONE-STORAGE',name:'LPG Storage'}] }];
  const devices = [{ id:'GG-ESP32-001', name:'Kitchen Gateway', type:'ESP32', firmware:'prototype-v0.2', status:'online', uptime:152480, network:{rssi:-58,latency:38,packetLoss:.3}, power:{source:'AC',voltage:5.02,backupBattery:96} }];
  const sensors = [{ id:'LPG-001', deviceId:'GG-ESP32-001', zoneId:'ZONE-KITCHEN', name:'LPG Sensor A', type:'MQ-5', position:{x:9,y:5}, health:94, operatingHours:428, calibration:{status:'valid',lastCalibration:'2026-08-20',nextCalibration:'2026-11-20'} },{ id:'LPG-002', deviceId:'GG-ESP32-001', zoneId:'ZONE-KITCHEN', name:'LPG Sensor B', type:'MQ-5', position:{x:5,y:5}, health:92, operatingHours:415, calibration:{status:'valid',lastCalibration:'2026-08-20',nextCalibration:'2026-11-20'} },{ id:'LPG-003', deviceId:'GG-ESP32-001', zoneId:'ZONE-STORAGE', name:'Storage LPG Sensor', type:'MQ-5', position:{x:3,y:6}, health:90, operatingHours:421, calibration:{status:'valid',lastCalibration:'2026-08-20',nextCalibration:'2026-11-20'} }];

  const scenarios = {
    normal: { label: 'ทำงานตามปกติ', next(last, index) { return clamp(last + (mockNoise(index, 11) - 5.5) + Math.sin(index / 8) * 2, 66, 126); }, system: {} },
    transient: { label: 'ค่าสูงชั่วคราวขณะทำอาหาร', next(last, index) { const pulse=index%10<4?22:-18; return clamp(last+pulse+(mockNoise(index + 17, 8)-4),72,230); }, system: { valve: 'open', actualValveState: 'open', activity: 'active', operatingState: 'active' } },
    rise: { label: 'Slow leak · LPG เพิ่มต่อเนื่อง', next(last,index) { return clamp(last + 14 + mockNoise(index + 31, 9), 70, 730); }, system: { activity: 'inactive', operatingState: 'idle' } },
    critical: { label: 'Rapid leak · เหตุวิกฤต', next(last,index) { return clamp(last + 42 + mockNoise(index + 47, 25), 120, 980); }, system: { valve: 'closed', commandedValveState: 'closed', actualValveState: 'closed', activity: 'inactive', operatingState: 'idle' } },
    unknown: { label: 'Sensor failure · เซ็นเซอร์ขาดการเชื่อมต่อ', next(last) { return last; }, system: { connection: 'offline', mqttConnectionState: 'disconnected', valve: 'unknown', activity: 'unknown', operatingState: 'unknown' } },
    network: { label: 'Network failure · MQTT offline', next(last,index) { return clamp(last+(mockNoise(index + 59, 8)-4),66,140); }, system: { connection: 'offline', mqttConnectionState: 'disconnected', latencyMs: 0, packetLossPct: 100, reconnectCount: 4 } },
    valveFailure: { label: 'Valve failure · command ≠ feedback', next(last,index) { return clamp(last+18+mockNoise(index + 71, 12),80,790); }, system: { valve: 'open', commandedValveState: 'closed', actualValveState: 'open', valveFailedCommandCount: 1, valveResponseTimeMs: 0, activity: 'inactive', operatingState: 'idle' } },
    drift: { label: 'Sensor drift · baseline เปลี่ยน', next(last,index) { return clamp(last+3+mockNoise(index + 83, 5),90,450); }, system: { activity: 'idle', operatingState: 'idle' } }
  };

  function sensorFleet(primary) {
    return sensors.map((sensor,index) => {
      const mismatch = primary.system.commandedValveState === 'closed' && primary.system.actualValveState === 'open' && index === 1 ? 38 : 0;
      const spread = mismatch || (index === 2 ? -12 : index === 1 ? 7 : 0);
      return { sensorId:sensor.id, zoneId:sensor.zoneId, position:sensor.position, ppm:Math.max(0,round((primary.gas.correctedPpm ?? primary.gas.value)+spread)), online:primary.system.connection==='online', health:sensor.health };
    });
  }

  window.GasGuardData = { contract, telemetryContract, validateTelemetry, TELEMETRY_SCHEMA_VERSION, TELEMETRY_STALE_MS, SENSOR_TYPES, history, dailyPattern, locations, devices, sensors, sensorFleet, scenarios, reading, now };
})();
