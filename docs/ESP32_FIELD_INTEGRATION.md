# GasGuard ESP32 Field Integration Specification

This document details the software architecture, electrical requirements, data truth model, and first-connection field procedures for integrating physical ESP32 hardware and MQ sensors into GasGuard.

> [!IMPORTANT]
> Firmware components described in this specification represent the **field integration foundation (prototype)**. Physical hardware validation, bench testing, toolchain compilation, and electrical confirmation have **NOT** yet been executed.

---

## 1. System Architecture

```
Physical MQ Sensors (MQ-6, MQ-3)
           │
  Analog Signal Conditioning / Precision Voltage Divider
           │
   ESP32 ADC1 Pins (Board-profile validated)
           │
   Measurement Layer (Raw ADC via analogRead → Pin Voltage via analogReadMilliVolts)
           │ [Status: CALIBRATION_REQUIRED]
   Pre-Telemetry Device Ingress Payload (deviceId, sensorId, bootId, sequence, raw)
           │
   Device Ingress (/api/v1/device/telemetry → HTTP 202 Accepted, gasPpm = null, safety = UNKNOWN)
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
  - `raw.adc` (12-bit ADC integer, 0–4095 from `analogRead`)
  - `raw.sensorVoltage` (calibrated ESP32 pin voltage from `analogReadMilliVolts`, in volts)
  - `raw.inputAdjustedVoltage` (null until physical scaling factor is confirmed)
  - `raw.calibrationStatus` (`"CALIBRATION_REQUIRED"`)
- **PROHIBITED CLAIMS**:
  - Invented ppm values prior to physical calibration.
  - Claiming raw packets are canonical `gasguard.telemetry.v1.1`.
  - Fake confidence scores.
  - Uncalibrated leak severity diagnoses.

---

## 4. Electrical Verification Checklist & ADC Range

Before connecting any MQ sensor module to an ESP32 board, perform the following bench checks:

1. **Board Model Identification**: Verify exact ESP32 chip revision and board pinout (confirm ADC1 pins).
2. **MQ Module Model & Datasheet**: Verify exact module manufacturer/model. Winsen MQ-6 and MQ-3B datasheets specify preheating over/not less than **48 hours**.
3. **Common Ground**: Ensure ESP32 GND and MQ module GND are connected to a single common ground plane.
4. **Supply Voltage**: Verify dedicated 5V power supply capacity for sensor heaters (ESP32 3.3V rail must NOT be used for MQ heaters).
5. **Voltage Divider / Signal Conditioning**: Measure AO maximum output. Resistor divider ($R_1, R_2$) must keep maximum ESP32 pin voltage strictly $\le 3.3V$ for electrical safety.
6. **ADC Attenuation & Measurable Range**: Configure `ADC_11db` attenuation. Note that final measurable voltage range depends on the exact ESP32 variant and configured attenuation (for classic ESP32, `ADC_11db` measurable range is approximately 150 mV to 3100 mV). Distinguish electrical safety maximum limit ($\le 3.3V$) from ADC calibrated linear range.
7. **ADC Pin Verification**: Confirm AO signals connect strictly to **ADC1 pins** confirmed by board profile validation. Do NOT use ADC2 pins due to Wi-Fi driver conflicts.

---

## 5. First Field Connection Procedure

1. **Bench Power Check**: Apply 5V power to MQ heaters; allow **at least 48 hours** sensor preheat according to exact sensor datasheet.
2. **Serial Connection**: Connect ESP32 to bench host via USB/Serial (115200 baud).
3. **Provisioning**: Initialize Protected SoftAP provisioning mode (**IMPLEMENTED IN SOURCE**: Security 1 + Proof of Possession; see `docs/ESP32_PROVISIONING.md`).
4. **Network Verification**: Verify Wi-Fi connection and local IP assignment (`NODE_STATE_WIFI_CONNECTED`).
5. **Ingress Reachability**: Verify HTTP/HTTPS POST reachability to GasGuard ingress URL (`NODE_STATE_CONNECTING_INGRESS` -> `NODE_STATE_READY`).
6. **Raw Telemetry Stream**: Confirm raw measurement packets arrive with `raw.adc` and `calibrationStatus = "CALIBRATION_REQUIRED"`.
7. **Hardware Pilot UI Verification**: Inspect Hardware Pilot workspace; confirm device connection status displays `DEVICE ONLINE`, `safety = UNKNOWN`, `gasPpm = null`, and latest raw measurements by sensor are visible.

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
1. Physical board GPIO pin mapping lock (`GASGUARD_HARDWARE_PROFILE_CONFIRMED = true`).
2. Multimeter measurement of AO max voltage under gas exposure.
3. Resistor value verification for voltage divider.
4. Multi-point gas chamber calibration curve generation ($R_s/R_0$ vs ppm).
5. NVS calibration profile flash storage implementation.
