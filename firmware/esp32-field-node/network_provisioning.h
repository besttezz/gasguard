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
    NODE_STATE_CONFIG_ERROR = 11,
    NODE_STATE_PROVISIONING_SECURITY_UNAVAILABLE = 12,
    NODE_STATE_PROVISIONING_IDENTITY_UNAVAILABLE = 13,
    NODE_STATE_ENROLLING_DEVICE = 14,
    NODE_STATE_DEVICE_ENROLLMENT_FAILED = 15,
    NODE_STATE_CREDENTIAL_STORAGE_ERROR = 16,
    NODE_STATE_ENROLLMENT_BOOTSTRAP_CHANNEL_REQUIRED = 17
};

const char* nodeStateToString(NodeState state);

struct ProvisioningConfig {
    const char* serviceName;
    const char* proofOfPossession;
    const char* serviceKey;
    uint8_t securityMode; // 1 = Security 1 + PoP (Required). 0 = Forbidden.
};

enum ProvisioningManagerState {
    PROV_MGR_UNINITIALIZED = 0,
    PROV_MGR_INITIALIZED = 1,
    PROV_MGR_RUNNING = 2,
    PROV_MGR_STOPPED = 3
};

struct ProvisioningStatus {
    bool provisioningSupported;
    bool provisioned;
    NodeState state;
    ProvisioningManagerState managerState;
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

void registerProvisioningEventHandler();
ProvisioningStatus prepareWiFiProvisioning(const ProvisioningConfig& config);
void initWiFiProvisioning(const ProvisioningConfig& config);
bool isWiFiProvisioned();
String generateProvisioningServiceName(const char* macOrDeviceSuffix);
bool validateProvisioningConfig(const ProvisioningConfig& config, String& outError);
void requestWiFiProvisioningReset();
ProvisioningStatus getWiFiProvisioningStatus();

// Custom provisioning endpoint for enrollment bootstrap.
// Must be created AFTER manager init, BEFORE provisioning starts.
// Handler registered AFTER provisioning starts.
bool createEnrollmentEndpoint();
bool registerEnrollmentEndpointHandler();

// Enrollment bootstrap data received via custom provisioning endpoint.
// Held in RAM only. NEVER persisted, logged, or sent to Serial.
struct EnrollmentBootstrap {
    String deviceUid;
    bool hasBootstrapData;
    // NOTE: enrollmentToken is stored in a separate volatile-only variable
    // inside network_provisioning.cpp and is NEVER exposed in this struct.
};

// Get bootstrap data (without token) for state machine decisions
EnrollmentBootstrap getEnrollmentBootstrap();

// Access enrollment token for the enrollment client ONLY.
// Returns a mutable reference that will be cleared after use.
// NEVER print, log, persist, or include in diagnostics.
String& getEnrollmentTokenRef();

// Check if bootstrap enrollment token is available in RAM
bool hasEnrollmentToken();

// Explicit Device Credential bootstrap session re-entry (HW-3C2B).
// Reopens protected provisioning SoftAP WITH Security 1 + PoP and gasguard-enroll custom endpoint
// WITHOUT erasing Wi-Fi credentials or calling network_prov_mgr_reset_wifi_provisioning().
ProvisioningStatus startDeviceEnrollmentProvisioning(const ProvisioningConfig& config);
ProvisioningStatus requestDeviceEnrollmentProvisioning(const ProvisioningConfig& config);

#endif // GASGUARD_NETWORK_PROVISIONING_H
