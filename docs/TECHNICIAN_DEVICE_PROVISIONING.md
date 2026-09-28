# GasGuard Technician Device Provisioning

## Overview

HW-3C2B completes the Technician Provisioning Client Contract & Compile Readiness foundation. It defines how field technicians interact with the ESP32 protected SoftAP provisioning service (`PROV_GG_<MAC suffix>`) to supply the Device UID and Enrollment Token via the custom endpoint `gasguard-enroll`.

---

## Provisioning Workflows

### 1. Initial Provisioning (Unprovisioned Node)
- Node has no saved Wi-Fi STA credentials.
- `prepareWiFiProvisioning(config)` starts protected SoftAP with Security 1 + Proof of Possession (PoP).
- Custom endpoint `gasguard-enroll` is created after `network_prov_mgr_init()` and handler is registered after `network_prov_mgr_start_provisioning()`.
- Technician sends `deviceUid` + `enrollmentToken` to `gasguard-enroll`.
- Technician sends Wi-Fi credentials via standard provisioning manager endpoints.
- ESP32 connects to Wi-Fi, calls HTTPS enrollment API, receives Device Credential, and persists to NVS.

### 2. Re-Enrollment Provisioning (Saved Wi-Fi, Credential Absent/Reset)
- Device UID & Device Credential cleared from NVS via `clearDeviceCredentials()`.
- Wi-Fi credentials remain saved in Wi-Fi stack NVS partition (**NOT erased**).
- Node state transitions to `ENROLLMENT_BOOTSTRAP_CHANNEL_REQUIRED`.
- Technician explicitly invokes `startDeviceEnrollmentProvisioning(config)` (or `requestDeviceEnrollmentProvisioning(config)`).
- Reopens protected SoftAP with Security 1 + PoP and `gasguard-enroll` endpoint **WITHOUT checking `isWiFiProvisioned()` or calling `network_prov_mgr_reset_wifi_provisioning()`**.
- Upon accepting bootstrap via `gasguard-enroll`, `g_enrollmentBootstrapAccepted` signal triggers `requestProvisioningStop()`, safely closing the SoftAP session without erasing saved Wi-Fi STA credentials.
- Device reconnects to saved Wi-Fi STA network, transitions to `ENROLLING_DEVICE`, and performs HTTPS claim.

#### Authorized Technician Client Policy for Re-Enrollment
When `startDeviceEnrollmentProvisioning` reopens the Espressif `network_prov_mgr` SoftAP session, standard Wi-Fi provisioning endpoints (`prov-config`, `prov-scan`) may be exposed by default by the underlying framework.

**AUTHORIZED TECHNICIAN CLIENT POLICY:**
Custom endpoint (`gasguard-enroll`) ONLY during re-enrollment. Authorized GasGuard technician tooling MUST NOT invoke Wi-Fi configuration endpoints during re-enrollment, preserving saved Wi-Fi STA credentials.

#### Provisioning Teardown Lifecycle & Deinit Ownership
- **Single-Authority Teardown**:
  1. Bootstrap accepted (`gasguard-enroll`)
  2. Application issues `requestProvisioningStop()` (manager state: `PROV_MGR_STOP_REQUESTED`)
  3. Framework executes teardown and emits `ARDUINO_EVENT_PROV_END`
  4. Application updates manager state to `PROV_MGR_STOPPED`
  5. Application resumes saved Wi-Fi STA (`WiFi.mode(WIFI_STA); WiFi.begin();`)
  6. Connection established (`WL_CONNECTED` / `GOT_IP`) → transition to `ENROLLING_DEVICE` → HTTPS claim

- **Official Evidence & Framework Deinit Ownership**:
  Upstream Arduino-ESP32 event bridge (`WiFiProv.cpp` / `network_prov_mgr`) handles `NETWORK_PROV_END` by executing `network_prov_mgr_deinit()` before forwarding `ARDUINO_EVENT_PROV_END` to the application.
  *(Validated against current Arduino-ESP32 upstream source; exact installed target core still pending).*
  Therefore, once active provisioning has successfully started, the application requests `STOP` only. Direct `deinit` calls are forbidden post-start to prevent double-deinit race conditions.

---

## Technician Client Contract Helper (`tools/esp32-provisioning-client.js`)

Developer and technician client tooling uses `tools/esp32-provisioning-client.js` for contract validation and safe logging:

### Payload Contract
```json
{
  "deviceUid": "<server-assigned UID, non-empty, <=128, no control chars>",
  "enrollmentToken": "<64 lowercase hexadecimal characters>"
}
```

### Response Contract
```json
{
  "ok": true,
  "code": "ENROLLMENT_BOOTSTRAP_ACCEPTED"
}
```

### Wire Protocol Transport
Wire-level Security 1 key exchange (X25519 + AES-CTR) is delegated to official Espressif provisioning tools:
- Android: `ESPProvisioning` SDK (`sendDataToCustomEndPoint("gasguard-enroll", payload, callback)`)
- iOS: `ESPProvisioning` iOS SDK
- CLI / Developer: Espressif `esp-idf-provisioning` / `esp_prov` python tool

---

## Client Secret Handling Policy

The Technician Client MUST:
1. Deliver the Enrollment Token over the encrypted Security 1 session.
2. Clear the Enrollment Token from client memory after handoff.
3. NEVER log, persist, or transmit Enrollment Tokens or Wi-Fi passwords.
4. Redact all secret fields in diagnostic logs (`formatSafeTechnicianLog`).
5. NEVER handle or receive the server-issued Device Credential (delivered directly from server to ESP32).

---

## Firmware Compile & Target Readiness

- Installed Toolchain Inspection: `Arduino15` installed with `esp8266` toolchain (xtensa-lx106-elf-gcc). `esp32` Arduino core (xtensa-esp32-elf-gcc) is **NOT installed** locally.
- Exact Board Target: **EXACT BOARD TARGET = NOT CONFIRMED** (Target hardware pinout and board model remain unverified; `GASGUARD_HARDWARE_PROFILE_CONFIRMED = false`).
- Compilation Execution: **FIRMWARE COMPILE = NOT EXECUTED** (Acceptable under compile policy since target board and esp32 compiler toolchain are not locked).
