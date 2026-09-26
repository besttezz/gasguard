#include <Arduino.h>
#include <WiFi.h>
#include <time.h>

#include "board_config.h"
#include "sensor_config.h"
#include "measurement.h"
#include "telemetry.h"
#include "network_provisioning.h"
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

int lastHttpStatus = -1;
bool ingressReachable = false;

NodeState currentState = NODE_STATE_UNPROVISIONED;
BoundedBackoff networkBackoff;
TransportConfig transportConfig;

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

    if (!validateBoardProfile()) {
        currentState = NODE_STATE_CONFIG_ERROR;
        Serial.println("[GasGuard Node] ERROR: Hardware profile is UNCONFIRMED or invalid. Refusing execution.");
        return;
    }

    initSensorChannels();
    initBackoff(networkBackoff, 1000, 30000);

    transportConfig.ingressUrl = GASGUARD_INGRESS_URL;
    transportConfig.deviceKey = ""; // Must be set via provisioning or secure NVS
    transportConfig.dataClassification = DATA_CLASSIFICATION;

    currentState = NODE_STATE_CONNECTING_WIFI;
    Serial.printf("\n[GasGuard Node] Starting %s (BootId: %s)\n", FIRMWARE_VERSION, bootId.c_str());

    WiFi.mode(WIFI_STA);
}

void loop() {
    if (currentState == NODE_STATE_CONFIG_ERROR) {
        // Safe refusal mode due to unconfirmed hardware profile
        delay(1000);
        return;
    }

    unsigned long now = millis();

    // 1. Maintain Connection & Backoff State Machine
    if (WiFi.status() == WL_CONNECTED) {
        if (currentState == NODE_STATE_CONNECTING_WIFI || currentState == NODE_STATE_OFFLINE) {
            currentState = NODE_STATE_CONNECTING_INGRESS;
            resetBackoff(networkBackoff);
        }
    } else {
        if (currentState != NODE_STATE_UNPROVISIONED && currentState != NODE_STATE_PROVISIONING) {
            currentState = NODE_STATE_OFFLINE;
        }
    }

    // 2. Periodic Sensor Sampling & Telemetry Push
    if (now - lastSampleAt >= SAMPLING_INTERVAL_MS) {
        lastSampleAt = now;

        MeasurementReading mq6Reading = sampleSensorChannel(g_mq6Sensor);
        MeasurementReading mq3Reading = sampleSensorChannel(g_mq3Sensor);

        if (mq6Reading.isValid) {
            String timestampStr = getUtcTimestampIso();
            if (timestampStr.length() == 0) {
                // DO NOT send packet with hardcoded timestamp fallback if NTP is unavailable
                Serial.println("[GasGuard Node] TIME_UNAVAILABLE: NTP timestamp not ready. Skipping transmission.");
            } else {
                String payload = buildRawMeasurementPayload(DEVICE_ID, mq6Reading, bootId, mq6Sequence, timestampStr);

                if (currentState == NODE_STATE_CONNECTING_INGRESS || currentState == NODE_STATE_READY) {
                    int status = sendTelemetryPacket(transportConfig, payload);
                    lastHttpStatus = status;
                    if (status == 202) {
                        currentState = NODE_STATE_READY;
                        ingressReachable = true;
                        mq6Sequence++;
                        resetBackoff(networkBackoff);
                    } else {
                        ingressReachable = false;
                        if (status > 0) {
                            // HTTP failure from ingress
                        } else {
                            // Unreachable transport
                        }
                        calculateNextBackoffMs(networkBackoff);
                    }
                }
            }
        }

        // MQ-3 auxiliary packet sent independently if valid
        if (mq3Reading.isValid && g_mq3Sensor.enabled) {
            String timestampStr = getUtcTimestampIso();
            if (timestampStr.length() > 0 && (currentState == NODE_STATE_CONNECTING_INGRESS || currentState == NODE_STATE_READY)) {
                String auxPayload = buildRawMeasurementPayload(DEVICE_ID, mq3Reading, bootId, mq3Sequence, timestampStr);
                int status = sendTelemetryPacket(transportConfig, auxPayload);
                if (status == 202) {
                    mq3Sequence++;
                }
            }
        }
    }

    // 3. Periodic Field Diagnostics Output
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
        diag.lastHttpStatus = lastHttpStatus;
        diag.softApStatus = "PLANNED / INTERFACE PREPARED - NOT YET IMPLEMENTED";
        diag.mq6Reading = sampleSensorChannel(g_mq6Sensor);
        diag.mq3Reading = sampleSensorChannel(g_mq3Sensor);
        diag.mq6Sequence = mq6Sequence;
        diag.mq3Sequence = mq3Sequence;
        diag.uptimeMs = now;

        printFieldDiagnosticsSerial(diag);
    }
}
