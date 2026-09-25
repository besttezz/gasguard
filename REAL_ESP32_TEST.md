# Real ESP32 WiFi Test

## 1. Start the local ingress

PowerShell example (replace the placeholder with a temporary device key; do not commit it):

```powershell
$env:GASGUARD_REAL_DEVICE_KEY='<SET_TEMPORARY_DEVICE_KEY>'
$env:GASGUARD_HOST='0.0.0.0'
$env:GASGUARD_PORT='5567'
npm run dev
```

The safe default without `GASGUARD_HOST` is `127.0.0.1`, which is not reachable from the ESP32. LAN mode listens on all local interfaces; allow the port only on the trusted/private WiFi network if the OS firewall asks.

Run `ipconfig`, find the IPv4 address under the active Wi-Fi adapter, then use:

`http://<COMPUTER_LAN_IPV4>:5567/api/v1/device/telemetry`

Check reachability from another device on the same WiFi with `GET http://<COMPUTER_LAN_IPV4>:5567/api/v1/health`. It returns ingress and sanitized workspace status, never device credentials.

## 2. ESP32 request contract

- Method/path: `POST /api/v1/device/telemetry`
- Headers: `Content-Type: application/json`, `x-device-key: <DEVICE_KEY>`
- Device identity: `ESP32-KITCHEN-01`
- Workspace is resolved by the trusted registry; do not send or trust `workspaceId`.

MQ3 payload template:

```json
{"deviceId":"ESP32-KITCHEN-01","sensorId":"MQ3-01","sensorType":"MQ3","bootId":"<BOOT_SESSION_ID>","sequence":0,"timestamp":"<ISO_8601_MEASUREMENT_TIME>","raw":{"adc":"<ADC_FROM_ESP32>","sensorVoltage":"<VOLTAGE_FROM_ESP32>"},"environment":{"temperature":"<MEASURED_C>","humidity":"<MEASURED_PERCENT>"}}
```

MQ6 uses the same shape with `sensorId: "MQ6-01"` and `sensorType: "MQ6"`.

These are templates, not copy-paste test telemetry. Replace every placeholder with a real reading. Raw-only input is expected to return HTTP 422 `CALIBRATION_REQUIRED`; no ppm is fabricated. HTTP 202 `INGESTED` requires `upstreamPpm` produced by the device's legitimate configured conversion path.

## 3. Expected results

- HTTP 202: authenticated and ingested
- HTTP 401: missing/invalid key or unknown device
- HTTP 403: key belongs to a different device
- HTTP 400/422: malformed JSON or invalid/raw-only measurement
- HTTP 409: duplicate or out-of-order sequence

Open `http://<COMPUTER_LAN_IPV4>:5567/?workspace=hardware-pilot` and sign in with an authorized developer account. Before valid telemetry it remains `WAITING_FOR_DEVICE / UNKNOWN / N/A`; after HTTP 202 it shows receiving status and last telemetry time.
