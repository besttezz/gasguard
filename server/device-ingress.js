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

function createDeviceIngress({ registry, credentials, pipelines, staleMs = 15000, now = Date.now }) {
  const packetState = new Map();
  const knownSensors = new Map();

  const keyOwner = key => Object.entries(credentials).find(([, candidate]) => equalSecret(key, candidate))?.[0] || null;

  function status(workspaceId) {
    const packet = packetState.get(workspaceId);
    const sensors = Array.from(knownSensors.get(workspaceId) || []);
    if (!packet) return { workspaceId, status: 'WAITING_FOR_DEVICE', connection: 'WAITING_FOR_DEVICE', telemetry: 'NO DATA', safety: 'UNKNOWN', gasPpm: null, lastTelemetry: null, ingress: 'READY', packetStatus: 'NO DATA', sensors };
    const stale = now() - packet.receivedAtMs > staleMs;
    return {
      ...packet.public,
      status: stale ? 'OFFLINE' : 'DEVICE_DATA',
      connection: stale ? 'OFFLINE' : 'ONLINE',
      telemetry: stale ? 'STALE' : (packet.public.measurementStatus === 'CALIBRATION_REQUIRED' ? 'CALIBRATION_REQUIRED' : 'AVAILABLE'),
      safety: stale ? 'UNKNOWN' : packet.public.safety,
      gasPpm: stale ? null : packet.public.gasPpm,
      lastTelemetry: new Date(packet.receivedAtMs).toISOString(),
      sensors
    };
  }

  function ingest({ headers = {}, payload }) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return response(400, { ok: false, code: 'INVALID_PAYLOAD' });
    const device = registry.resolve(payload.deviceId);
    if (!device) return response(401, { ok: false, code: 'UNKNOWN_DEVICE' });
    const key = suppliedKey(headers), owner = keyOwner(key);
    if (!owner) return response(401, { ok: false, code: 'INVALID_DEVICE_KEY' });
    if (owner !== device.deviceId) return response(403, { ok: false, code: 'DEVICE_KEY_MISMATCH' });
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

    // Calibrated / Upstream Telemetry Ingested
    const analysis = pipeline.engine.analysis, receivedAtMs = now();
    if (!knownSensors.has(device.workspaceId)) knownSensors.set(device.workspaceId, new Set());
    if (payload.sensorId) knownSensors.get(device.workspaceId).add(payload.sensorId);

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

  return Object.freeze({ ingest, status });
}

module.exports = Object.freeze({ createDeviceIngress });
