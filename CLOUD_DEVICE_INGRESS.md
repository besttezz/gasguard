# Cloud device ingress (ESP32 anywhere → gasguard-bu.pages.dev → Supabase)

Remote ESP32 boards post to the website instead of a computer on the same WiFi. No computer has to stay on.

```
ESP32 ──HTTPS──▶ /api/v1/device/telemetry (Pages Function) ──service key──▶ Supabase ingest_telemetry
Dashboard (?workspace=hardware-pilot) ──user token──▶ /api/v1/device/status ──RLS──▶ device_status
```

Code: `cloud/device-api.mjs` (logic), `functions/api/v1/device/*.js` (routes), `wrangler.toml` (public vars). Tests: `tests/cloud-device-api.test.js`.

## One-time setup (software owner)

1. **Service key secret** (Supabase → Project Settings → API Keys → Secret key, `sb_secret_…`). Paste when prompted; it is stored encrypted in Cloudflare, never in the repo:
   ```
   npx.cmd wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name gasguard-bu
   ```
   Then redeploy once: `npm run deploy`. Until this is set the endpoint answers `503 INGRESS_NOT_CONFIGURED`.
2. **Device key** for each board (`ESP32-KITCHEN-01` real board, `SIM-ESP32-KITCHEN-01` virtual board):
   ```
   node tools/new-device-key.js ESP32-KITCHEN-01
   ```
   Run the printed SQL in Supabase → SQL Editor. Send the printed 64-hex key to the board owner privately. Running it again revokes the old key.

## Test without hardware

```
$env:GASGUARD_BASE_URL='https://gasguard-bu.pages.dev'
$env:GASGUARD_TEST_DEVICE_KEY='<key for SIM-ESP32-KITCHEN-01>'
npm run virtual:esp32 -- NORMAL
```
Expect `"status": 202`. Then sign in and open `https://gasguard-bu.pages.dev/?workspace=device-test`.

## Board owner (hardware)

1. Copy `firmware/esp32-handshake/secrets.example.h` → `secrets.h`; set WiFi name/password and the device key. The URL already points to the website.
2. Flash `esp32-handshake.ino`, open Serial Monitor at 115200. `HTTP=202` means the packet is stored.
3. For real MQ-6 values, wire the sensor to an ADC1 pin (GPIO 32–39) through a voltage divider and uncomment `GASGUARD_MQ6_ADC_PIN`. Packets are stored as raw ADC/voltage with `CALIBRATION_REQUIRED` (no ppm until calibration exists).

Watch the result at `https://gasguard-bu.pages.dev/?workspace=hardware-pilot` (signed in). The board shows ONLINE while packets arrive and OFFLINE after 30 s of silence.

## Responses

| HTTP | Code | Meaning |
| --- | --- | --- |
| 202 | `INGESTED` / `DUPLICATE` | Stored (duplicates are acknowledged so the board moves on) |
| 401 | `INVALID_DEVICE_CREDENTIAL` | Missing, malformed, wrong or revoked key |
| 403 | `DEVICE_IDENTITY_MISMATCH` | Key belongs to a different `deviceId` |
| 422 | `INVALID_PAYLOAD` | Packet fields out of contract (see `errors`) |
| 502 | `STORE_UNAVAILABLE` | Supabase unreachable — board retries |
| 503 | `INGRESS_NOT_CONFIGURED` | Service key secret not set yet |
| negative | (Serial) | WiFi, DNS, clock or TLS problem on the board |

TLS: the board verifies the site certificate against `root_ca.h` (ISRG Root X1/X2, GTS Root R1/R4), which covers the CAs Cloudflare issues from. The board needs working NTP time for certificate checks.
