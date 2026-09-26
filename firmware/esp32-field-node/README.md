# GasGuard ESP32 Field Node Foundation (V1)

This directory contains the production-ready field node firmware architecture for GasGuard ESP32 devices. It provides a modular, configurable foundation designed to interface with physical MQ sensors (MQ-6 primary LPG, MQ-3 auxiliary context) once electrical validation and calibration are completed on physical bench units.

> [!NOTE]
> This firmware foundation is hardware-agnostic and board-configurable. Final GPIO pin assignments must be locked only after verifying physical ESP32 board variant pinouts and module voltage dividers.

---

## 1. Modular Architecture

```
Physical MQ Sensors (MQ-6, MQ-3)
           │
  Analog Signal Conditioning / Voltage Divider
           │
   ESP32 ADC1 Pins (Wi-Fi Safe)
           │
   [ sensor_config ] ── Pin / Attenuation / Scaling Descriptors
           │
   [ measurement ]   ── Raw ADC → ADC Voltage → Input Voltage (CALIBRATION_REQUIRED)
           │
   [ telemetry ]     ── Contract gasguard.telemetry.v1.1 (bootId + sequence)
           │
   [ network_prov ]  ── Provisioning / Wi-Fi State Machine & Bounded Backoff
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
- Transmitted payload includes:
  - `raw.adc` (12-bit ADC reading, 0–4095)
  - `raw.sensorVoltage` (calibrated ESP32 ADC pin voltage, e.g. 0.0V–3.3V)
  - `raw.inputAdjustedVoltage` (voltage corrected by `inputScale` factor)
  - Sensor identity and diagnostic metadata
- **FORBIDDEN**: The firmware will **NEVER** output invented ppm, fake confidence scores, or uncalibrated leak diagnoses.

---

## 3. ADC Safety & Electrical Requirements

1. **ADC1 Requirement**: Use pins connected to ESP32 ADC1. ADC2 pins cannot be sampled reliably while Wi-Fi is active.
2. **Voltage Conditioning**: MQ sensor module Analog Output (AO) often operates at 5V. ESP32 GPIO pins tolerate a maximum of 3.3V. An external precision voltage divider (or op-amp buffer) is mandatory.
3. **Input Scale Factor (`inputScale`)**: Configure `inputScale = (R1 + R2) / R2` in `sensor_config` to reflect the physical voltage divider ratio so raw voltage is correctly scaled back to AO voltage.

---

## 4. Connection State Machine

The node operates under an explicit connection state machine (`network_provisioning`):

1. `UNPROVISIONED`: No saved Wi-Fi credentials found.
2. `PROVISIONING`: Protected SoftAP active for technician provisioning.
3. `CONNECTING_WIFI`: Connecting to configured AP.
4. `WIFI_CONNECTED`: Local Wi-Fi link established.
5. `CONNECTING_INGRESS`: Testing HTTP/HTTPS connection to GasGuard Ingress URL.
6. `READY`: Operating normally; transmitting telemetry.
7. `CALIBRATION_REQUIRED`: Sensor operational but requiring calibration.
8. `OFFLINE`: Network link lost; retrying with bounded backoff.
9. `CONFIG_ERROR`: Invalid sensor or board configuration.

---

## 5. Security & Provisioning Boundaries

- **Separation of Credentials**:
  - `deviceId` & `deviceCredential` (Server-issued device identity & auth key)
  - Wi-Fi Credentials (Provisioned via protected SoftAP session)
  - Owner Invitation Credentials (Used exclusively by human site owners; **NEVER** stored or used by ESP32 devices)
- **Secret Redaction**: Field diagnostic serial output redacts all Wi-Fi passwords and device keys.
- **Ingress Endpoints**: Endpoint URL is fully configurable in `transport.h` (`GASGUARD_INGRESS_URL`), allowing seamless transition from local LAN (`http://<lan-ip>:5567/api/v1/device/telemetry`) to cloud HTTPS without firmware code changes.
