#ifndef GASGUARD_DEVICE_ENROLLMENT_CLIENT_H
#define GASGUARD_DEVICE_ENROLLMENT_CLIENT_H

#include <Arduino.h>

// =============================================================================
// GASGUARD ESP32 HTTPS DEVICE ENROLLMENT CLIENT
//
// Handles one-time device enrollment with the GasGuard cloud enrollment endpoint.
//
// Flow:
//   1. ESP32 receives Device UID + Enrollment Token via provisioning custom endpoint
//   2. After Wi-Fi connection, ESP32 POSTs to HTTPS enrollment endpoint
//   3. Server returns Device Credential (exactly once)
//   4. Client persists credential in NVS
//   5. Enrollment Token is destroyed from RAM
//
// SECURITY:
//   - HTTPS ONLY (plain HTTP rejected for production enrollment)
//   - TLS trust anchor must be configured (insecure TLS forbidden)
//   - Enrollment Token held in RAM only (never persisted, logged, or transmitted
//     via Serial or diagnostics)
//   - One claim attempt per bootstrap token after HTTPS connection established
//   - Response-loss results in ENROLLMENT_RESULT_UNKNOWN (requires technician)
//
// MATURITY:
//   - HTTPS ENROLLMENT CLIENT SOURCE IMPLEMENTED
//   - LIVE CLOUD ENDPOINT NOT TESTED
//   - TLS_TRUST_NOT_CONFIGURED unless CA cert is provided
// =============================================================================

// Enrollment URL configuration
#ifndef GASGUARD_ENROLLMENT_URL
#define GASGUARD_ENROLLMENT_URL ""
#endif

// TLS CA certificate for enrollment endpoint trust anchor.
// Must be configured before production enrollment.
// Do NOT embed random or invented certificates.
#ifndef GASGUARD_ENROLLMENT_CA_CERT
#define GASGUARD_ENROLLMENT_CA_CERT ""
#endif

// Enrollment result codes (safe for diagnostics)
enum EnrollmentResultCode {
    ENROLL_SUCCESS = 0,
    ENROLL_TOKEN_MISSING = 1,
    ENROLL_TOKEN_INVALID_FORMAT = 2,
    ENROLL_URL_MISSING = 3,
    ENROLL_URL_NOT_HTTPS = 4,
    ENROLL_TLS_TRUST_NOT_CONFIGURED = 5,
    ENROLL_HTTP_CONNECTION_FAILED = 6,
    ENROLL_HTTP_ERROR = 7,
    ENROLL_RESPONSE_PARSE_ERROR = 8,
    ENROLL_RESPONSE_DEVICE_UID_MISMATCH = 9,
    ENROLL_RESPONSE_CREDENTIAL_INVALID = 10,
    ENROLL_ALREADY_CLAIMED = 11,
    ENROLL_RESULT_UNKNOWN = 12,
    ENROLL_CREDENTIAL_STORE_ERROR = 13,
    ENROLL_SERVER_REJECTED = 14
};

const char* enrollmentResultToString(EnrollmentResultCode code);

struct EnrollmentResult {
    EnrollmentResultCode code;
    String deviceUid;          // Confirmed device UID from server (safe for diagnostics)
    String lifecycle;          // Lifecycle status from server (safe for diagnostics)
    int httpStatus;            // Last HTTP status code (safe for diagnostics)
    bool credentialPersisted;  // Whether credential was successfully stored in NVS
    // NOTE: Device Credential is NEVER stored in this struct.
    //       It flows directly from HTTP response → NVS persistence.
};

// Validate enrollment URL: must be https:// for production
bool isValidEnrollmentUrl(const String& url);

// Check if TLS trust anchor is configured
bool isTlsTrustConfigured();

// Perform device enrollment against HTTPS endpoint.
// - enrollmentToken: RAM-only one-time token (cleared after use)
// - deviceUid: server-assigned device UID
// - enrollmentUrl: HTTPS enrollment endpoint URL
//
// On success: persists credential in NVS, returns ENROLL_SUCCESS.
// On failure: returns appropriate error code.
// Enrollment Token is best-effort cleared from the input String after use.
//
// IMPORTANT: One claim POST attempt per bootstrap token.
// Ambiguous results (connection loss after possible server commit)
// result in ENROLL_RESULT_UNKNOWN, requiring technician recovery.
EnrollmentResult performDeviceEnrollment(
    String& enrollmentToken,  // Mutable: will be cleared after use
    const String& deviceUid,
    const String& enrollmentUrl
);

// Best-effort clearing of a secret String buffer.
// Does NOT guarantee cryptographic erasure on Arduino heap.
void bestEffortClearSecret(String& secret);

#endif // GASGUARD_DEVICE_ENROLLMENT_CLIENT_H
