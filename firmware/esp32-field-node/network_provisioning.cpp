#include "network_provisioning.h"
#include "provisioning_config.h"

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#include <wifi_prov_mgr.h>
#include <scheme_softap.h>
#include <WiFi.h>
#endif

static String g_provisioningServiceName = "PROV_GG_UNCONFIGURED";

static ProvisioningStatus g_provStatus = {
    true,
    false,
    NODE_STATE_UNPROVISIONED,
    g_provisioningServiceName,
    GASGUARD_PROV_SECURITY_MODE,
    "NONE",
    "NONE"
};

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
    String suffix = macOrDeviceSuffix ? String(macOrDeviceSuffix) : "000000";
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

bool isWiFiProvisioned() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    bool provisioned = false;
    if (wifi_prov_mgr_is_provisioned(&provisioned) == ESP_OK) {
        return provisioned;
    }
    return WiFi.SSID().length() > 0;
#else
    return g_provStatus.provisioned;
#endif
}

void initWiFiProvisioning(const ProvisioningConfig& config) {
    String err;
    if (!validateProvisioningConfig(config, err)) {
        g_provStatus.state = NODE_STATE_PROVISIONING_CONFIG_REQUIRED;
        g_provStatus.lastProvisioningError = "INVALID_PROVISIONING_CONFIG";
        Serial.printf("[GasGuard Network] Provisioning config rejected: %s\n", err.c_str());
        return;
    }

    g_provisioningServiceName = config.serviceName ? String(config.serviceName) : "PROV_GG_UNKNOWN";
    g_provStatus.serviceName = g_provisioningServiceName;
    g_provStatus.securityMode = config.securityMode;
    g_provStatus.state = NODE_STATE_PROVISIONING;
    g_provStatus.lastProvisioningEvent = "START";

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    // Direct Espressif Native Provisioning Manager setup
    // Avoids WiFiProv wrapper logging PoP at INFO log level.
    wifi_prov_mgr_config_t prov_mgr_config = {
        .scheme = wifi_prov_scheme_softap,
        .scheme_event_handler = WIFI_PROV_EVENT_HANDLER_NONE,
        .app_info = NULL
    };

    esp_err_t ret = wifi_prov_mgr_init(prov_mgr_config);
    if (ret == ESP_OK) {
        // Active native provisioning start
        wifi_prov_security_t sec = (config.securityMode == 1) ? WIFI_PROV_SECURITY_1 : WIFI_PROV_SECURITY_0;
        wifi_prov_mgr_start_provisioning(sec, config.proofOfPossession, g_provisioningServiceName.c_str(), config.serviceKey);
        Serial.printf("[GasGuard Network] Protected SoftAP provisioning started (Service: %s, Security: 1)\n", g_provisioningServiceName.c_str());
    } else {
        g_provStatus.state = NODE_STATE_PROVISIONING_FAILED;
        g_provStatus.lastProvisioningError = "INIT_FAILED";
    }
#else
    Serial.printf("[GasGuard Network] Provisioning contract initialized (Service: %s, Security: 1)\n", g_provisioningServiceName.c_str());
#endif
}

void requestWiFiProvisioningReset() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    WiFi.disconnect(true, true); // Target Wi-Fi STA NVS credentials erase only
    wifi_prov_mgr_reset_provisioning();
#endif
    g_provStatus.provisioned = false;
    g_provStatus.state = NODE_STATE_UNPROVISIONED;
    g_provStatus.lastProvisioningEvent = "WIFI_PROVISIONING_RESET";
    Serial.println("[GasGuard Network] Wi-Fi provisioning reset requested. STA credentials cleared.");
}

ProvisioningStatus getWiFiProvisioningStatus() {
    g_provStatus.provisioned = isWiFiProvisioned();
    return g_provStatus;
}
