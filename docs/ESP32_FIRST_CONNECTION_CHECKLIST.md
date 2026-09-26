# ESP32 First Connection Bench Checklist

This checklist is to be opened and followed at the bench on the day physical ESP32 boards and MQ sensors arrive.

---

## 1. BOARD IDENTIFICATION
- [ ] Record exact ESP32 development board model & chip revision.
- [ ] Identify ADC1 pins on board pinout diagram (GPI 32–39).

## 2. POWER
- [ ] Verify external 5V power supply capacity ($\ge 1.0\text{A}$ for ESP32 + 2x MQ sensor heaters).
- [ ] Confirm common GND connection between 5V power supply, ESP32 GND, and sensor module GND.
- [ ] Confirm MQ sensor heater pins connect to 5V (NOT 3.3V).

## 3. SENSOR WIRING
- [ ] Wire MQ-6 AO to designated ADC1 pin via voltage divider circuit.
- [ ] Wire MQ-3 AO to designated ADC1 pin via voltage divider circuit.
- [ ] Confirm no sensor AO signal is directly connected to ESP32 without checking voltage scaling.

## 4. ADC SAFETY
- [ ] Measure voltage at ESP32 pin with multimeter under max AO output: verify $\le 3.3\text{V}$.
- [ ] Calculate input scaling factor $K = (R_1 + R_2) / R_2$ and record in `board_config.h`.

## 5. SERIAL
- [ ] Connect ESP32 to bench host USB.
- [ ] Open Serial Monitor at 115200 baud.
- [ ] Verify boot log displays `[GasGuard Node] Starting v1.0.0-field-foundation`.

## 6. WI-FI PROVISIONING
- [ ] Trigger provisioning mode (`NODE_STATE_PROVISIONING`).
- [ ] Configure local Wi-Fi AP credentials.
- [ ] Verify state transitions to `NODE_STATE_WIFI_CONNECTED` and local IP is assigned.

## 7. INGRESS
- [ ] Configure `GASGUARD_INGRESS_URL` to local server (e.g. `http://<server-ip>:5567/api/v1/device/telemetry`).
- [ ] Confirm HTTP POST response returns status `202 Accepted`.

## 8. RAW DATA
- [ ] Inspect raw telemetry stream: confirm `raw.adc` (0–4095) and `raw.sensorVoltage` (0–3.3V) update dynamically.
- [ ] Confirm `calibrationStatus` reports `"CALIBRATION_REQUIRED"`.

## 9. TELEMETRY
- [ ] Verify telemetry schema version `gasguard.telemetry.v1.1`.
- [ ] Verify `deviceId`, `sensorId`, `bootId`, and incrementing `sequence` counter.

## 10. UI
- [ ] Open GasGuard Hardware Pilot UI.
- [ ] Confirm device status displays `DEVICE ONLINE`.
- [ ] Confirm sensor status displays `CALIBRATION REQUIRED`.

## 11. ROLLBACK / TROUBLESHOOTING
- [ ] If Wi-Fi fails: fallback to synthetic handshake reference firmware (`firmware/esp32-handshake/`).
- [ ] If ADC raw is saturated at 4095: disconnect signal immediately and recheck voltage divider resistors.
