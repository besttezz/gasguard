# GasGuard ESP32 Field Node Foundation (V1 Prototype)

This directory contains the field integration foundation firmware architecture for GasGuard ESP32 devices. It provides a modular, prototype foundation designed to interface with physical MQ sensors (MQ-6 primary LPG, MQ-3 auxiliary context) once electrical validation and calibration are completed on physical bench units.

> [!WARNING]
> This firmware is a prototype field integration foundation and has **NOT** been compiled against a physical target, flashed, bench tested, or electrically validated.
> Board pin assignments and voltage divider scaling are **UNCONFIRMED** (`GASGUARD_HARDWARE_PROFILE_CONFIRMED = false`). Hardware profile parameters must be verified on physical hardware before flashing.

---

## 1. Modular Architecture

```
Physical MQ Sensors (MQ-6, MQ-3)
           │
  Analog Signal Conditioning / Precision Voltage Divider (Unconfirmed)
           │
   ESP32 ADC1 Pins (Board-profile validated)
           │
   [ sensor_config ] ── Pin / Attenuation / Scaling Descriptors
           │
   [ measurement ]   ── Raw ADC (analogRead) & Calibrated mV (analogReadMilliVolts)
           │ [Status: CALIBRATION_REQUIRED]
   [ telemetry ]     ── Pre-Telemetry Device Ingress Payload (bootId + sequence per sensor)
           │
   [ network_prov ]  ── Network State Machine & Bounded Backoff
           │
   [ transport ]     ── HTTPS POST /api/v1/device/telemetry (Configurable Ingress URL)
```

---

## 2. Sensor Roles & Truth Model

- **MQ-6**: `PRIMARY_LPG_SENSOR`
  - Sole primary channel for LPG monitoring.
- **MQ-3**: `AUXILIARY_CONTEXT_SENSOR`
  - Auxiliary context channel only (e.g. ambient volatile/alcohol cross-sensitivity indicator).
  - **CRITICAL**: MQ-3 readings are **NEVER** averaged or combined into the MQ-6 LPG ppm channel.

### Uncalibrated Measurement Policy
Until physical multi-point calibration is executed and stored in NVS/calibration profiles:
- Status is explicitly reported as `CALIBRATION_REQUIRED`.
- Transmitted raw payload includes:
  - `raw.adc` (12-bit ADC reading, 0–4095)
  - `raw.sensorVoltage` (calibrated ESP32 ADC pin voltage via `analogReadMilliVolts`, converted to volts)
  - `raw.inputAdjustedVoltage` (null until scaling is confirmed)
  - `raw.calibrationStatus` (`"CALIBRATION_REQUIRED"`)
- **FORBIDDEN**: The firmware will **NEVER** output invented ppm, fake confidence scores, or uncalibrated leak diagnoses.
- Raw payloads are **pre-telemetry device measurements** and do NOT claim canonical `gasguard.telemetry.v1.1` (which requires `gas.ppm`).

---

## 3. ADC Safety & Electrical Requirements

1. **ADC1 Requirement**: Use pins connected to ESP32 ADC1. ADC2 pins cannot be sampled reliably while Wi-Fi is active.
2. **Voltage Conditioning**: MQ sensor module Analog Output (AO) often operates at 5V. ESP32 GPIO pins tolerate a maximum of 3.3V. An external precision voltage divider (or op-amp buffer) is mandatory.
3. **Input Scale Factor (`inputScale`)**: Must be physically verified before setting `GASGUARD_HARDWARE_PROFILE_CONFIRMED = true`.
4. **Sensor Preheat**: Winsen MQ-6 and MQ-3B datasheets specify preheating for **at least 48 hours** before initial calibration or field deployment.

---

## 4. Connection State Machine & SoftAP

The node operates under an explicit connection state machine (`network_provisioning`):

1. `UNPROVISIONED`: No saved Wi-Fi credentials found.
2. `PROVISIONING`: SoftAP provisioning interface prepared (**PLANNED / NOT YET IMPLEMENTED**).
3. `CONNECTING_WIFI`: Connecting to configured AP.
4. `WIFI_CONNECTED`: Local Wi-Fi link established.
5. `CONNECTING_INGRESS`: Testing HTTP/HTTPS connection to GasGuard Ingress URL.
6. `READY`: Operating normally; transmitting raw device measurements.
7. `CALIBRATION_REQUIRED`: Sensor operational but requiring calibration.
8. `OFFLINE`: Network link lost; retrying with bounded exponential backoff.
9. `CONFIG_ERROR`: Unconfirmed or invalid hardware profile configuration.

---

## 5. Security & Provisioning Boundaries

- **Separation of Credentials**:
  - `deviceId` & `deviceCredential` (Server-issued device identity & auth key)
  - Wi-Fi Credentials (Provisioned via protected SoftAP session)
  - Owner Invitation Credentials (Used exclusively by human site owners; **NEVER** stored or used by ESP32 devices)
- **Secret Redaction**: Field diagnostic serial output redacts all Wi-Fi passwords and device keys.
- **Ingress Endpoints**: Endpoint URL is fully configurable in `transport.h` (`GASGUARD_INGRESS_URL`), allowing seamless transition from local LAN (`http://<lan-ip>:5567/api/v1/device/telemetry`) to cloud HTTPS without firmware code changes.
