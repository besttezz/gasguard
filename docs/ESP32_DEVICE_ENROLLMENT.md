# GasGuard ESP32 Device Enrollment

## Overview

HW-3C2A & HW-3C2A1 implement the secure ESP32 enrollment handoff and persistent device credential foundation. This enables an ESP32 field node to:

1. Receive a one-time Device Enrollment bootstrap bundle during protected provisioning
2. Exchange the Enrollment Token for a Device Credential via HTTPS
3. Persist the Device Credential in NVS for use across reboots
4. Use the persisted credential for authenticated telemetry via HTTP header `x-device-key` (raw credential over HTTPS, hashed server-side before verification; **NOT HMAC**)

> [!WARNING]
> GasGuard cloud HTTPS enrollment endpoint is **NOT deployed yet**.
> Maturity: **HTTPS ENROLLMENT CLIENT SOURCE IMPLEMENTED — LIVE CLOUD ENDPOINT NOT TESTED**
> Memory Clearing: **BEST-EFFORT ONLY** (Arduino String heap allocation; heap copies may remain).
> Re-enrollment Status: **RE-ENROLLMENT RUNTIME NOT PHYSICALLY VERIFIED**. Reopening protected bootstrap session (`requestDeviceEnrollmentProvisioning`) without clearing Wi-Fi is structured in source, but exact physical re-entry depends on toolchain runtime behavior.
> Firmware Compile & Physical Hardware: **FIRMWARE COMPILE = NOT TESTED**, **PHYSICAL HARDWARE = NOT TESTED**

---

## Credential Separation

| Credential | Purpose | Storage | ESP32 Persistence |
|---|---|---|---|
| Wi-Fi Password | STA network access | Wi-Fi NVS partition | Yes (managed by Wi-Fi stack) |
| Provisioning PoP | SoftAP session auth | Compiled config | No (compile-time only) |
| Enrollment Token | One-time device claim | **RAM only** | **NEVER** |
| Device Credential | Telemetry authentication | NVS `gg-auth` namespace | Yes (after enrollment) |
| Owner Invitation Token | Human site owner auth | Server-side only | Never on ESP32 |
| Supabase service key | Server DB access | Server `.env` only | **NEVER** on ESP32 |

> [!CAUTION]
> The Enrollment Token is held in volatile RAM only. It is **never** persisted to NVS, filesystem, Serial, diagnostics, telemetry, or crash output.

---

## Technician Enrollment Workflow

```
1. Technician connects to GasGuard protected provisioning service
   └── SoftAP: PROV_GG_<MAC suffix>

2. Establish Security 1 session using device-specific PoP
   └── X25519 key exchange + AES-CTR encryption

3. Send Device UID + Enrollment Token through 'gasguard-enroll' custom endpoint
   └── Payload: {"deviceUid":"...","enrollmentToken":"<64 hex>"}
   └── Response: {"ok":true,"code":"ENROLLMENT_BOOTSTRAP_ACCEPTED"}
   └── Token is NEVER echoed back

4. Provision Wi-Fi credentials (standard provisioning flow)
   └── SSID + password through encrypted session

5. Device connects to Wi-Fi
   └── Obtains IP, configures NTP

6. Device calls GasGuard HTTPS enrollment API
   └── POST https://<enrollment-url>/api/v1/device/enroll
   └── Body: {"enrollmentToken":"...","deviceUid":"..."}
   └── Success: HTTP 201 with Device Credential
   └── Token destroyed from RAM after POST

7. Device persists credential to NVS
   └── Write + read-back verification
   └── Transitions to CONNECTING_INGRESS
```

> [!IMPORTANT]
> Steps 3 and 4 **must** occur in this order. The custom endpoint exchange must happen before the Wi-Fi provisioning service stops. Do NOT reverse steps 3 and 4 unless the provisioning runtime is explicitly configured to keep the service alive.

---

## Custom Provisioning Endpoint

| Property | Value |
|---|---|
| Name | `gasguard-enroll` |
| Created | After `network_prov_mgr_init()`, before `network_prov_mgr_start_provisioning()` |
| Handler registered | After `network_prov_mgr_start_provisioning()` succeeds |
| Security | Carried inside Security 1 encrypted session |
| Input | `{"deviceUid":"...","enrollmentToken":"<64 hex>"}` |
| Output | `{"ok":true,"code":"ENROLLMENT_BOOTSTRAP_ACCEPTED"}` |

**Custom endpoint compile status:** Depends on `USE_CURRENT_NET_PROV_API` build flag. If exact API headers are not available, source is compile-gated with: `CUSTOM ENDPOINT COMPILE = NOT TESTED`.

---

## HTTPS Enrollment Client

### Request

```
POST /api/v1/device/enroll
Content-Type: application/json

{
  "enrollmentToken": "<64 hex one-time token>",
  "deviceUid": "<server-assigned device UID>"
}
```

### Success Response (HTTP 201)

```json
{
  "ok": true,
  "deviceUid": "...",
  "deviceCredential": "<64 hex>",
  "lifecycle": "commissioning"
}
```

### Security Requirements

- **HTTPS only**: Plain `http://` URLs are rejected (`ENROLL_URL_NOT_HTTPS`)
- **TLS trust anchor required**: `GASGUARD_ENROLLMENT_CA_CERT` must be configured
- **No `setInsecure()`**: Certificate verification is never disabled
- **One claim attempt**: Per bootstrap token, after HTTPS connection established

---

## Response-Loss Limitation

> [!WARNING]
> **Device credential claim is one-time.** If the server commits the claim but the ESP32 loses the response before persisting the credential:
> - The Enrollment Token is already consumed
> - The ESP32 cannot re-claim with the same token
> - Result: `ENROLLMENT_RESULT_UNKNOWN`
> - **Recovery requires technician intervention** (credential revocation + new enrollment)

Conservative V1 policy:
- One POST attempt per bootstrap token after HTTPS connection established
- Ambiguous results (connection failure after possible server commit) → `ENROLLMENT_RESULT_UNKNOWN`
- No blind retry of POST after ambiguous outcome
- `ENROLLMENT_ALREADY_CLAIMED` (HTTP 409) is terminal

---

## NVS Credential Persistence

### Store

| Property | Value |
|---|---|
| API | Arduino `Preferences` |
| Namespace | `gg-auth` (≤15 chars) |
| Key: Device UID | `dev-uid` (≤15 chars) |
| Key: Device Credential | `dev-cred` (≤15 chars) |

### Write-Verify Pattern

1. Open Preferences read-write
2. Write Device UID and Device Credential
3. Close
4. Re-open read-only
5. Read-back both values
6. Constant-time comparison for credential verification
7. If mismatch → `CREDENTIAL_STORAGE_ERROR`

### NVS Encryption Status

> [!IMPORTANT]
> Credentials are **PERSISTED IN NVS**. This is **NOT** hardware secure storage.
> NVS encryption is **NOT YET VERIFIED** for this build target.
> Do not claim "encrypted at rest" unless NVS encryption or flash encryption is independently verified and enabled.

---

## Credential Reset Separation

| Operation | Clears | Preserves |
|---|---|---|
| `clearDeviceCredentials()` | Device UID, Device Credential | Wi-Fi credentials, PoP, all other NVS |
| `requestWiFiProvisioningReset()` | Wi-Fi STA SSID/password | Device Credential, Device Identity |

- `nvs_flash_erase()` is **NEVER** called
- Wi-Fi reset and credential reset are completely independent operations

---

## Enrollment State Machine

```
Wi-Fi connected + no persisted credential + no bootstrap token
  → DEVICE_ENROLLMENT_REQUIRED

Wi-Fi connected + valid bootstrap token in RAM
  → ENROLLING_DEVICE

Successful server claim (HTTP 201) + credential persisted
  → clear enrollment token from RAM
  → CONNECTING_INGRESS

Server rejection (HTTP 4xx except 409)
  → DEVICE_ENROLLMENT_FAILED

Already claimed (HTTP 409)
  → DEVICE_ENROLLMENT_FAILED (terminal, no retry)

Ambiguous result (connection loss after POST)
  → DEVICE_ENROLLMENT_FAILED (ENROLLMENT_RESULT_UNKNOWN)

Credential storage failure
  → CREDENTIAL_STORAGE_ERROR
```

---

## Firmware Compile Maturity

| Component | Status |
|---|---|
| Device credential store | SOURCE IMPLEMENTED |
| HTTPS enrollment client | SOURCE IMPLEMENTED |
| Custom provisioning endpoint | SOURCE IMPLEMENTED |
| TLS trust configuration | NOT CONFIGURED (no CA cert embedded) |
| Cloud enrollment endpoint | NOT DEPLOYED |
| Firmware compile | **FIRMWARE COMPILE = NOT TESTED** |
| Physical flash/test | **PHYSICAL HARDWARE = NOT TESTED** |

---

## Telemetry Authentication & Security Notes

- **Header**: `x-device-key: <Device Credential>` (HTTP Header over TLS)
- **Authentication Model**: Raw Device Credential transported over HTTPS, verified server-side via SHA-256 database lookup (**NOT HMAC**).
- **Memory Clearing**: All RAM clearing (`bestEffortClearSecret`) on Arduino String heap is **BEST-EFFORT ONLY**.
- **Re-enrollment**: `clearDeviceCredentials()` clears NVS credentials without erasing Wi-Fi. Re-enrollment requires explicit protected provisioning entry (`requestDeviceEnrollmentProvisioning`); re-enrollment runtime is **NOT PHYSICALLY VERIFIED**.

---

## Cloud Endpoint Status

The GasGuard cloud HTTPS enrollment endpoint (`/api/v1/device/enroll`) is **NOT deployed yet**. The firmware enrollment client source is implemented and ready, but live physical enrollment cannot be tested until the cloud endpoint is deployed and a valid TLS trust anchor is configured.

---

## Next Steps

**HW-3C2B**: Technician Provisioning Client Contract & Physical Firmware Compile Readiness
