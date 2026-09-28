// GasGuard cloud device API (Cloudflare Pages Functions runtime, also importable from Node tests).
//
//   POST /api/v1/device/telemetry  ESP32 → Supabase. Authenticated by the device credential
//                                  (x-device-key, 64 hex) checked with verify_device_credential,
//                                  then stored with ingest_telemetry. Uses the service-role key.
//   GET  /api/v1/device/status     Dashboard → latest device state. Requires the signed-in user's
//                                  Supabase access token, so RLS decides what they may see.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY (public vars) and SUPABASE_SERVICE_ROLE_KEY (secret).

export const WORKSPACE_DEVICES = Object.freeze({
  'hardware-pilot': 'ESP32-KITCHEN-01',
  'device-test': 'SIM-ESP32-KITCHEN-01'
});

export const STALE_MS = 30000;
const MAX_BODY_BYTES = 8192;
const CREDENTIAL_PATTERN = /^[0-9a-f]{64}$/i;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function deviceKeyFrom(headers) {
  const direct = headers.get('x-device-key');
  if (direct && direct.trim()) return direct.trim();
  const auth = headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function isServiceSecret(key) {
  if (typeof key !== 'string' || !key.trim()) return false;
  if (key.startsWith('sb_secret_')) return true;
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch (_) {
    return false;
  }
}

const finiteOrNull = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// Mirrors the firmware Raw Measurement contract (firmware/esp32-field-node/telemetry.cpp).
export function validatePacket(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, errors: ['payload must be a JSON object'] };
  if (typeof payload.deviceId !== 'string' || !ID_PATTERN.test(payload.deviceId)) errors.push('deviceId');
  if (typeof payload.sensorId !== 'string' || !ID_PATTERN.test(payload.sensorId)) errors.push('sensorId');
  if (!/^(MQ3|MQ6)$/i.test(String(payload.sensorType || ''))) errors.push('sensorType must be MQ3 or MQ6');
  if (typeof payload.bootId !== 'string' || !ID_PATTERN.test(payload.bootId)) errors.push('bootId');
  if (!Number.isInteger(payload.sequence) || payload.sequence < 0 || payload.sequence > 0xffffffff) errors.push('sequence');
  if (payload.raw !== undefined && (payload.raw === null || typeof payload.raw !== 'object' || Array.isArray(payload.raw))) errors.push('raw');
  const raw = payload.raw || {};
  if (raw.adc != null && (!Number.isInteger(raw.adc) || raw.adc < 0 || raw.adc > 4095)) errors.push('raw.adc must be 0-4095');
  if (raw.sensorVoltage != null && (typeof raw.sensorVoltage !== 'number' || raw.sensorVoltage < 0 || raw.sensorVoltage > 5)) errors.push('raw.sensorVoltage');
  if (payload.upstreamPpm != null && (typeof payload.upstreamPpm !== 'number' || payload.upstreamPpm < 0 || payload.upstreamPpm > 100000)) errors.push('upstreamPpm');
  return { ok: errors.length === 0, errors };
}

async function rpc(env, fetchImpl, name, body) {
  const response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`RPC ${name} failed with ${response.status}`);
  return response.json();
}

export async function handleTelemetry(request, env, fetchImpl = fetch) {
  if (!env?.SUPABASE_URL || !isServiceSecret(env?.SUPABASE_SERVICE_ROLE_KEY)) {
    return json(503, { ok: false, code: 'INGRESS_NOT_CONFIGURED' });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { ok: false, code: 'PAYLOAD_TOO_LARGE' });
  let payload;
  try { payload = JSON.parse(text); } catch (_) { return json(400, { ok: false, code: 'INVALID_JSON' }); }

  const validation = validatePacket(payload);
  if (!validation.ok) return json(422, { ok: false, code: 'INVALID_PAYLOAD', errors: validation.errors });

  const key = deviceKeyFrom(request.headers);
  if (!key || !CREDENTIAL_PATTERN.test(key)) return json(401, { ok: false, code: 'INVALID_DEVICE_CREDENTIAL' });

  let device;
  try {
    device = await rpc(env, fetchImpl, 'verify_device_credential', {
      p_device_uid: payload.deviceId,
      p_credential_hash: await sha256Hex(key.toLowerCase())
    });
  } catch (_) {
    return json(502, { ok: false, code: 'STORE_UNAVAILABLE' });
  }
  if (!device?.valid) return json(401, { ok: false, code: 'INVALID_DEVICE_CREDENTIAL' });
  if (device.device_uid !== payload.deviceId) return json(403, { ok: false, code: 'DEVICE_IDENTITY_MISMATCH' });

  const synthetic = String(request.headers.get('x-gasguard-data-classification') || '').toUpperCase() === 'SYNTHETIC_HANDSHAKE';
  const dataClassification = synthetic ? 'SYNTHETIC_HANDSHAKE' : device.device_uid.startsWith('SIM-') ? 'VIRTUAL_TEST_DATA' : 'DEVICE_DATA';
  const raw = payload.raw || {};
  const calibrated = String(raw.calibrationStatus || '').toUpperCase() === 'CALIBRATED';
  // Raw-only field packets carry no ppm; only calibrated or explicit test packets may report one.
  const gasPpm = calibrated || dataClassification !== 'DEVICE_DATA' ? finiteOrNull(payload.upstreamPpm) : null;

  const reading = {
    sensorId: payload.sensorId,
    sensorType: String(payload.sensorType).toUpperCase(),
    bootId: payload.bootId,
    sequence: payload.sequence,
    timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : null,
    raw: {
      adc: Number.isInteger(raw.adc) ? raw.adc : null,
      sensorVoltage: finiteOrNull(raw.sensorVoltage),
      inputAdjustedVoltage: finiteOrNull(raw.inputAdjustedVoltage),
      calibrationStatus: calibrated || gasPpm != null ? 'CALIBRATED' : 'CALIBRATION_REQUIRED'
    },
    environment: payload.environment && typeof payload.environment === 'object' ? {
      temperature: finiteOrNull(payload.environment.temperature),
      humidity: finiteOrNull(payload.environment.humidity)
    } : null,
    dataClassification,
    gasPpm
  };

  try {
    const result = await rpc(env, fetchImpl, 'ingest_telemetry', { p_device_uid: device.device_uid, p_reading: reading });
    // Duplicates are acknowledged with 202 so a retrying device advances its sequence.
    return json(202, { ok: true, code: result?.duplicate ? 'DUPLICATE' : 'INGESTED', dataClassification });
  } catch (_) {
    return json(502, { ok: false, code: 'STORE_UNAVAILABLE' });
  }
}

function waiting(workspaceId, deviceUid) {
  return {
    workspaceId, deviceId: deviceUid, status: 'WAITING_FOR_DEVICE', connection: 'WAITING_FOR_DEVICE',
    telemetry: 'NO DATA', safety: 'UNKNOWN', gasPpm: null, lastTelemetry: null, ingress: 'READY',
    packetStatus: 'NO DATA', sensors: [], latestMeasurement: null, latestMeasurementsBySensor: {}
  };
}

export async function handleStatus(request, env, fetchImpl = fetch, now = Date.now) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get('workspace') || 'hardware-pilot';
  const deviceUid = WORKSPACE_DEVICES[workspaceId];
  if (!deviceUid) return json(404, { ok: false, code: 'UNKNOWN_WORKSPACE' });
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) return json(503, { ok: false, code: 'STATUS_NOT_CONFIGURED' });

  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+$/i.test(auth)) return json(401, { ok: false, code: 'SIGN_IN_REQUIRED' });

  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  const headers = { apikey: env.SUPABASE_ANON_KEY, authorization: auth, accept: 'application/json' };
  const get = async path => {
    const response = await fetchImpl(`${base}/rest/v1/${path}`, { headers });
    if (response.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 });
    if (!response.ok) throw new Error(`status query failed with ${response.status}`);
    return response.json();
  };

  try {
    const devices = await get(`devices?select=id,device_uid,device_status(*)&device_uid=eq.${encodeURIComponent(deviceUid)}`);
    const device = devices[0];
    const state = Array.isArray(device?.device_status) ? device.device_status[0] : device?.device_status;
    if (!device || !state) return json(200, waiting(workspaceId, deviceUid));

    const readings = await get(`telemetry_readings?select=sensor_uid,sensor_type,raw_adc,sensor_voltage,input_adjusted_voltage,calibration_status,gas_ppm,received_at&device_id=eq.${device.id}&order=received_at.desc&limit=20`);
    const receivedAt = Date.parse(state.last_seen_at);
    const stale = !Number.isFinite(receivedAt) || now() - receivedAt > STALE_MS;
    const bySensor = {};
    for (const r of readings) {
      if (!r.sensor_uid || bySensor[r.sensor_uid]) continue;
      bySensor[r.sensor_uid] = {
        sensorId: r.sensor_uid, sensorType: r.sensor_type, rawAdc: r.raw_adc, sensorVoltage: r.sensor_voltage,
        inputAdjustedVoltage: r.input_adjusted_voltage, calibrationStatus: r.calibration_status,
        receivedAt: r.received_at, stale: now() - Date.parse(r.received_at) > STALE_MS
      };
    }
    const calibrationRequired = state.calibration_status === 'CALIBRATION_REQUIRED';
    return json(200, {
      workspaceId,
      deviceId: deviceUid,
      source: workspaceId === 'device-test' ? 'TEST_DEVICE' : 'REAL_DEVICE',
      dataClassification: state.data_classification,
      status: stale ? 'OFFLINE' : 'DEVICE_DATA',
      connection: stale ? 'OFFLINE' : 'ONLINE',
      telemetry: stale ? 'STALE' : calibrationRequired ? 'CALIBRATION_REQUIRED' : 'AVAILABLE',
      measurementStatus: calibrationRequired ? 'CALIBRATION_REQUIRED' : 'VALID_CALIBRATED',
      safety: stale || !state.safety ? 'UNKNOWN' : String(state.safety).toUpperCase(),
      gasPpm: stale ? null : (state.gas_ppm == null ? null : Number(state.gas_ppm)),
      lastTelemetry: state.last_seen_at,
      ingress: 'ACCEPTED',
      packetStatus: state.data_classification === 'SYNTHETIC_HANDSHAKE' ? 'SYNTHETIC HANDSHAKE ACCEPTED' : calibrationRequired ? 'CALIBRATION REQUIRED' : 'ACCEPTED',
      sensors: Object.keys(bySensor),
      latestMeasurement: stale ? null : (bySensor['MQ6-01'] || Object.values(bySensor)[0] || null),
      latestMeasurementsBySensor: stale ? {} : bySensor
    });
  } catch (error) {
    if (error.status === 401) return json(401, { ok: false, code: 'SIGN_IN_REQUIRED' });
    return json(502, { ok: false, code: 'STATUS_UNAVAILABLE' });
  }
}

export const methodNotAllowed = allow => new Response(null, { status: 405, headers: { allow } });
