'use strict';

const crypto = require('node:crypto');

const response = (status, body) => ({ status, body });
const header = (headers, name) => headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
const suppliedKey = headers => header(headers, 'x-device-key') || String(header(headers, 'authorization') || '').replace(/^Bearer\s+/i, '') || null;
const equalSecret = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

function createDeviceIngress({ registry, credentials = {}, pipelines, authManager = null, staleMs = 15000, now = Date.now }) {
  const packetState = new Map();
  const knownSensors = new Map();
  const latestMeasurementsBySensorMap = new Map();

  const keyOwner = key => Object.entries(credentials || {}).find(([, candidate]) => equalSecret(key, candidate))?.[0] || null;

  function status(workspaceId) {
    const packet = packetState.get(workspaceId);
    const sensors = Array.from(knownSensors.get(workspaceId) || []);
    const sensorMap = latestMeasurementsBySensorMap.get(workspaceId);

    let latestMeasurementsBySensor = {};
    let latestMeasurement = null;

    if (sensorMap) {
      const formattedMap = {};
      for (const [sId, m] of sensorMap.entries()) {
        const isStale = now() - m.receivedAtMs > staleMs;
        formattedMap[sId] = Object.freeze({
          sensorId: m.sensorId,
          sensorType: m.sensorType,
          rawAdc: m.rawAdc,
          sensorVoltage: m.sensorVoltage,
          inputAdjustedVoltage: m.inputAdjustedVoltage,
          calibrationStatus: m.calibrationStatus,
          receivedAt: new Date(m.receivedAtMs).toISOString(),
          stale: isStale
        });
      }
      latestMeasurementsBySensor = Object.freeze(formattedMap);
      latestMeasurement = formattedMap['MQ6-01'] || Object.values(formattedMap)[0] || null;
    }

    if (!packet) return { workspaceId, status: 'WAITING_FOR_DEVICE', connection: 'WAITING_FOR_DEVICE', telemetry: 'NO DATA', safety: 'UNKNOWN', gasPpm: null, lastTelemetry: null, ingress: 'READY', packetStatus: 'NO DATA', sensors, latestMeasurement, latestMeasurementsBySensor };
    const stale = now() - packet.receivedAtMs > staleMs;
    return {
      ...packet.public,
      status: stale ? 'OFFLINE' : 'DEVICE_DATA',
      connection: stale ? 'OFFLINE' : 'ONLINE',
      telemetry: stale ? 'STALE' : (packet.public.measurementStatus === 'CALIBRATION_REQUIRED' ? 'CALIBRATION_REQUIRED' : 'AVAILABLE'),
      safety: stale ? 'UNKNOWN' : packet.public.safety,
      gasPpm: stale ? null : packet.public.gasPpm,
      lastTelemetry: new Date(packet.receivedAtMs).toISOString(),
      sensors,
      latestMeasurement: stale ? null : latestMeasurement,
      latestMeasurementsBySensor: stale ? {} : latestMeasurementsBySensor
    };
  }

  function processIngestion(device, headers, payload) {
    const pipeline = pipelines[device.workspaceId];
    if (!pipeline?.measurement?.ingest || !pipeline?.engine) return response(503, { ok: false, code: 'PIPELINE_UNAVAILABLE' });

    const result = pipeline.measurement.ingest(payload, pipeline.engine);

    // Handle Raw-only uncalibrated measurement input (CALIBRATION_REQUIRED)
    if (!result.ok && result.code === 'CALIBRATION_REQUIRED') {
      const rawValidation = pipeline.measurement.validateRaw(payload);
      if (!rawValidation.ok) {
        return response(422, { ok: false, code: rawValidation.code, errors: rawValidation.errors, workspaceId: device.workspaceId, source: device.source });
      }

      const receivedAtMs = now();
      if (!knownSensors.has(device.workspaceId)) knownSensors.set(device.workspaceId, new Set());
      if (payload.sensorId) knownSensors.get(device.workspaceId).add(payload.sensorId);

      if (payload.raw && typeof payload.raw === 'object') {
        if (!latestMeasurementsBySensorMap.has(device.workspaceId)) {
          latestMeasurementsBySensorMap.set(device.workspaceId, new Map());
        }
        const sensorId = payload.sensorId || 'MQ6-01';
        latestMeasurementsBySensorMap.get(device.workspaceId).set(sensorId, Object.freeze({
          sensorId,
          sensorType: payload.sensorType || 'MQ6',
          rawAdc: payload.raw.adc ?? null,
          sensorVoltage: payload.raw.sensorVoltage ?? null,
          inputAdjustedVoltage: payload.raw.inputAdjustedVoltage ?? null,
          calibrationStatus: payload.raw.calibrationStatus ?? 'CALIBRATION_REQUIRED',
          receivedAtMs
        }));
      }

      const scenario = device.source === 'TEST_DEVICE' ? String(header(headers, 'x-test-scenario') || 'UNSPECIFIED').toUpperCase() : null;
      const requestedClassification = String(header(headers, 'x-gasguard-data-classification') || '').toUpperCase();
      const dataClassification = requestedClassification === 'SYNTHETIC_HANDSHAKE' ? 'SYNTHETIC_HANDSHAKE' : (device.source === 'TEST_DEVICE' ? 'VIRTUAL_TEST_DATA' : 'DEVICE_DATA');

      const publicState = {
        workspaceId: device.workspaceId,
        deviceId: device.deviceId,
        source: device.source,
        scenario,
        dataClassification,
        ingress: 'ACCEPTED',
        packetStatus: 'CALIBRATION REQUIRED',
        measurementStatus: 'CALIBRATION_REQUIRED',
        safety: 'UNKNOWN',
        gasPpm: null
      };

      packetState.set(device.workspaceId, { receivedAtMs, public: publicState });
      return response(202, { ok: true, code: 'CALIBRATION_REQUIRED', ...status(device.workspaceId) });
    }

    if (!result.ok) {
      return response(result.code === 'ENGINE_REJECTED' ? 409 : 422, { ok: false, code: result.code, errors: result.errors || result.engineError || null, workspaceId: device.workspaceId, source: device.source });
    }

    // ACCEPTED CALIBRATED / UPSTREAM TELEMETRY
    const analysis = pipeline.engine.analysis, receivedAtMs = now();
    if (!knownSensors.has(device.workspaceId)) knownSensors.set(device.workspaceId, new Set());
    if (payload.sensorId) knownSensors.get(device.workspaceId).add(payload.sensorId);

    if (payload.raw && typeof payload.raw === 'object') {
      if (!latestMeasurementsBySensorMap.has(device.workspaceId)) {
        latestMeasurementsBySensorMap.set(device.workspaceId, new Map());
      }
      const sensorId = payload.sensorId || 'MQ6-01';
      latestMeasurementsBySensorMap.get(device.workspaceId).set(sensorId, Object.freeze({
        sensorId,
        sensorType: payload.sensorType || 'MQ6',
        rawAdc: payload.raw.adc ?? null,
        sensorVoltage: payload.raw.sensorVoltage ?? null,
        inputAdjustedVoltage: payload.raw.inputAdjustedVoltage ?? null,
        calibrationStatus: payload.raw.calibrationStatus ?? 'CALIBRATED',
        receivedAtMs
      }));
    }

    const scenario = device.source === 'TEST_DEVICE' ? String(header(headers, 'x-test-scenario') || 'UNSPECIFIED').toUpperCase() : null;
    const requestedClassification = String(header(headers, 'x-gasguard-data-classification') || '').toUpperCase();
    const dataClassification = requestedClassification === 'SYNTHETIC_HANDSHAKE' ? 'SYNTHETIC_HANDSHAKE' : (device.source === 'TEST_DEVICE' ? 'VIRTUAL_TEST_DATA' : 'DEVICE_DATA');

    const publicState = {
      workspaceId: device.workspaceId,
      deviceId: device.deviceId,
      source: device.source,
      scenario,
      dataClassification,
      ingress: 'ACCEPTED',
      packetStatus: dataClassification === 'SYNTHETIC_HANDSHAKE' ? 'SYNTHETIC HANDSHAKE ACCEPTED' : 'ACCEPTED',
      measurementStatus: 'VALID_CALIBRATED',
      safety: analysis.safety,
      gasPpm: analysis.current.gas.ppm ?? analysis.current.gas.value
    };

    packetState.set(device.workspaceId, { receivedAtMs, public: publicState });
    return response(202, { ok: true, code: 'INGESTED', ...status(device.workspaceId) });
  }

  function ingest({ headers = {}, payload }) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return response(400, { ok: false, code: 'INVALID_PAYLOAD' });
    const payloadDeviceId = payload.deviceId || payload.deviceUid;
    const key = suppliedKey(headers);

    if (authManager && typeof authManager.authenticateIngressRequest === 'function') {
      return (async () => {
        const authRes = await authManager.authenticateIngressRequest({
          deviceUid: payloadDeviceId,
          payloadDeviceId,
          xDeviceKey: key
        });

        if (!authRes || !authRes.authenticated) {
          const statusCode = authRes?.code === 'DEVICE_IDENTITY_MISMATCH' || authRes?.code === 'WORKSPACE_OVERRIDE_FORBIDDEN' ? 403 : 401;
          return response(statusCode, { ok: false, code: authRes?.code || 'INVALID_DEVICE_KEY' });
        }

        const device = {
          deviceId: authRes.deviceId || authRes.deviceUid,
          deviceUid: authRes.deviceUid,
          siteId: authRes.siteId,
          zoneId: authRes.zoneId,
          deviceType: authRes.deviceType || 'gateway',
          lifecycleStatus: authRes.lifecycleStatus,
          workspaceId: authRes.workspaceId,
          source: authRes.source
        };

        return processIngestion(device, headers, payload);
      })();
    }

    const resolved = registry.resolve(payloadDeviceId);
    if (!resolved) return response(401, { ok: false, code: 'UNKNOWN_DEVICE' });
    const owner = keyOwner(key);
    if (!owner) return response(401, { ok: false, code: 'INVALID_DEVICE_KEY' });
    if (owner !== resolved.deviceId) return response(403, { ok: false, code: 'DEVICE_KEY_MISMATCH' });

    return processIngestion(resolved, headers, payload);
  }

  return Object.freeze({ ingest, status });
}

module.exports = Object.freeze({ createDeviceIngress });
