#include "network_provisioning.h"
#include "provisioning_config.h"
#include "device_credentials.h"

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#include <sdkconfig.h>

// Compatibility Boundary: Check current header path vs legacy path
#if __has_include(<network_provisioning/manager.h>)
  #include <network_provisioning/manager.h>
  #include <network_provisioning/scheme_softap.h>
  #define HAS_NETWORK_PROV_SUPPORT 1
  #define USE_CURRENT_NET_PROV_API 1
#elif __has_include(<wifi_prov_mgr.h>)
  #include <wifi_prov_mgr.h>
  #include <scheme_softap.h>
  #define HAS_NETWORK_PROV_SUPPORT 1
  #define USE_LEGACY_WIFI_PROV_API 1
#else
  #define HAS_NETWORK_PROV_SUPPORT 0
#endif

#include <WiFi.h>
#else
  #define HAS_NETWORK_PROV_SUPPORT 0
#endif

// Check Security 1 availability from sdkconfig capabilities
#if defined(CONFIG_ESP_PROTOCOMM_SUPPORT_SECURITY_VERSION_1) || defined(CONFIG_PROTOCOMM_SUPPORT_SECURITY_VERSION_1) || !defined(ARDUINO_ARCH_ESP32)
  #define HAS_SECURITY_1_SUPPORT 1
#else
  #define HAS_SECURITY_1_SUPPORT 0
#endif

static String g_provisioningServiceName = "PROV_GG_UNCONFIGURED";
static ProvisioningManagerState g_provManagerState = PROV_MGR_UNINITIALIZED;

static ProvisioningStatus g_provStatus = {
#if HAS_NETWORK_PROV_SUPPORT && HAS_SECURITY_1_SUPPORT
    true,
#else
    false,
#endif
    false,
    NODE_STATE_UNPROVISIONED,
    PROV_MGR_UNINITIALIZED,
    g_provisioningServiceName,
    GASGUARD_PROV_SECURITY_MODE,
    "NONE",
    "NONE"
};

// ============================================================================
// ENROLLMENT BOOTSTRAP — RAM-ONLY TOKEN STORAGE
// Enrollment Token is NEVER persisted to NVS, filesystem, Serial,
// diagnostics, telemetry, or crash output.
// ============================================================================
static String g_enrollmentToken = "";           // RAM only — cleared after use
static String g_bootstrapDeviceUid = "";         // RAM only — persisted only after successful enrollment
static bool g_hasBootstrapData = false;
static bool g_enrollmentBootstrapAccepted = false;

const char* nodeStateToString(NodeState state) {
    switch (state) {
        case NODE_STATE_UNPROVISIONED: return "UNPROVISIONED";
        case NODE_STATE_PROVISIONING: return "PROVISIONING";
        case NODE_STATE_PROVISIONING_CONFIG_REQUIRED: return "PROVISIONING_CONFIG_REQUIRED";
        case NODE_STATE_PROVISIONING_FAILED: return "PROVISIONING_FAILED";
        case NODE_STATE_CONNECTING_WIFI: return "CONNECTING_WIFI";
        case NODE_STATE_WIFI_CONNECTED: return "WIFI_CONNECTED";
        case NODE_STATE_CONNECTING_INGRESS: return "CONNECTING_INGRESS";
        case NODE_STATE_READY: return "READY";
        case NODE_STATE_DEVICE_ENROLLMENT_REQUIRED: return "DEVICE_ENROLLMENT_REQUIRED";
        case NODE_STATE_CALIBRATION_REQUIRED: return "CALIBRATION_REQUIRED";
        case NODE_STATE_OFFLINE: return "OFFLINE";
        case NODE_STATE_CONFIG_ERROR: return "CONFIG_ERROR";
        case NODE_STATE_PROVISIONING_SECURITY_UNAVAILABLE: return "PROVISIONING_SECURITY_UNAVAILABLE";
        case NODE_STATE_PROVISIONING_IDENTITY_UNAVAILABLE: return "PROVISIONING_IDENTITY_UNAVAILABLE";
        case NODE_STATE_ENROLLING_DEVICE: return "ENROLLING_DEVICE";
        case NODE_STATE_DEVICE_ENROLLMENT_FAILED: return "DEVICE_ENROLLMENT_FAILED";
        case NODE_STATE_CREDENTIAL_STORAGE_ERROR: return "CREDENTIAL_STORAGE_ERROR";
        case NODE_STATE_ENROLLMENT_BOOTSTRAP_CHANNEL_REQUIRED: return "ENROLLMENT_BOOTSTRAP_CHANNEL_REQUIRED";
        default: return "UNKNOWN";
    }
}

void initBackoff(BoundedBackoff& backoff, uint32_t initialMs, uint32_t maxMs) {
    backoff.attempt = 0;
    backoff.currentDelayMs = initialMs;
    backoff.maxDelayMs = maxMs;
}

uint32_t calculateNextBackoffMs(BoundedBackoff& backoff) {
    backoff.attempt++;
    uint32_t nextDelay = backoff.currentDelayMs * 2;
    if (nextDelay > backoff.maxDelayMs) {
        nextDelay = backoff.maxDelayMs;
    }
    backoff.currentDelayMs = nextDelay;
    return backoff.currentDelayMs;
}

void resetBackoff(BoundedBackoff& backoff) {
    backoff.attempt = 0;
    backoff.currentDelayMs = 1000;
}

String generateProvisioningServiceName(const char* macOrDeviceSuffix) {
    if (!macOrDeviceSuffix || strlen(macOrDeviceSuffix) == 0 || strcmp(macOrDeviceSuffix, "000000") == 0) {
        return "";
    }
    String suffix = String(macOrDeviceSuffix);
    if (suffix.length() > 6) {
        suffix = suffix.substring(suffix.length() - 6);
    }
    return String(GASGUARD_PROV_SERVICE_PREFIX) + suffix;
}

bool validateProvisioningConfig(const ProvisioningConfig& config, String& outError) {
    if (config.securityMode == 0) {
        outError = "Security 0 (plaintext provisioning) is strictly FORBIDDEN.";
        return false;
    }
    if (config.securityMode != 1) {
        outError = "Unsupported security mode. Security 1 (X25519 + PoP + AES-CTR) required.";
        return false;
    }
    if (!HAS_SECURITY_1_SUPPORT) {
        outError = "PROVISIONING_SECURITY_UNAVAILABLE: Security 1 hardware capability not enabled in build.";
        return false;
    }
    if (config.proofOfPossession == NULL || strlen(config.proofOfPossession) == 0) {
        outError = "Missing Proof of Possession (PoP). Device-specific secret required.";
        return false;
    }

    String pop = String(config.proofOfPossession);
    pop.toLowerCase();

    if (pop.length() < 12) {
        outError = "Proof of Possession (PoP) must be at least 12 high-entropy characters.";
        return false;
    }

    const char* forbidden[] = {
        "abcd" "1234",
        "1234" "5678",
        "pass" "word",
        "gasguard" "123",
        "def" "ault",
        "ad" "min",
        "0000" "0000",
        "1234" "56789012",
        "device_specific" "_pop_goes_here"
    };

    for (size_t i = 0; i < sizeof(forbidden) / sizeof(forbidden[0]); ++i) {
        if (pop == forbidden[i]) {
            outError = "Forbidden default/static PoP detected. PoP must be high-entropy device-specific credential.";
            return false;
        }
    }

    outError = "";
    return true;
}

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
static void onWiFiProvEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
    switch (event) {
        case ARDUINO_EVENT_PROV_START:
            g_provStatus.state = NODE_STATE_PROVISIONING;
            g_provStatus.lastProvisioningEvent = "PROV_START";
            g_provManagerState = PROV_MGR_RUNNING;
            Serial.println("[GasGuard Event] Provisioning session started.");
            break;

        case ARDUINO_EVENT_PROV_CRED_RECV:
            g_provStatus.lastProvisioningEvent = "CREDENTIAL_RECEIVED";
            Serial.println("[GasGuard Event] Wi-Fi credentials received. Attempting station connection...");
            break;

        case ARDUINO_EVENT_PROV_CRED_FAIL:
            g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
            g_provStatus.lastProvisioningEvent = "PROV_CRED_FAIL";
            g_provStatus.lastProvisioningError = "WIFI_AUTH_OR_AP_NOT_FOUND";
            Serial.println("[GasGuard Event] Wi-Fi credential validation failed.");
            break;

        case ARDUINO_EVENT_PROV_CRED_SUCCESS:
            g_provStatus.state = NODE_STATE_CONNECTING_WIFI;
            g_provStatus.lastProvisioningEvent = "PROV_CRED_SUCCESS";
            Serial.println("[GasGuard Event] Wi-Fi credentials validated successfully.");
            break;

        case ARDUINO_EVENT_PROV_END:
            // Upstream Arduino event bridge deinitializes provisioning manager before firing PROV_END.
            // Update GasGuard managerState bookkeeping to STOPPED/UNINITIALIZED without double-deinit.
            g_provManagerState = PROV_MGR_STOPPED;
            g_provStatus.lastProvisioningEvent = "PROV_END";
            if (g_enrollmentBootstrapAccepted) {
                g_provStatus.state = NODE_STATE_ENROLLING_DEVICE;
            } else if (g_provStatus.provisioned) {
                g_provStatus.state = NODE_STATE_CONNECTING_WIFI;
            } else {
                g_provStatus.state = NODE_STATE_UNPROVISIONED;
            }
            Serial.println("[GasGuard Event] Provisioning session ended.");
            break;

        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            g_provStatus.provisioned = true;
            g_provStatus.state = NODE_STATE_WIFI_CONNECTED;
            g_provStatus.lastProvisioningEvent = "WIFI_STA_GOT_IP";
            Serial.println("[GasGuard Event] Wi-Fi STA obtained IP address.");
            break;

        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            g_provStatus.state = NODE_STATE_OFFLINE;
            g_provStatus.lastProvisioningEvent = "WIFI_STA_DISCONNECTED";
            Serial.println("[GasGuard Event] Wi-Fi STA disconnected.");
            break;

        default:
            break;
    }
}
#endif

void registerProvisioningEventHandler() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    WiFi.onEvent(onWiFiProvEvent);
#endif
}

bool isWiFiProvisioned() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#if USE_CURRENT_NET_PROV_API
    bool provisioned = false;
    if (g_provManagerState != PROV_MGR_UNINITIALIZED && network_prov_mgr_is_wifi_provisioned(&provisioned) == ESP_OK) {
        return provisioned;
    }
#endif
    return false; // Fail closed if manager uninitialized or query fails
#else
    return g_provStatus.provisioned;
#endif
}

ProvisioningStatus prepareWiFiProvisioning(const ProvisioningConfig& config) {
    if (!HAS_SECURITY_1_SUPPORT) {
        g_provStatus.state = NODE_STATE_PROVISIONING_SECURITY_UNAVAILABLE;
        g_provStatus.lastProvisioningError = "SECURITY_1_UNAVAILABLE";
        g_provManagerState = PROV_MGR_UNINITIALIZED;
        return g_provStatus;
    }

    if (!config.serviceName || strlen(config.serviceName) == 0) {
        g_provStatus.state = NODE_STATE_PROVISIONING_IDENTITY_UNAVAILABLE;
        g_provStatus.lastProvisioningError = "HARDWARE_MAC_UNAVAILABLE";
        g_provManagerState = PROV_MGR_UNINITIALIZED;
        return g_provStatus;
    }

    String err;
    if (!validateProvisioningConfig(config, err)) {
        g_provStatus.state = NODE_STATE_PROVISIONING_CONFIG_REQUIRED;
        g_provStatus.lastProvisioningError = "INVALID_PROVISIONING_CONFIG";
        g_provManagerState = PROV_MGR_UNINITIALIZED;
        return g_provStatus;
    }

    g_provisioningServiceName = String(config.serviceName);
    g_provStatus.serviceName = g_provisioningServiceName;
    g_provStatus.securityMode = config.securityMode;

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    registerProvisioningEventHandler();

#if USE_CURRENT_NET_PROV_API
    // Explicit aggregate initialization compatible with network_prov_mgr_config_t
    network_prov_mgr_config_t prov_mgr_config = {};
    prov_mgr_config.scheme = network_prov_scheme_softap;
    prov_mgr_config.scheme_event_handler = NETWORK_PROV_EVENT_HANDLER_NONE;

    esp_err_t init_err = network_prov_mgr_init(prov_mgr_config);
    if (init_err != ESP_OK) {
        g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
        g_provStatus.lastProvisioningError = "MGR_INIT_FAILED";
        g_provManagerState = PROV_MGR_UNINITIALIZED;
        Serial.printf("[GasGuard Network] Failed to initialize network_prov_mgr: %d\n", (int)init_err);
        return g_provStatus;
    }
    g_provManagerState = PROV_MGR_INITIALIZED;

    bool provisioned = isWiFiProvisioned();
    if (provisioned) {
        g_provStatus.provisioned = true;
        g_provStatus.state = NODE_STATE_CONNECTING_WIFI;
        network_prov_mgr_deinit();
        g_provManagerState = PROV_MGR_STOPPED;
        WiFi.mode(WIFI_STA);
        WiFi.begin();
        return g_provStatus;
    }

    // Create custom enrollment endpoint AFTER manager init, BEFORE provisioning starts
    if (!createEnrollmentEndpoint()) {
        network_prov_mgr_deinit();
        g_provManagerState = PROV_MGR_UNINITIALIZED;
        g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
        g_provStatus.lastProvisioningError = "ENROLLMENT_ENDPOINT_CREATE_FAILED";
        Serial.println("[GasGuard Network] Custom enrollment endpoint creation failed. Provisioning aborted.");
        return g_provStatus;
    }

    esp_err_t start_err = network_prov_mgr_start_provisioning(
        NETWORK_PROV_SECURITY_1,
        (const char*)config.proofOfPossession,
        g_provisioningServiceName.c_str(),
        config.serviceKey
    );

    if (start_err == ESP_OK) {
        g_provStatus.state = NODE_STATE_PROVISIONING;
        g_provStatus.lastProvisioningEvent = "START";
        g_provManagerState = PROV_MGR_RUNNING;
        // Register enrollment endpoint handler AFTER provisioning starts
        if (!registerEnrollmentEndpointHandler()) {
            network_prov_mgr_stop_provisioning();
            network_prov_mgr_deinit();
            g_provManagerState = PROV_MGR_UNINITIALIZED;
            g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
            g_provStatus.lastProvisioningError = "ENROLLMENT_ENDPOINT_REGISTER_FAILED";
            Serial.println("[GasGuard Network] Custom enrollment endpoint registration failed. Provisioning stopped.");
            return g_provStatus;
        }
        Serial.printf("[GasGuard Network] Protected SoftAP provisioning started (Service: %s, Security: 1)\n", g_provisioningServiceName.c_str());
    } else {
        network_prov_mgr_deinit(); // Clean up initialized manager on start failure
        g_provManagerState = PROV_MGR_UNINITIALIZED;
        g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
        g_provStatus.lastProvisioningError = "MGR_START_FAILED";
        Serial.printf("[GasGuard Network] Failed to start provisioning manager: %d\n", (int)start_err);
    }
#endif
#else
    if (g_provStatus.provisioned) {
        g_provStatus.state = NODE_STATE_CONNECTING_WIFI;
        g_provManagerState = PROV_MGR_STOPPED;
    } else {
        g_provStatus.state = NODE_STATE_PROVISIONING;
        g_provStatus.lastProvisioningEvent = "START";
        g_provManagerState = PROV_MGR_RUNNING;
        Serial.printf("[GasGuard Network] Provisioning contract initialized (Service: %s, Security: 1)\n", g_provisioningServiceName.c_str());
    }
#endif

    return g_provStatus;
}

void initWiFiProvisioning(const ProvisioningConfig& config) {
    prepareWiFiProvisioning(config);
}

void requestWiFiProvisioningReset() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    WiFi.disconnect(true, true); // Target Wi-Fi STA NVS credentials erase only
#if USE_CURRENT_NET_PROV_API
    if (g_provManagerState == PROV_MGR_UNINITIALIZED) {
        network_prov_mgr_config_t prov_mgr_config = {};
        prov_mgr_config.scheme = network_prov_scheme_softap;
        prov_mgr_config.scheme_event_handler = NETWORK_PROV_EVENT_HANDLER_NONE;
        if (network_prov_mgr_init(prov_mgr_config) == ESP_OK) {
            g_provManagerState = PROV_MGR_INITIALIZED;
        }
    }
    if (g_provManagerState != PROV_MGR_UNINITIALIZED) {
        network_prov_mgr_reset_wifi_provisioning();
        network_prov_mgr_deinit();
    }
#endif
#endif
    g_provManagerState = PROV_MGR_STOPPED;
    g_provStatus.provisioned = false;
    g_provStatus.state = NODE_STATE_UNPROVISIONED;
    g_provStatus.lastProvisioningEvent = "WIFI_PROVISIONING_RESET";
    Serial.println("[GasGuard Network] Wi-Fi provisioning reset requested. STA credentials cleared.");
}

ProvisioningStatus getWiFiProvisioningStatus() {
    g_provStatus.managerState = g_provManagerState;
    return g_provStatus;
}

// ============================================================================
// CUSTOM PROVISIONING ENDPOINT: gasguard-enroll
// Receives Device UID + Enrollment Token during provisioning session.
// Created AFTER manager init, handler registered AFTER provisioning starts.
// ============================================================================

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#if defined(USE_CURRENT_NET_PROV_API) && HAS_NETWORK_PROV_SUPPORT

// Custom endpoint handler callback
// Receives bootstrap payload, validates, stores in RAM only.
static esp_err_t enrollmentEndpointHandler(
    uint32_t session_id,
    const uint8_t *inbuf, ssize_t inlen,
    uint8_t **outbuf, ssize_t *outlen,
    void *priv_data
) {
    (void)session_id;
    (void)priv_data;

    // Default error response
    const char* errResponse = "{\"ok\":false,\"code\":\"INVALID_PAYLOAD\"}";
    const char* okResponse = "{\"ok\":true,\"code\":\"ENROLLMENT_BOOTSTRAP_ACCEPTED\"}";

    if (inbuf == NULL || inlen <= 0) {
        *outbuf = (uint8_t*)strdup(errResponse);
        *outlen = strlen(errResponse);
        return ESP_OK;
    }

    // Parse input as string (it arrives through the Security 1 encrypted session)
    String input = String((const char*)inbuf).substring(0, (unsigned int)inlen);

    // Minimal JSON parsing for deviceUid and enrollmentToken
    // Input contract: {"deviceUid":"...","enrollmentToken":"..."}
    auto extractValue = [](const String& json, const String& key) -> String {
        String searchKey = "\"" + key + "\"";
        int keyIdx = json.indexOf(searchKey);
        if (keyIdx < 0) return "";
        int colonIdx = json.indexOf(':', keyIdx + searchKey.length());
        if (colonIdx < 0) return "";
        int qs = json.indexOf('"', colonIdx + 1);
        if (qs < 0) return "";
        int qe = json.indexOf('"', qs + 1);
        if (qe < 0) return "";
        return json.substring(qs + 1, qe);
    };

    String deviceUid = extractValue(input, "deviceUid");
    String enrollmentToken = extractValue(input, "enrollmentToken");

    // Clear input buffer copy
    for (unsigned int i = 0; i < input.length(); i++) {
        input.setCharAt(i, '\0');
    }
    input = "";

    // Validate deviceUid
    if (!isValidDeviceUid(deviceUid)) {
        *outbuf = (uint8_t*)strdup(errResponse);
        *outlen = strlen(errResponse);
        return ESP_OK;
    }

    // Validate enrollmentToken: exactly 64 hex characters
    String normalizedToken = normalizeHexLowercase(enrollmentToken);
    // Clear original before checking
    for (unsigned int i = 0; i < enrollmentToken.length(); i++) {
        enrollmentToken.setCharAt(i, '\0');
    }
    enrollmentToken = "";

    if (!isValidHex64(normalizedToken)) {
        for (unsigned int i = 0; i < normalizedToken.length(); i++) {
            normalizedToken.setCharAt(i, '\0');
        }
        normalizedToken = "";
        *outbuf = (uint8_t*)strdup(errResponse);
        *outlen = strlen(errResponse);
        return ESP_OK;
    }

    // Store in RAM-only volatile storage
    // Clear any previous bootstrap data
    if (g_enrollmentToken.length() > 0) {
        for (unsigned int i = 0; i < g_enrollmentToken.length(); i++) {
            g_enrollmentToken.setCharAt(i, '\0');
        }
    }
    g_enrollmentToken = normalizedToken;
    g_bootstrapDeviceUid = deviceUid;
    g_hasBootstrapData = true;
    g_enrollmentBootstrapAccepted = true;

    // Clear local copies
    for (unsigned int i = 0; i < normalizedToken.length(); i++) {
        normalizedToken.setCharAt(i, '\0');
    }
    normalizedToken = "";

    // Return safe acknowledgment — NEVER echo token back
    *outbuf = (uint8_t*)strdup(okResponse);
    *outlen = strlen(okResponse);

    Serial.println("[GasGuard Enrollment] Bootstrap payload accepted via provisioning endpoint.");
    return ESP_OK;
}

#endif // USE_CURRENT_NET_PROV_API && HAS_NETWORK_PROV_SUPPORT
#endif // ARDUINO_ARCH_ESP32 || ESP32

bool createEnrollmentEndpoint() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#if defined(USE_CURRENT_NET_PROV_API) && HAS_NETWORK_PROV_SUPPORT
    // Create custom endpoint AFTER manager initialization, BEFORE provisioning starts
    // Endpoint name must be a non-reserved short name
    esp_err_t err = network_prov_mgr_endpoint_create("gasguard-enroll");
    if (err != ESP_OK) {
        Serial.printf("[GasGuard Enrollment] Failed to create custom endpoint: %d\n", (int)err);
        return false;
    }
    Serial.println("[GasGuard Enrollment] Custom provisioning endpoint 'gasguard-enroll' created.");
    return true;
#else
    Serial.println("[GasGuard Enrollment] CUSTOM ENDPOINT COMPILE = NOT TESTED (API not available)");
    return false;
#endif
#else
    return false;
#endif
}

bool registerEnrollmentEndpointHandler() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#if defined(USE_CURRENT_NET_PROV_API) && HAS_NETWORK_PROV_SUPPORT
    // Register handler AFTER provisioning starts
    esp_err_t err = network_prov_mgr_endpoint_register(
        "gasguard-enroll",
        enrollmentEndpointHandler,
        NULL
    );
    if (err != ESP_OK) {
        Serial.printf("[GasGuard Enrollment] Failed to register endpoint handler: %d\n", (int)err);
        return false;
    }
    Serial.println("[GasGuard Enrollment] Enrollment endpoint handler registered.");
    return true;
#else
    return false;
#endif
#else
    return false;
#endif
}

EnrollmentBootstrap getEnrollmentBootstrap() {
    EnrollmentBootstrap bootstrap;
    bootstrap.deviceUid = g_bootstrapDeviceUid;
    bootstrap.hasBootstrapData = g_hasBootstrapData;
    return bootstrap;
}

String& getEnrollmentTokenRef() {
    return g_enrollmentToken;
}

bool hasEnrollmentToken() {
    return g_enrollmentToken.length() == 64;
}

bool hasEnrollmentBootstrapAccepted() {
    return g_enrollmentBootstrapAccepted;
}

bool requestProvisioningStop() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#if USE_CURRENT_NET_PROV_API
    if (g_provManagerState == PROV_MGR_RUNNING) {
        esp_err_t err = network_prov_mgr_stop_provisioning();
        g_provManagerState = PROV_MGR_STOPPED;
        Serial.printf("[GasGuard Network] Provisioning stop requested: %d\n", (int)err);
        return err == ESP_OK;
    }
#endif
#else
    g_provManagerState = PROV_MGR_STOPPED;
#endif
    return true;
}

void clearEnrollmentBootstrapData() {
    if (g_enrollmentToken.length() > 0) {
        for (unsigned int i = 0; i < g_enrollmentToken.length(); i++) {
            g_enrollmentToken.setCharAt(i, '\0');
        }
        g_enrollmentToken = "";
    }
    g_bootstrapDeviceUid = "";
    g_hasBootstrapData = false;
    g_enrollmentBootstrapAccepted = false;
}

ProvisioningStatus startDeviceEnrollmentProvisioning(const ProvisioningConfig& config) {
    g_enrollmentBootstrapAccepted = false;
    String validationErr;
    if (!validateProvisioningConfig(config, validationErr)) {
        g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
        g_provStatus.lastProvisioningError = "INVALID_PROVISIONING_CONFIG";
        g_provManagerState = PROV_MGR_UNINITIALIZED;
        return g_provStatus;
    }

    g_provisioningServiceName = String(config.serviceName);
    g_provStatus.serviceName = g_provisioningServiceName;
    g_provStatus.securityMode = config.securityMode;

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    registerProvisioningEventHandler();

#if USE_CURRENT_NET_PROV_API
    // Explicit aggregate initialization compatible with network_prov_mgr_config_t
    network_prov_mgr_config_t prov_mgr_config = {};
    prov_mgr_config.scheme = network_prov_scheme_softap;
    prov_mgr_config.scheme_event_handler = NETWORK_PROV_EVENT_HANDLER_NONE;

    if (g_provManagerState == PROV_MGR_UNINITIALIZED) {
        esp_err_t init_err = network_prov_mgr_init(prov_mgr_config);
        if (init_err != ESP_OK) {
            g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
            g_provStatus.lastProvisioningError = "MGR_INIT_FAILED";
            g_provManagerState = PROV_MGR_UNINITIALIZED;
            Serial.printf("[GasGuard Network] Failed to initialize network_prov_mgr: %d\n", (int)init_err);
            return g_provStatus;
        }
        g_provManagerState = PROV_MGR_INITIALIZED;
    }

    // Preserves saved Wi-Fi credentials while reopening protected SoftAP for gasguard-enroll bootstrap.

    if (!createEnrollmentEndpoint()) {
        network_prov_mgr_deinit();
        g_provManagerState = PROV_MGR_UNINITIALIZED;
        g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
        g_provStatus.lastProvisioningError = "ENROLLMENT_ENDPOINT_CREATE_FAILED";
        Serial.println("[GasGuard Network] Custom enrollment endpoint creation failed during re-enrollment. Provisioning aborted.");
        return g_provStatus;
    }

    esp_err_t start_err = network_prov_mgr_start_provisioning(
        NETWORK_PROV_SECURITY_1,
        (const char*)config.proofOfPossession,
        g_provisioningServiceName.c_str(),
        config.serviceKey
    );

    if (start_err == ESP_OK) {
        g_provStatus.state = NODE_STATE_PROVISIONING;
        g_provStatus.lastProvisioningEvent = "RE_ENROLL_START";
        g_provManagerState = PROV_MGR_RUNNING;

        if (!registerEnrollmentEndpointHandler()) {
            network_prov_mgr_stop_provisioning();
            network_prov_mgr_deinit();
            g_provManagerState = PROV_MGR_UNINITIALIZED;
            g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
            g_provStatus.lastProvisioningError = "ENROLLMENT_ENDPOINT_REGISTER_FAILED";
            Serial.println("[GasGuard Network] Custom enrollment endpoint registration failed during re-enrollment. Provisioning stopped.");
            return g_provStatus;
        }
        Serial.printf("[GasGuard Network] Re-enrollment protected SoftAP provisioning started (Service: %s, Security: 1)\n", g_provisioningServiceName.c_str());
    } else {
        network_prov_mgr_deinit();
        g_provManagerState = PROV_MGR_UNINITIALIZED;
        g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
        g_provStatus.lastProvisioningError = "MGR_START_FAILED";
        Serial.printf("[GasGuard Network] Failed to start re-enrollment provisioning manager: %d\n", (int)start_err);
    }
#endif
#else
    g_provStatus.state = NODE_STATE_PROVISIONING;
    g_provStatus.lastProvisioningEvent = "RE_ENROLL_START";
    g_provManagerState = PROV_MGR_RUNNING;
    Serial.printf("[GasGuard Network] Re-enrollment provisioning contract started (Service: %s, Security: 1)\n", g_provisioningServiceName.c_str());
#endif

    return g_provStatus;
}

ProvisioningStatus requestDeviceEnrollmentProvisioning(const ProvisioningConfig& config) {
    Serial.println("[GasGuard Network] Explicit request to open protected enrollment-bootstrap provisioning session.");
    return startDeviceEnrollmentProvisioning(config);
}
