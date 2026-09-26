#include <Arduino.h>
#include <WiFi.h>
#include <time.h>

#include "board_config.h"
#include "sensor_config.h"
#include "measurement.h"
#include "telemetry.h"
#include "network_provisioning.h"
#include "provisioning_config.example.h"
#include "transport.h"
#include "diagnostics.h"

static const char* FIRMWARE_VERSION = "v1.0.0-field-foundation";
static const char* DEVICE_ID = "ESP32-KITCHEN-01";
static const char* DATA_CLASSIFICATION = "HARDWARE_PILOT";

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

NodeState currentState = NODE_STATE_UNPROVISIONED;
BoundedBackoff networkBackoff;
TransportConfig transportConfig;
ProvisioningConfig provConfig;

String getUtcTimestampIso() {
    struct tm timeInfo;
    if (!getLocalTime(&timeInfo, 2000)) {
        return "";
    }
    char buf[25];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeInfo);
    return String(buf);
}

void setup() {
    Serial.begin(GASGUARD_SERIAL_BAUD);
    delay(500);

    bootId = "esp32-" + String((uint32_t)(ESP.getEfuseMac() >> 32), HEX) + "-" + String(esp_random(), HEX);
    initBackoff(networkBackoff, 1000, 30000);

    // Setup Wi-Fi provisioning configuration with Security 1 + PoP
    String serviceNameStr = generateProvisioningServiceName((DEVICE_ID));
    provConfig.serviceName = serviceNameStr.c_str();
    provConfig.proofOfPossession = GASGUARD_PROV_POP_PLACEHOLDER;
    provConfig.serviceKey = GASGUARD_PROV_SERVICE_KEY;
    provConfig.securityMode = GASGUARD_PROV_SECURITY_MODE;

    transportConfig.ingressUrl = GASGUARD_INGRESS_URL;
    transportConfig.deviceKey = ""; // Must be set via HW-3 provisioning / secure NVS
    transportConfig.dataClassification = DATA_CLASSIFICATION;

    Serial.printf("\n[GasGuard Node] Starting %s (BootId: %s)\n", FIRMWARE_VERSION, bootId.c_str());

    // Wi-Fi provisioning state inspection
    if (WiFi.SSID().length() > 0) {
        currentState = NODE_STATE_CONNECTING_WIFI;
        WiFi.mode(WIFI_STA);
    } else {
        String err;
        if (!validateProvisioningConfig(provConfig, err)) {
            currentState = NODE_STATE_PROVISIONING_CONFIG_REQUIRED;
            Serial.printf("[GasGuard Node] PROVISIONING_CONFIG_REQUIRED: %s\n", err.c_str());
        } else {
            currentState = NODE_STATE_PROVISIONING;
            initWiFiProvisioning(provConfig);
        }
    }

    if (!validateBoardProfile()) {
        Serial.println("[GasGuard Node] NOTICE: Sensor hardware profile is UNCONFIRMED. MQ sampling disabled.");
    } else {
        initSensorChannels();
    }
}

void loop() {
    unsigned long now = millis();

    // 1. Connection & Backoff State Machine
    if (WiFi.status() == WL_CONNECTED) {
        if (currentState == NODE_STATE_CONNECTING_WIFI || currentState == NODE_STATE_OFFLINE || currentState == NODE_STATE_PROVISIONING) {
            // Check if device credential exists for GasGuard ingress
            if (strlen(transportConfig.deviceKey) == 0) {
                currentState = NODE_STATE_DEVICE_ENROLLMENT_REQUIRED;
            } else {
                currentState = NODE_STATE_CONNECTING_INGRESS;
                resetBackoff(networkBackoff);
                nextIngressAttemptAtMs = 0;
            }
        }
    } else {
        if (currentState != NODE_STATE_UNPROVISIONED && currentState != NODE_STATE_PROVISIONING && currentState != NODE_STATE_PROVISIONING_CONFIG_REQUIRED) {
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
                    String payload = buildRawMeasurementPayload(DEVICE_ID, mq6Reading, bootId, mq6Sequence, timestampStr);
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
                String auxPayload = buildRawMeasurementPayload(DEVICE_ID, mq3Reading, bootId, mq3Sequence, timestampStr);
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
        diag.deviceId = DEVICE_ID;
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
        diag.mq6Reading = validateBoardProfile() ? sampleSensorChannel(g_mq6Sensor) : MeasurementReading{};
        diag.mq3Reading = validateBoardProfile() ? sampleSensorChannel(g_mq3Sensor) : MeasurementReading{};
        diag.mq6Sequence = mq6Sequence;
        diag.mq3Sequence = mq3Sequence;
        diag.uptimeMs = now;
        diag.nextIngressAttemptInMs = ((long)(nextIngressAttemptAtMs - now) > 0) ? (nextIngressAttemptAtMs - now) : 0;

        printFieldDiagnosticsSerial(diag);
    }
}
