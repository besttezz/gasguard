#ifndef GASGUARD_NETWORK_PROVISIONING_H
#define GASGUARD_NETWORK_PROVISIONING_H

#include <Arduino.h>

enum NodeState {
    NODE_STATE_UNPROVISIONED = 0,
    NODE_STATE_PROVISIONING = 1,
    NODE_STATE_PROVISIONING_CONFIG_REQUIRED = 2,
    NODE_STATE_PROVISIONING_FAILED = 3,
    NODE_STATE_CONNECTING_WIFI = 4,
    NODE_STATE_WIFI_CONNECTED = 5,
    NODE_STATE_CONNECTING_INGRESS = 6,
    NODE_STATE_READY = 7,
    NODE_STATE_DEVICE_ENROLLMENT_REQUIRED = 8,
    NODE_STATE_CALIBRATION_REQUIRED = 9,
    NODE_STATE_OFFLINE = 10,
    NODE_STATE_CONFIG_ERROR = 11
};

const char* nodeStateToString(NodeState state);

struct ProvisioningConfig {
    const char* serviceName;
    const char* proofOfPossession;
    const char* serviceKey;
    uint8_t securityMode; // 1 = Security 1 + PoP (Required). 0 = Forbidden.
};

struct ProvisioningStatus {
    bool provisioningSupported;
    bool provisioned;
    NodeState state;
    String serviceName;
    uint8_t securityMode;
    const char* lastProvisioningEvent;
    const char* lastProvisioningError;
};

struct BoundedBackoff {
    uint32_t attempt;
    uint32_t currentDelayMs;
    uint32_t maxDelayMs;
};

void initBackoff(BoundedBackoff& backoff, uint32_t initialMs = 1000, uint32_t maxMs = 30000);
uint32_t calculateNextBackoffMs(BoundedBackoff& backoff);
void resetBackoff(BoundedBackoff& backoff);

void initWiFiProvisioning(const ProvisioningConfig& config);
String generateProvisioningServiceName(const char* macOrDeviceSuffix);
bool validateProvisioningConfig(const ProvisioningConfig& config, String& outError);
void requestWiFiProvisioningReset();
ProvisioningStatus getWiFiProvisioningStatus();

#endif // GASGUARD_NETWORK_PROVISIONING_H
