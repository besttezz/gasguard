# Device Ingress Prototype

`POST /api/v1/device/telemetry` accepts the existing Raw Measurement contract. The server authenticates the device, resolves its workspace from `server/device-registry.js`, then calls Measurement → Telemetry V1.1 → the workspace-specific engine runtime.

Device authentication is separate from Supabase user authentication. Configure keys only in the server process:

- `GASGUARD_REAL_DEVICE_KEY` for `ESP32-KITCHEN-01`
- `GASGUARD_TEST_DEVICE_KEY` for `SIM-ESP32-KITCHEN-01`

Send the credential in `x-device-key` or `Authorization: Bearer …`. There are no default keys and incoming `workspaceId` is not trusted.

For a local virtual-board run, start the dev server with the test key configured, then run `npm run virtual:esp32 -- NORMAL` in a second process with the same `GASGUARD_TEST_DEVICE_KEY`. Supported deterministic scenarios are NORMAL, RISING, ATTENTION, CRITICAL, RECOVERY, OFFLINE, STALE, DUPLICATE, OUT_OF_ORDER, REBOOT, and INVALID_PAYLOAD.

`GET /api/v1/device/status?workspace=device-test` returns the sanitized presentation state used by the SPA. The ingress handler is transport-independent so the request adapter can later move to a Worker without changing Measurement, Telemetry, or Engine contracts.
