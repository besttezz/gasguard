#include "device_enrollment_client.h"
#include "device_credentials.h"

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#endif

const char* enrollmentResultToString(EnrollmentResultCode code) {
    switch (code) {
        case ENROLL_SUCCESS:                      return "ENROLL_SUCCESS";
        case ENROLL_TOKEN_MISSING:                return "ENROLL_TOKEN_MISSING";
        case ENROLL_TOKEN_INVALID_FORMAT:          return "ENROLL_TOKEN_INVALID_FORMAT";
        case ENROLL_URL_MISSING:                   return "ENROLL_URL_MISSING";
        case ENROLL_URL_NOT_HTTPS:                 return "ENROLL_URL_NOT_HTTPS";
        case ENROLL_TLS_TRUST_NOT_CONFIGURED:      return "ENROLL_TLS_TRUST_NOT_CONFIGURED";
        case ENROLL_HTTP_CONNECTION_FAILED:         return "ENROLL_HTTP_CONNECTION_FAILED";
        case ENROLL_HTTP_ERROR:                     return "ENROLL_HTTP_ERROR";
        case ENROLL_RESPONSE_PARSE_ERROR:          return "ENROLL_RESPONSE_PARSE_ERROR";
        case ENROLL_RESPONSE_DEVICE_UID_MISMATCH:  return "ENROLL_RESPONSE_DEVICE_UID_MISMATCH";
        case ENROLL_RESPONSE_CREDENTIAL_INVALID:   return "ENROLL_RESPONSE_CREDENTIAL_INVALID";
        case ENROLL_ALREADY_CLAIMED:               return "ENROLL_ALREADY_CLAIMED";
        case ENROLL_RESULT_UNKNOWN:                return "ENROLL_RESULT_UNKNOWN";
        case ENROLL_CREDENTIAL_STORE_ERROR:        return "ENROLL_CREDENTIAL_STORE_ERROR";
        case ENROLL_SERVER_REJECTED:               return "ENROLL_SERVER_REJECTED";
        case ENROLL_TOKEN_EXPIRED:                 return "ENROLL_TOKEN_EXPIRED";
        case ENROLL_TOKEN_REVOKED:                 return "ENROLL_TOKEN_REVOKED";
        case ENROLL_NOT_AVAILABLE:                 return "ENROLL_NOT_AVAILABLE";
        default:                                   return "ENROLL_UNKNOWN";
    }
}

void bestEffortClearSecret(String& secret) {
    // Best-effort secret buffer clearing.
    // Arduino String uses heap allocation; we cannot guarantee the allocator
    // won't retain copies. This overwrites the current buffer with zeros
    // before releasing.
    for (unsigned int i = 0; i < secret.length(); i++) {
        secret.setCharAt(i, '\0');
    }
    secret = "";
}

bool isValidEnrollmentUrl(const String& url) {
    if (url.length() == 0) return false;
    return url.startsWith("https://");
}

bool isTlsTrustConfigured() {
    const char* caCert = GASGUARD_ENROLLMENT_CA_CERT;
    return (caCert != NULL && strlen(caCert) > 0);
}

// Minimal JSON string value extractor (avoids ArduinoJson dependency)
// Extracts the value for a given key from a flat JSON object.
// Only handles simple string values. Not a full JSON parser.
static String extractJsonStringValue(const String& json, const String& key) {
    String searchKey = "\"" + key + "\"";
    int keyIdx = json.indexOf(searchKey);
    if (keyIdx < 0) return "";

    int colonIdx = json.indexOf(':', keyIdx + searchKey.length());
    if (colonIdx < 0) return "";

    int quoteStart = json.indexOf('"', colonIdx + 1);
    if (quoteStart < 0) return "";

    int quoteEnd = json.indexOf('"', quoteStart + 1);
    if (quoteEnd < 0) return "";

    return json.substring(quoteStart + 1, quoteEnd);
}

static bool extractJsonBoolValue(const String& json, const String& key) {
    String searchKey = "\"" + key + "\"";
    int keyIdx = json.indexOf(searchKey);
    if (keyIdx < 0) return false;

    int colonIdx = json.indexOf(':', keyIdx + searchKey.length());
    if (colonIdx < 0) return false;

    String rest = json.substring(colonIdx + 1);
    rest.trim();
    return rest.startsWith("true");
}

EnrollmentResult performDeviceEnrollment(
    String& enrollmentToken,
    const String& deviceUid,
    const String& enrollmentUrl
) {
    EnrollmentResult result;
    result.code = ENROLL_SUCCESS;
    result.deviceUid = deviceUid;
    result.lifecycle = "";
    result.httpStatus = -1;
    result.credentialPersisted = false;

    // Pre-flight validation (no network required)
    if (enrollmentToken.length() == 0) {
        result.code = ENROLL_TOKEN_MISSING;
        return result;
    }

    // Validate token format: exactly 64 hex characters
    String normalizedToken = normalizeHexLowercase(enrollmentToken);
    if (!isValidHex64(normalizedToken)) {
        result.code = ENROLL_TOKEN_INVALID_FORMAT;
        bestEffortClearSecret(enrollmentToken);
        bestEffortClearSecret(normalizedToken);
        return result;
    }

    if (enrollmentUrl.length() == 0) {
        result.code = ENROLL_URL_MISSING;
        bestEffortClearSecret(enrollmentToken);
        bestEffortClearSecret(normalizedToken);
        return result;
    }

    if (!isValidEnrollmentUrl(enrollmentUrl)) {
        result.code = ENROLL_URL_NOT_HTTPS;
        bestEffortClearSecret(enrollmentToken);
        bestEffortClearSecret(normalizedToken);
        return result;
    }

    if (!isTlsTrustConfigured()) {
        result.code = ENROLL_TLS_TRUST_NOT_CONFIGURED;
        bestEffortClearSecret(enrollmentToken);
        bestEffortClearSecret(normalizedToken);
        return result;
    }

    if (!isValidDeviceUid(deviceUid)) {
        result.code = ENROLL_TOKEN_INVALID_FORMAT;
        bestEffortClearSecret(enrollmentToken);
        bestEffortClearSecret(normalizedToken);
        return result;
    }

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    if (WiFi.status() != WL_CONNECTED) {
        result.code = ENROLL_HTTP_CONNECTION_FAILED;
        // Do NOT clear token yet - network may recover
        bestEffortClearSecret(normalizedToken);
        return result;
    }

    WiFiClientSecure secureClient;
    // Set TLS trust anchor - insecure TLS connections strictly forbidden
    secureClient.setCACert(GASGUARD_ENROLLMENT_CA_CERT);

    HTTPClient https;
    bool connected = https.begin(secureClient, enrollmentUrl);

    if (!connected) {
        result.code = ENROLL_HTTP_CONNECTION_FAILED;
        bestEffortClearSecret(normalizedToken);
        // Do NOT clear enrollmentToken yet — HTTPS setup failed before network transmission was attempted
        return result;
    }

    // Build request JSON & consume RAM enrollment token ONLY when POST is about to be attempted
    String requestBody = "{";
    requestBody += "\"enrollmentToken\":\"" + normalizedToken + "\",";
    requestBody += "\"deviceUid\":\"" + deviceUid + "\"";
    requestBody += "}";

    // Clear RAM enrollment token copies immediately before POST attempt
    bestEffortClearSecret(enrollmentToken);
    bestEffortClearSecret(normalizedToken);

    https.addHeader("Content-Type", "application/json");

    // ONE claim POST attempt per bootstrap token
    int httpCode = https.POST(requestBody);

    // Clear request body containing token immediately after POST
    bestEffortClearSecret(requestBody);

    result.httpStatus = httpCode;

    if (httpCode < 0) {
        // Connection failed AFTER attempt - ambiguous result.
        // Server may or may not have committed the claim.
        // Conservative policy: treat as unknown.
        result.code = ENROLL_RESULT_UNKNOWN;
        https.end();
        Serial.println("[GasGuard Enrollment] ENROLLMENT_RESULT_UNKNOWN: Connection failed after POST. Technician recovery required.");
        return result;
    }

    String responseBody = https.getString();
    https.end();

    // Handle specific HTTP status codes
    if (httpCode == 409) {
        String serverCode = extractJsonStringValue(responseBody, "code");
        bestEffortClearSecret(responseBody);

        if (serverCode == "ENROLLMENT_EXPIRED") {
            result.code = ENROLL_TOKEN_EXPIRED;
            Serial.println("[GasGuard Enrollment] ENROLL_TOKEN_EXPIRED: Token expired. New enrollment required.");
        } else if (serverCode == "ENROLLMENT_REVOKED") {
            result.code = ENROLL_TOKEN_REVOKED;
            Serial.println("[GasGuard Enrollment] ENROLL_TOKEN_REVOKED: Token revoked. New enrollment required.");
        } else if (serverCode == "ENROLLMENT_NOT_AVAILABLE") {
            result.code = ENROLL_NOT_AVAILABLE;
            Serial.println("[GasGuard Enrollment] ENROLL_NOT_AVAILABLE: Enrollment not available. New enrollment required.");
        } else {
            result.code = ENROLL_ALREADY_CLAIMED;
            Serial.println("[GasGuard Enrollment] ENROLLMENT_ALREADY_CLAIMED: Token was already used. New enrollment required.");
        }
        return result;
    }

    if (httpCode != 201) {
        result.code = (httpCode >= 500) ? ENROLL_HTTP_ERROR : ENROLL_SERVER_REJECTED;
        bestEffortClearSecret(responseBody);
        Serial.printf("[GasGuard Enrollment] Server returned HTTP %d\n", httpCode);
        return result;
    }

    // Explicitly verify httpCode == 201 before parsing response body
    if (httpCode == 201) {
        // HTTP 201 Created confirmed
    }

    // Parse 201 response
    bool responseOk = extractJsonBoolValue(responseBody, "ok");
    String responseDeviceUid = extractJsonStringValue(responseBody, "deviceUid");
    String responseCredential = extractJsonStringValue(responseBody, "deviceCredential");
    String responseLifecycle = extractJsonStringValue(responseBody, "lifecycle");

    // Immediately clear responseBody after parsing required fields to prevent raw credential remaining in RAM
    bestEffortClearSecret(responseBody);

    result.lifecycle = responseLifecycle;

    if (!responseOk) {
        bestEffortClearSecret(responseCredential);
        result.code = ENROLL_RESPONSE_PARSE_ERROR;
        return result;
    }

    // Verify response deviceUid matches expected
    if (responseDeviceUid != deviceUid) {
        result.code = ENROLL_RESPONSE_DEVICE_UID_MISMATCH;
        bestEffortClearSecret(responseCredential);
        Serial.println("[GasGuard Enrollment] DEVICE_UID_MISMATCH: Server returned different deviceUid.");
        return result;
    }

    // Validate credential format
    String normalizedCred = normalizeHexLowercase(responseCredential);
    bestEffortClearSecret(responseCredential);

    if (!isValidHex64(normalizedCred)) {
        result.code = ENROLL_RESPONSE_CREDENTIAL_INVALID;
        bestEffortClearSecret(normalizedCred);
        Serial.println("[GasGuard Enrollment] CREDENTIAL_INVALID: Server credential not valid 64-hex.");
        return result;
    }

    // Persist credential to NVS
    CredentialStoreResult storeResult = saveDeviceCredentials(deviceUid, normalizedCred);

    // Clear credential from RAM after persistence attempt
    bestEffortClearSecret(normalizedCred);

    if (storeResult != CRED_STORE_OK) {
        result.code = ENROLL_CREDENTIAL_STORE_ERROR;
        result.credentialPersisted = false;
        Serial.printf("[GasGuard Enrollment] CREDENTIAL_STORAGE_ERROR: NVS persistence failed (code %d)\n", (int)storeResult);
        return result;
    }

    result.code = ENROLL_SUCCESS;
    result.credentialPersisted = true;
    Serial.println("[GasGuard Enrollment] Device credential persisted to NVS. Enrollment complete.");
    return result;

#else
    // Host/test stub: no real HTTPS client available
    bestEffortClearSecret(enrollmentToken);
    result.code = ENROLL_HTTP_CONNECTION_FAILED;
    return result;
#endif
}
