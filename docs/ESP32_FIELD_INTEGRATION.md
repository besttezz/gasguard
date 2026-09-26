# GasGuard ESP32 Field Integration Specification

This document details the software architecture, electrical requirements, data truth model, and first-connection field procedures for integrating physical ESP32 hardware and MQ sensors into GasGuard.

---

## 1. System Architecture

```
Physical MQ Sensors (MQ-6, MQ-3)
           │
  Analog Signal Conditioning / Precision Voltage Divider
           │
   ESP32 ADC1 Pins (Wi-Fi Safe: GPIO 32–39)
           │
   Measurement Layer (Raw ADC → Pin Voltage → AO Voltage)
           │ [Status: CALIBRATION_REQUIRED]
   Telemetry Builder (Contract: gasguard.telemetry.v1.1)
           │
   Transport Layer (HTTP/HTTPS POST /api/v1/device/telemetry)
           │
   GasGuard Backend & Hardware Pilot Pipeline
```

---

## 2. Sensor Channel Roles

- **MQ-6**: `PRIMARY_LPG_SENSOR`
  - Dedicated primary channel for Liquefied Petroleum Gas (LPG) monitoring.
- **MQ-3**: `AUXILIARY_CONTEXT_SENSOR`
  - Auxiliary channel used strictly for environmental context (e.g. alcohol / solvent interference detection).
  - **MANDATORY RULE**: MQ-3 readings are **NEVER** averaged or combined into the MQ-6 LPG ppm measurement channel.

---

## 3. Measurement Truth & Calibration Model

Until physical multi-point gas chamber calibration is performed:
- Measurement status is explicitly reported as `CALIBRATION_REQUIRED`.
- Transmitted payload includes:
  - `raw.adc` (12-bit ADC integer, 0–4095)
  - `raw.sensorVoltage` (calibrated ESP32 pin voltage, 0.0V–3.3V)
  - `raw.inputAdjustedVoltage` (AO voltage corrected by external divider scale)
  - `raw.calibrationStatus` (`"CALIBRATION_REQUIRED"`)
- **PROHIBITED CLAIMS**:
  - Invented ppm values prior to physical calibration.
  - Fake confidence scores.
  - Uncalibrated leak severity diagnoses.

---

## 4. Electrical Verification Checklist

Before connecting any MQ sensor module to an ESP32 board, perform the following bench checks:

1. **Board Model Identification**: Verify exact ESP32 chip revision and board pinout (confirm ADC1 pins).
2. **MQ Module Model**: Verify heater power requirements (typically 5V @ 150mA per module) and AO pin output range.
3. **Common Ground**: Ensure ESP32 GND and MQ module GND are connected to a single common ground plane.
4. **Supply Voltage**: Verify dedicated 5V power supply capacity for sensor heaters (ESP32 3.3V rail must NOT be used for MQ heaters).
5. **Voltage Divider / Signal Conditioning**: Measure AO maximum output. If AO > 3.3V, verify resistor divider ($R_1, R_2$) reduces maximum pin voltage to $\le 3.3V$.
6. **ADC Pin Verification**: Confirm AO signals connect strictly to **ADC1 pins** (GPIO 32, 33, 34, 35, 36, 39). Do NOT use ADC2 pins (GPIO 0, 2, 4, 12, 13, 14, 15, 25, 26, 27) due to Wi-Fi driver conflicts.

---

## 5. First Field Connection Procedure

1. **Bench Power Check**: Apply 5V power to MQ heaters; allow 24-hour sensor preheat if fresh out of box.
2. **Serial Connection**: Connect ESP32 to bench host via USB/Serial (115200 baud).
3. **Provisioning**: Initialize SoftAP provisioning mode to configure local Wi-Fi credentials.
4. **Network Verification**: Verify Wi-Fi connection and local IP assignment (`NODE_STATE_WIFI_CONNECTED`).
5. **Ingress Reachability**: Verify HTTP/HTTPS POST reachability to GasGuard ingress URL (`NODE_STATE_CONNECTING_INGRESS` -> `NODE_STATE_READY`).
6. **Raw Telemetry Stream**: Confirm `gasguard.telemetry.v1.1` packets arrive with `raw.adc` and `calibrationStatus = "CALIBRATION_REQUIRED"`.
7. **Hardware Pilot UI Verification**: Inspect Hardware Pilot workspace; confirm device connection status displays `DEVICE ONLINE` and sensor status displays `CALIBRATION REQUIRED`.

---

## 6. Prohibited Safety Claims

The following claims are **STRICTLY PROHIBITED** until formal safety certification is completed:
- Claiming calibrated LPG ppm prior to physical gas chamber calibration.
- Claiming certified life-safety gas alarm operation.
- Claiming automatic solenoid valve safety control.
- Claiming industrial or commercial safety certification.

---

## 7. Remaining Physical Validation Items

When physical hardware arrives at the bench, complete:
1. Physical board GPIO pin mapping lock.
2. Multimeter measurement of AO max voltage under gas exposure.
3. Resistor value verification for voltage divider.
4. Multi-point gas chamber calibration curve generation ($R_s/R_0$ vs ppm).
5. NVS calibration profile flash storage implementation.
