#ifndef GASGUARD_DEVICE_CREDENTIALS_H
#define GASGUARD_DEVICE_CREDENTIALS_H

#include <Arduino.h>

// =============================================================================
// GASGUARD DEVICE CREDENTIAL PERSISTENT STORE
//
// Uses ESP32 Preferences (NVS) to persist:
//   - Device UID (server-assigned GasGuard device identity)
//   - Device Credential (64-hex server-issued authentication key)
//
// SECURITY NOTES:
//   - Credentials are PERSISTED IN NVS (not hardware secure storage).
//   - NVS encryption is NOT YET VERIFIED for this build target.
//   - Do NOT claim "encrypted at rest" unless NVS encryption or flash
//     encryption is independently verified and enabled.
//   - Enrollment Token is NEVER persisted here (RAM only).
//   - PoP, Wi-Fi password, and Supabase keys are NEVER stored here.
//
// Namespace: "gg-auth" (max 15 chars for Preferences namespace)
// Keys:      "dev-uid", "dev-cred" (max 15 chars each)
// =============================================================================

// Credential store result codes
enum CredentialStoreResult {
    CRED_STORE_OK = 0,
    CRED_STORE_WRITE_FAILED = 1,
    CRED_STORE_VERIFY_FAILED = 2,
    CRED_STORE_INVALID_FORMAT = 3,
    CRED_STORE_OPEN_FAILED = 4,
    CRED_STORE_NOT_FOUND = 5
};

struct StoredCredentials {
    String deviceUid;
    String deviceCredential;
    bool valid;
    CredentialStoreResult result;
};

// Validate that a string is exactly 64 lowercase hexadecimal characters
bool isValidHex64(const String& value);

// Validate a Device UID: non-empty, bounded length, no control characters
bool isValidDeviceUid(const String& uid);

// Normalize a hex string to lowercase
String normalizeHexLowercase(const String& hex);

// Save Device UID + Device Credential to NVS Preferences.
// Validates format, writes, then re-reads to verify persistence.
// Returns CRED_STORE_OK on success.
CredentialStoreResult saveDeviceCredentials(const String& deviceUid, const String& deviceCredential);

// Load Device UID + Device Credential from NVS Preferences.
// Returns valid=true only if both are present and well-formed.
StoredCredentials loadDeviceCredentials();

// Clear ONLY Device UID + Device Credential from NVS.
// Does NOT erase Wi-Fi credentials, PoP, or unrelated Preferences.
// Does NOT call nvs_flash_erase().
void clearDeviceCredentials();

// Check if credentials are currently persisted (quick check without full load)
bool hasPersistedCredentials();

// Constant-time comparison for credential verification (best-effort on Arduino)
bool constantTimeCompare(const String& a, const String& b);

#endif // GASGUARD_DEVICE_CREDENTIALS_H
