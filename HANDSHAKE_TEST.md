# ESP32 Synthetic Handshake Test

This test confirms ESP32 WiFi → HTTP ingress → `hardware-pilot` → dashboard. The firmware sends fixed synthetic `upstreamPpm` values for transport testing only. It does not read MQ sensors and must not be treated as a gas test.

## Server

```powershell
$env:GASGUARD_REAL_DEVICE_KEY='<SET_TEMPORARY_DEVICE_KEY>'
$env:GASGUARD_HOST='0.0.0.0'
$env:GASGUARD_PORT='5567'
npm run dev
```

Run `ipconfig` and note the IPv4 address of the active Wi-Fi adapter. Confirm `http://<LAN_IP>:5567/api/v1/health` is reachable from another device on the same trusted WiFi.

## ESP32

1. Copy `firmware/esp32-handshake/secrets.example.h` to `secrets.h`.
2. Set WiFi SSID/password, the same temporary device key, and `GASGUARD_SERVER_URL` using the computer LAN IP.
3. Open `esp32-handshake.ino`, select the ESP32 board/port, flash, and open Serial Monitor at 115200 baud.
4. Keep `SEND_OPTIONAL_MQ3=false` for MQ6-only testing; set it to `true` to also send `MQ3-01`.

Each request uses `POST /api/v1/device/telemetry`, JSON content type, `x-device-key`, and `x-gasguard-data-classification: SYNTHETIC_HANDSHAKE`. A successful packet prints HTTP 202 and `INGESTED`. Retry occurs only for connection/server failures; sequence advances only after HTTP 202.

Open `http://<LAN_IP>:5567/?workspace=hardware-pilot` and sign in. Expected transition: `WAITING_FOR_DEVICE / UNKNOWN / N/A` → connected with last telemetry, packet status `SYNTHETIC HANDSHAKE ACCEPTED`, and an explicit synthetic-handshake warning.

Common errors:

- 401: missing/wrong device key
- 403: key belongs to another registered device
- 422: Raw Measurement validation failed
- 409: duplicate or out-of-order sequence
- Negative HTTP code in Serial: WiFi, LAN IP, port, or firewall problem

After the handshake, remove the temporary key from `secrets.h`; the file is git-ignored.
