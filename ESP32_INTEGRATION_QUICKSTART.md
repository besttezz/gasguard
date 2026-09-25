# ESP32 Integration Quickstart

## A. Install and run

Use Node.js 18 or newer. Run `npm install`, then `npm run integration:check`. Results are `PASS`, `WARN`, or `FAIL`; credentials are never printed.

## B. Configure environment

Use `config/integration.env.example` as a checklist. Set these values in the current shell, not in frontend files:

```powershell
$env:GASGUARD_HOST='127.0.0.1'
$env:GASGUARD_PORT='5567'
$env:GASGUARD_REAL_DEVICE_KEY='<SET_REAL_DEVICE_KEY>'
$env:GASGUARD_TEST_DEVICE_KEY='<SET_TEST_DEVICE_KEY>'
```

Run `npm run integration:check` again. `READY_FOR_DEVICE` means the software path is configured; it does not mean an ESP32 is connected.

## C. LAN mode

Run `npm run dev:lan`. The command defaults to `0.0.0.0` and uses `GASGUARD_PORT`; it does not hard-code a computer IP. Run `ipconfig`, find the active Wi-Fi IPv4 address, and check `http://<LAN_IP>:5567/api/v1/health` from the same trusted WiFi.

## D. Virtual test

Run `npm run integration:verify`. It starts an isolated local server, sends Virtual ESP32 packets through the real HTTP ingress, verifies `device-test` is receiving, confirms `hardware-pilot` remains `NO DATA / UNKNOWN`, then stops. For an already-running server use `npm run virtual:esp32 -- NORMAL` with `GASGUARD_TEST_DEVICE_KEY` configured.

## E. Real ESP32 setup

Copy `firmware/esp32-handshake/secrets.example.h` to the git-ignored `secrets.h`. Set WiFi SSID/password, `http://<LAN_IP>:<PORT>/api/v1/device/telemetry`, and the same real-device key used by the server. Flash the handshake sketch and open Serial Monitor at 115200 baud. The handshake values are synthetic and explicitly labelled; they are not MQ readings.

## F. Expected states

- `NOT_CONFIGURED`: required software configuration is missing
- `READY_FOR_DEVICE`: server, ingress, registry, and real device auth are ready
- `WAITING_FOR_DEVICE`: Hardware Pilot has received no telemetry
- `RECEIVING`: fresh authenticated telemetry exists
- `STALE`: the last packet exceeded the freshness timeout
- `ERROR`: health/configuration check failed

## G. Common errors

- 401: missing or invalid device key
- 403: device and key belong to different registry entries
- 409: duplicate or out-of-order sequence within the same bootId
- 422: Raw Measurement validation or conversion requirement failed
- Network failure: check WiFi, LAN IP, port, firewall, and that `dev:lan` is running
