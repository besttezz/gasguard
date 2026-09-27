#include <Arduino.h>
#include <WiFi.h>
#include <time.h>

#include "board_config.h"
#include "sensor_config.h"
#include "measurement.h"
#include "telemetry.h"
#include "network_provisioning.h"
#include "provisioning_config.h"
#include "transport.h"
#include "diagnostics.h"
#include "device_credentials.h"
#include "device_enrollment_client.h"

static const char* FIRMWARE_VERSION = "v1.1.0-credential-foundation";
static const char* DATA_CLASSIFICATION = "HARDWARE_PILOT";

// Device identity: loaded from NVS after enrollment, or UNASSIGNED before enrollment.
// One firmware image supports multiple devices — identity is server-assigned.
static String g_runtimeDeviceUid = "";
static const char* DEVICE_UID_UNASSIGNED = "UNASSIGNED";

static const unsigned long SAMPLING_INTERVAL_MS = 5000;
static const unsigned long DIAGNOSTICS_INTERVAL_MS = 15000;

String bootId;
uint32_t mq6Sequence = 0;
uint32_t mq3Sequence = 0;
unsigned long lastSampleAt = 0;
unsigned long lastDiagAt = 0;

int mq6LastHttpStatus = -1;
int mq3LastHttpStatus = -1;
bool ingressReachable = false;
unsigned long nextIngressAttemptAtMs = 0;

// Enrollment state tracking (safe for diagnostics — no secrets)
int lastEnrollmentHttpStatus = -1;
const char* lastEnrollmentErrorCode = "NONE";
const char* credentialStoreState = "UNCHECKED";

NodeState currentState = NODE_STATE_UNPROVISIONED;
BoundedBackoff networkBackoff;
TransportConfig transportConfig;
ProvisioningConfig provConfig;

// Runtime device credential buffer (loaded from NVS, used for transport)
static String g_deviceCredentialRuntime = "";

String getUtcTimestampIso() {
    struct tm timeInfo;
    if (!getLocalTime(&timeInfo, 2000)) {
        return "";
    }
    char buf[25];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeInfo);
    return String(buf);
}

static String g_serviceNameStr;

// Returns the current runtime device ID for telemetry payloads.
// Uses persisted deviceUid after enrollment, or UNASSIGNED before.
const char* getRuntimeDeviceId() {
    if (g_runtimeDeviceUid.length() > 0) {
        return g_runtimeDeviceUid.c_str();
    }
    return DEVICE_UID_UNASSIGNED;
}

void setup() {
    Serial.begin(GASGUARD_SERIAL_BAUD);
    delay(500);

    uint64_t chipMac = 0;
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    chipMac = ESP.getEfuseMac();
#endif
    char macSuffixBuf[7] = {0};
    if (chipMac != 0) {
        snprintf(macSuffixBuf, sizeof(macSuffixBuf), "%06X", (uint32_t)(chipMac & 0xFFFFFF));
    }

    bootId = "esp32-" + String((uint32_t)(chipMac >> 32), HEX) + "-" + String(esp_random(), HEX);
    initBackoff(networkBackoff, 1000, 30000);

    // Setup Wi-Fi provisioning configuration with Security 1 + PoP
    g_serviceNameStr = generateProvisioningServiceName(macSuffixBuf);
    provConfig.serviceName = g_serviceNameStr.c_str();
    provConfig.proofOfPossession = GASGUARD_PROV_POP;
    provConfig.serviceKey = GASGUARD_PROV_SERVICE_KEY;
    provConfig.securityMode = GASGUARD_PROV_SECURITY_MODE;

    // Load persisted Device UID + Device Credential from NVS
    StoredCredentials stored = loadDeviceCredentials();
    if (stored.valid) {
        g_runtimeDeviceUid = stored.deviceUid;
        g_deviceCredentialRuntime = stored.deviceCredential;
        credentialStoreState = "LOADED";
        Serial.println("[GasGuard Node] Persisted device credential loaded from NVS.");
    } else if (stored.result == CRED_STORE_INVALID_FORMAT) {
        // Corrupt/malformed stored credential — fail closed
        credentialStoreState = "CORRUPT";
        Serial.println("[GasGuard Node] WARNING: Stored credential is malformed. CREDENTIAL_STORAGE_ERROR.");
    } else {
        credentialStoreState = "EMPTY";
        Serial.println("[GasGuard Node] No persisted device credential found. Enrollment required.");
    }

    transportConfig.ingressUrl = GASGUARD_INGRESS_URL;
    // Use persisted Device Credential for transport — never a compile-time credential
    transportConfig.deviceKey = g_deviceCredentialRuntime.length() > 0 ? g_deviceCredentialRuntime.c_str() : "";
    transportConfig.dataClassification = DATA_CLASSIFICATION;

    Serial.printf("\n[GasGuard Node] Starting %s (BootId: %s, DeviceUID: %s)\n",
                  FIRMWARE_VERSION, bootId.c_str(), getRuntimeDeviceId());

    // Single State Authority: Prepare & initialize provisioning manager lifecycle
    ProvisioningStatus provStatus = prepareWiFiProvisioning(provConfig);
    currentState = provStatus.state;

    // If stored credential was corrupt, override state
    if (stored.result == CRED_STORE_INVALID_FORMAT) {
        currentState = NODE_STATE_CREDENTIAL_STORAGE_ERROR;
    }

    if (!validateBoardProfile()) {
        Serial.println("[GasGuard Node] NOTICE: Sensor hardware profile is UNCONFIRMED. MQ sampling disabled.");
    } else {
        initSensorChannels();
    }
}

void loop() {
    unsigned long now = millis();

    // 1. Connection & Backoff State Machine - Single State Authority Synchronization
    ProvisioningStatus provStatus = getWiFiProvisioningStatus();
    if (provStatus.state == NODE_STATE_PROVISIONING || provStatus.state == NODE_STATE_PROVISIONING_FAILED ||
        provStatus.state == NODE_STATE_PROVISIONING_CONFIG_REQUIRED || provStatus.state == NODE_STATE_PROVISIONING_SECURITY_UNAVAILABLE ||
        provStatus.state == NODE_STATE_PROVISIONING_IDENTITY_UNAVAILABLE) {
        currentState = provStatus.state;
    } else if (WiFi.status() == WL_CONNECTED) {
        if (currentState == NODE_STATE_CONNECTING_WIFI || currentState == NODE_STATE_OFFLINE || currentState == NODE_STATE_PROVISIONING) {
            // Check if device credential exists for GasGuard ingress
            if (strlen(transportConfig.deviceKey) == 0) {
                // Check if bootstrap token is available from provisioning
                if (hasEnrollmentToken()) {
                    currentState = NODE_STATE_ENROLLING_DEVICE;
                } else {
                    currentState = NODE_STATE_DEVICE_ENROLLMENT_REQUIRED;
                }
            } else {
                currentState = NODE_STATE_CONNECTING_INGRESS;
                resetBackoff(networkBackoff);
                nextIngressAttemptAtMs = 0;
            }
        }

        // 1b. Enrollment State Machine
        if (currentState == NODE_STATE_ENROLLING_DEVICE) {
            EnrollmentBootstrap bootstrap = getEnrollmentBootstrap();
            if (bootstrap.hasBootstrapData && hasEnrollmentToken()) {
                String enrollmentUrl = GASGUARD_ENROLLMENT_URL;

                EnrollmentResult enrollResult = performDeviceEnrollment(
                    getEnrollmentTokenRef(),
                    bootstrap.deviceUid,
                    enrollmentUrl
                );

                lastEnrollmentHttpStatus = enrollResult.httpStatus;
                lastEnrollmentErrorCode = enrollmentResultToString(enrollResult.code);

                if (enrollResult.code == ENROLL_SUCCESS && enrollResult.credentialPersisted) {
                    // Reload credentials from NVS to update runtime state
                    StoredCredentials freshCreds = loadDeviceCredentials();
                    if (freshCreds.valid) {
                        g_runtimeDeviceUid = freshCreds.deviceUid;
                        g_deviceCredentialRuntime = freshCreds.deviceCredential;
                        transportConfig.deviceKey = g_deviceCredentialRuntime.c_str();
                        credentialStoreState = "ENROLLED";
                        currentState = NODE_STATE_CONNECTING_INGRESS;
                        resetBackoff(networkBackoff);
                        nextIngressAttemptAtMs = 0;
                        Serial.println("[GasGuard Node] Enrollment successful. Transitioning to CONNECTING_INGRESS.");
                    } else {
                        currentState = NODE_STATE_CREDENTIAL_STORAGE_ERROR;
                        credentialStoreState = "VERIFY_FAILED";
                    }
                } else if (enrollResult.code == ENROLL_ALREADY_CLAIMED) {
                    // Terminal: token already used, do NOT retry
                    currentState = NODE_STATE_DEVICE_ENROLLMENT_FAILED;
                    Serial.println("[GasGuard Node] ENROLLMENT_ALREADY_CLAIMED. New enrollment workflow required.");
                } else if (enrollResult.code == ENROLL_RESULT_UNKNOWN) {
                    // Ambiguous: server may have committed. Do NOT retry.
                    currentState = NODE_STATE_DEVICE_ENROLLMENT_FAILED;
                    Serial.println("[GasGuard Node] ENROLLMENT_RESULT_UNKNOWN. Technician recovery required.");
                } else if (enrollResult.code == ENROLL_CREDENTIAL_STORE_ERROR) {
                    currentState = NODE_STATE_CREDENTIAL_STORAGE_ERROR;
                    credentialStoreState = "WRITE_FAILED";
                } else if (enrollResult.code == ENROLL_TLS_TRUST_NOT_CONFIGURED ||
                           enrollResult.code == ENROLL_URL_MISSING ||
                           enrollResult.code == ENROLL_URL_NOT_HTTPS) {
                    // Configuration errors — not retryable without config change
                    currentState = NODE_STATE_DEVICE_ENROLLMENT_FAILED;
                } else {
                    // Other failures (server rejection, parse error, etc.)
                    currentState = NODE_STATE_DEVICE_ENROLLMENT_FAILED;
                }
            } else {
                // Bootstrap data not available
                currentState = NODE_STATE_DEVICE_ENROLLMENT_REQUIRED;
            }
        }
    } else {
        if (currentState != NODE_STATE_UNPROVISIONED && currentState != NODE_STATE_PROVISIONING && currentState != NODE_STATE_PROVISIONING_CONFIG_REQUIRED &&
            currentState != NODE_STATE_PROVISIONING_SECURITY_UNAVAILABLE && currentState != NODE_STATE_PROVISIONING_IDENTITY_UNAVAILABLE &&
            currentState != NODE_STATE_CREDENTIAL_STORAGE_ERROR) {
            currentState = NODE_STATE_OFFLINE;
        }
    }

    // 2. Sensor Sampling & Telemetry Push (Only if board profile confirmed & device enrolled)
    if (validateBoardProfile() && (now - lastSampleAt >= SAMPLING_INTERVAL_MS)) {
        lastSampleAt = now;

        MeasurementReading mq6Reading = sampleSensorChannel(g_mq6Sensor);
        MeasurementReading mq3Reading = sampleSensorChannel(g_mq3Sensor);

        if (mq6Reading.isValid) {
            String timestampStr = getUtcTimestampIso();
            if (timestampStr.length() == 0) {
                Serial.println("[GasGuard Node] TIME_UNAVAILABLE: NTP timestamp not ready. Skipping transmission.");
            } else if (currentState == NODE_STATE_CONNECTING_INGRESS || currentState == NODE_STATE_READY) {
                bool networkAllowed = (nextIngressAttemptAtMs == 0) || ((long)(now - nextIngressAttemptAtMs) >= 0);
                if (networkAllowed) {
                    // Use runtime device UID for telemetry payload (server-assigned, not hard-coded)
                    String payload = buildRawMeasurementPayload(getRuntimeDeviceId(), mq6Reading, bootId, mq6Sequence, timestampStr);
                    int status = sendTelemetryPacket(transportConfig, payload);
                    mq6LastHttpStatus = status;
                    if (status == 202) {
                        currentState = NODE_STATE_READY;
                        ingressReachable = true;
                        mq6Sequence++;
                        resetBackoff(networkBackoff);
                        nextIngressAttemptAtMs = 0;
                    } else {
                        ingressReachable = false;
                        uint32_t delayMs = calculateNextBackoffMs(networkBackoff);
                        nextIngressAttemptAtMs = now + delayMs;
                    }
                }
            }
        }

        // MQ-3 Auxiliary Transmission
        if (mq3Reading.isValid && g_mq3Sensor.enabled) {
            String timestampStr = getUtcTimestampIso();
            bool networkAllowed = (nextIngressAttemptAtMs == 0) || ((long)(now - nextIngressAttemptAtMs) >= 0);
            if (timestampStr.length() > 0 && networkAllowed && (currentState == NODE_STATE_CONNECTING_INGRESS || currentState == NODE_STATE_READY)) {
                String auxPayload = buildRawMeasurementPayload(getRuntimeDeviceId(), mq3Reading, bootId, mq3Sequence, timestampStr);
                int status = sendTelemetryPacket(transportConfig, auxPayload);
                mq3LastHttpStatus = status;
                if (status == 202) {
                    mq3Sequence++;
                }
            }
        }
    }

    // 3. Periodic Field Diagnostics
    if (now - lastDiagAt >= DIAGNOSTICS_INTERVAL_MS) {
        lastDiagAt = now;

        FieldDiagnostics diag;
        diag.deviceId = getRuntimeDeviceId();
        diag.bootId = bootId;
        diag.firmwareVersion = FIRMWARE_VERSION;
        diag.currentState = currentState;
        diag.profileConfirmed = GASGUARD_HARDWARE_PROFILE_CONFIRMED;
        diag.wifiConnected = (WiFi.status() == WL_CONNECTED);
        diag.rssi = diag.wifiConnected ? WiFi.RSSI() : 0;
        diag.ipAddress = diag.wifiConnected ? WiFi.localIP().toString() : "0.0.0.0";
        diag.ingressReachable = ingressReachable;
        diag.mq6LastHttpStatus = mq6LastHttpStatus;
        diag.mq3LastHttpStatus = mq3LastHttpStatus;
        diag.softApStatus = "PROTECTED_SOFTAP_SECURITY_1";
        diag.provisioningServiceName = provConfig.serviceName ? String(provConfig.serviceName) : "PROV_GG_UNCONFIGURED";
        diag.provisioningSecurityMode = provConfig.securityMode;
        diag.hasDeviceCredential = (strlen(transportConfig.deviceKey) > 0);
        diag.credentialStoreState = credentialStoreState;
        diag.enrollmentState = lastEnrollmentErrorCode;
        diag.lastEnrollmentHttpStatus = lastEnrollmentHttpStatus;
        diag.mq6Reading = validateBoardProfile() ? sampleSensorChannel(g_mq6Sensor) : MeasurementReading{};
        diag.mq3Reading = validateBoardProfile() ? sampleSensorChannel(g_mq3Sensor) : MeasurementReading{};
        diag.mq6Sequence = mq6Sequence;
        diag.mq3Sequence = mq3Sequence;
        diag.uptimeMs = now;
        diag.nextIngressAttemptInMs = ((long)(nextIngressAttemptAtMs - now) > 0) ? (nextIngressAttemptAtMs - now) : 0;

        printFieldDiagnosticsSerial(diag);
    }
}
