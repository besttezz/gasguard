#include "network_provisioning.h"
#include "provisioning_config.example.h"

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#include <WiFiProv.h>
#include <WiFi.h>
#endif

static ProvisioningStatus g_provStatus = {
    true,
    false,
    NODE_STATE_UNPROVISIONED,
    "PROV_GG_UNCONFIGURED",
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
    if (pop.length() < 8) {
        outError = "Proof of Possession (PoP) must be at least 8 high-entropy characters.";
        return false;
    }

    outError = "";
    return true;
}

void initWiFiProvisioning(const ProvisioningConfig& config) {
    String err;
    if (!validateProvisioningConfig(config, err)) {
        g_provStatus.state = NODE_STATE_PROVISIONING_CONFIG_REQUIRED;
        g_provStatus.lastProvisioningError = "INVALID_PROVISIONING_CONFIG";
        Serial.printf("[GasGuard Network] Provisioning config rejected: %s\n", err.c_str());
        return;
    }

    g_provStatus.serviceName = config.serviceName ? String(config.serviceName) : "PROV_GG_UNKNOWN";
    g_provStatus.securityMode = config.securityMode;
    g_provStatus.state = NODE_STATE_PROVISIONING;
    g_provStatus.lastProvisioningEvent = "START";

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    // WiFiProv native setup hook for ESP32 target
    // Note: Secrets are NOT printed to serial.
    // WiFiProv.beginProvision(WIFI_PROV_SCHEME_SOFTAP, WIFI_PROV_SECURITY_1, config.proofOfPossession, config.serviceName, config.serviceKey);
#endif
}

void requestWiFiProvisioningReset() {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    WiFi.disconnect(true, true); // Erase Wi-Fi STA NVS credentials only
#endif
    g_provStatus.provisioned = false;
    g_provStatus.state = NODE_STATE_UNPROVISIONED;
    g_provStatus.lastProvisioningEvent = "WIFI_PROVISIONING_RESET";
    Serial.println("[GasGuard Network] Wi-Fi provisioning reset requested. STA credentials cleared.");
}

ProvisioningStatus getWiFiProvisioningStatus() {
    return g_provStatus;
}
