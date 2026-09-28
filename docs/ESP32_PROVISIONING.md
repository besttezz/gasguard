# GasGuard ESP32 Protected Wi-Fi Provisioning Specification

This document details the architecture, security model, boot state machine, and technician procedures for protected ESP32 Wi-Fi provisioning in GasGuard.

---

## 1. Provisioning Architecture

```
Unprovisioned ESP32 Node
           │
   Espressif Provisioning Manager (wifi_prov_mgr, SoftAP scheme)
           │ [Security 1: X25519 + AES-CTR + Proof of Possession]
   Technician Provisioning Client (Espressif Provisioning App)
           │ [Provides SSID & Wi-Fi Password]
   ESP32 Local Wi-Fi NVS Persistence
           │
   Station Mode Link Established (WIFI_CONNECTED)
           │
   [DEVICE_ENROLLMENT_REQUIRED] (Separate GasGuard Device Credentials - HW-3)
```

> [!NOTE]
> The implementation directly uses the Espressif Network Provisioning Manager (`wifi_prov_mgr`) rather than the higher-level Arduino `WiFiProv` wrapper to prevent internal `INFO` level logging of Proof of Possession (PoP) and SoftAP keys to serial logs.

---

## 2. Security Boundaries & Decision Model

- **Security 1 Required**: Provisioning sessions **MUST** use `WIFI_PROV_SECURITY_1` (Security 1) with X25519 Elliptic Curve Key Exchange, AES-CTR encrypted transport, and Proof of Possession (PoP) authentication.
- **Security 0 Prohibited**: Plaintext provisioning (`Security 0`) is strictly forbidden and rejected during config validation.
- **Proof of Possession (PoP)**:
  - Must be high-entropy (minimum 12 characters) and generated uniquely per physical device outside committed source.
  - Universal or static default strings (e.g., `abcd1234`, `12345678`, `password`) are strictly forbidden.
  - If a device lacks a valid PoP in `provisioning_secrets.h`, provisioning fails closed (`NODE_STATE_PROVISIONING_CONFIG_REQUIRED`).
- **Credential Separation**:
  - Wi-Fi Credentials $\neq$ Provisioning PoP $\neq$ GasGuard Device Credentials $\neq$ Owner Invitation Tokens.
  - Provisioning Wi-Fi access does **NOT** grant GasGuard ingress authentication or enrollment.

---

## 3. Boot & Connection State Machine

1. `UNPROVISIONED`: Device boots with no saved Wi-Fi STA credentials in NVS.
2. `PROVISIONING`: Protected SoftAP active (`PROV_GG_XXXXXX`, Security 1 + PoP).
3. `PROVISIONING_CONFIG_REQUIRED`: Device configuration error (e.g. missing `provisioning_secrets.h` or forbidden default PoP).
4. `PROVISIONING_FAILED`: Wi-Fi credential negotiation failed.
5. `CONNECTING_WIFI`: Connecting to provisioned AP.
6. `WIFI_CONNECTED`: Connected to Wi-Fi AP with local IP.
7. `DEVICE_ENROLLMENT_REQUIRED`: Wi-Fi connected, but no GasGuard device key exists (HW-3 boundary).
8. `CONNECTING_INGRESS`: Authenticating to GasGuard device ingress URL.
9. `READY`: Ingress connection established.

---

## 4. Controlled Wi-Fi Reset Interface

- **`requestWiFiProvisioningReset()`**: Erases stored Wi-Fi STA credentials from native NVS via `wifi_prov_mgr_reset_provisioning()`.
- **Isolation**: Reset erases **ONLY** Wi-Fi station credentials. It does **NOT** erase device identity, device credentials, sensor calibration data, or owner invitation tokens.

---

## 5. Field Technician Workflow

1. Power on GasGuard field node.
2. If unprovisioned, node starts SoftAP (`PROV_GG_XXXXXX`).
3. Technician opens Espressif Provisioning Client on tablet/phone.
4. Technician connects to `PROV_GG_XXXXXX` and inputs device-specific PoP.
5. Technician selects site Wi-Fi SSID and inputs network password.
6. Node saves credentials to native NVS, closes SoftAP, and connects to Wi-Fi.
7. Node displays state `WIFI_CONNECTED` followed by `DEVICE_ENROLLMENT_REQUIRED` until device enrollment (HW-3) is completed.

---

## 6. Development Status & Wording

- **IMPLEMENTED IN SOURCE**: Wi-Fi provisioning architecture, state machine, native `network_prov_mgr` / `wifi_prov_mgr` compatibility boundary, event callbacks, PoP validation, and contract functions exist in codebase.
- **HOST CONTRACT TESTED**: Host-side JS contract tests verify state transitions, PoP validation, and secret redaction.
- **FIRMWARE COMPILE NOT TESTED**: Compiler toolchain execution has not been run.
- **PHYSICAL SOFTAP NOT TESTED**: Physical hardware bench testing pending physical board arrival.

---

## 7. Build & Framework Security Considerations

- **Application Logging**: GasGuard C++ runtime source never logs PoP, service key, Wi-Fi password, or device key at any log level.
- **Framework Verbose Logging**: The underlying Arduino/ESP-IDF framework network stack may emit provisioned SSID/password if core debug level is set to `VERBOSE`. Field production builds must ensure framework debug logging is disabled (`CORE_DEBUG_LEVEL=0`).
