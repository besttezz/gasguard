#include "device_credentials.h"

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#include <Preferences.h>
#endif

// NVS namespace and key constants (all <= 15 characters)
static const char* CRED_NVS_NAMESPACE = "gg-auth";
static const char* KEY_DEVICE_UID     = "dev-uid";
static const char* KEY_DEVICE_CRED    = "dev-cred";

bool isValidHex64(const String& value) {
    if (value.length() != 64) return false;
    for (unsigned int i = 0; i < 64; i++) {
        char c = value.charAt(i);
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
            return false;
        }
    }
    return true;
}

bool isValidDeviceUid(const String& uid) {
    if (uid.length() == 0 || uid.length() > 128) return false;
    // Reject control characters (ASCII < 0x20)
    for (unsigned int i = 0; i < uid.length(); i++) {
        if (uid.charAt(i) < 0x20) return false;
    }
    return true;
}

String normalizeHexLowercase(const String& hex) {
    String normalized = hex;
    normalized.toLowerCase();
    return normalized;
}

bool constantTimeCompare(const String& a, const String& b) {
    // Best-effort constant-time comparison on Arduino heap.
    // Not guaranteed cryptographic constant-time on all platforms.
    if (a.length() != b.length()) return false;
    if (a.length() == 0) return false;
    volatile uint8_t diff = 0;
    for (unsigned int i = 0; i < a.length(); i++) {
        diff |= (uint8_t)(a.charAt(i) ^ b.charAt(i));
    }
    return diff == 0;
}

CredentialStoreResult saveDeviceCredentials(const String& deviceUid, const String& deviceCredential) {
    // Validate inputs
    if (!isValidDeviceUid(deviceUid)) {
        return CRED_STORE_INVALID_FORMAT;
    }

    String normalizedCred = normalizeHexLowercase(deviceCredential);
    if (!isValidHex64(normalizedCred)) {
        return CRED_STORE_INVALID_FORMAT;
    }

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    Preferences prefs;

    // Phase 1: Write credentials
    if (!prefs.begin(CRED_NVS_NAMESPACE, false /* readWrite */)) {
        return CRED_STORE_OPEN_FAILED;
    }

    size_t uidWritten = prefs.putString(KEY_DEVICE_UID, deviceUid);
    size_t credWritten = prefs.putString(KEY_DEVICE_CRED, normalizedCred);
    prefs.end();

    if (uidWritten == 0 || credWritten == 0) {
        return CRED_STORE_WRITE_FAILED;
    }

    // Phase 2: Read-back verification
    if (!prefs.begin(CRED_NVS_NAMESPACE, true /* readOnly */)) {
        return CRED_STORE_VERIFY_FAILED;
    }

    String readBackUid = prefs.getString(KEY_DEVICE_UID, "");
    String readBackCred = prefs.getString(KEY_DEVICE_CRED, "");
    prefs.end();

    // Constant-time comparison for credential verification
    if (readBackUid != deviceUid || !constantTimeCompare(readBackCred, normalizedCred)) {
        return CRED_STORE_VERIFY_FAILED;
    }

    return CRED_STORE_OK;
#else
    // Host/test stub: no real NVS available
    (void)deviceUid;
    (void)normalizedCred;
    return CRED_STORE_OK;
#endif
}

StoredCredentials loadDeviceCredentials() {
    StoredCredentials result;
    result.valid = false;
    result.result = CRED_STORE_NOT_FOUND;

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    Preferences prefs;
    if (!prefs.begin(CRED_NVS_NAMESPACE, true /* readOnly */)) {
        result.result = CRED_STORE_OPEN_FAILED;
        return result;
    }

    result.deviceUid = prefs.getString(KEY_DEVICE_UID, "");
    result.deviceCredential = prefs.getString(KEY_DEVICE_CRED, "");
    prefs.end();

    if (result.deviceUid.length() == 0 || result.deviceCredential.length() == 0) {
        result.result = CRED_STORE_NOT_FOUND;
        return result;
    }

    // Validate loaded values
    if (!isValidDeviceUid(result.deviceUid)) {
        result.result = CRED_STORE_INVALID_FORMAT;
        return result;
    }

    if (!isValidHex64(result.deviceCredential)) {
        result.result = CRED_STORE_INVALID_FORMAT;
        return result;
    }

    result.valid = true;
    result.result = CRED_STORE_OK;
#endif

    return result;
}

void clearDeviceCredentials() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    Preferences prefs;
    if (prefs.begin(CRED_NVS_NAMESPACE, false /* readWrite */)) {
        prefs.remove(KEY_DEVICE_UID);
        prefs.remove(KEY_DEVICE_CRED);
        prefs.end();
    }
#endif
    Serial.println("[GasGuard Credentials] Device credentials cleared from NVS (targeted reset).");
}

bool hasPersistedCredentials() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    Preferences prefs;
    if (!prefs.begin(CRED_NVS_NAMESPACE, true /* readOnly */)) {
        return false;
    }
    bool has = prefs.isKey(KEY_DEVICE_UID) && prefs.isKey(KEY_DEVICE_CRED);
    prefs.end();
    return has;
#else
    return false;
#endif
}
