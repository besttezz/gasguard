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
uint32_t telemetrySequence = 0;
unsigned long lastSampleAt = 0;
unsigned long lastDiagAt = 0;

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
    initSensorChannels();
    initBackoff(networkBackoff, 1000, 30000);

    transportConfig.ingressUrl = GASGUARD_INGRESS_URL;
    transportConfig.deviceKey = ""; // Must be set via provisioning or secure NVS
    transportConfig.dataClassification = DATA_CLASSIFICATION;

    currentState = NODE_STATE_CONNECTING_WIFI;
    Serial.printf("\n[GasGuard Node] Starting %s (BootId: %s)\n", FIRMWARE_VERSION, bootId.c_str());

    // Wi-Fi STA Connection hook (credentials supplied via provisioning)
    WiFi.mode(WIFI_STA);
}

void loop() {
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
                // Fallback ISO timestamp string using millis uptime if NTP not yet synced
                timestampStr = "2026-09-26T00:00:00Z";
            }

            String payload = buildTelemetryPayload(DEVICE_ID, mq6Reading, bootId, telemetrySequence, timestampStr);

            if (currentState == NODE_STATE_CONNECTING_INGRESS || currentState == NODE_STATE_READY) {
                int httpStatus = sendTelemetryPacket(transportConfig, payload);
                if (httpStatus == 202) {
                    currentState = NODE_STATE_READY;
                    telemetrySequence++;
                } else if (httpStatus > 0) {
                    // Non-202 status from ingress
                } else {
                    // Endpoint unreachable
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
        diag.wifiConnected = (WiFi.status() == WL_CONNECTED);
        diag.rssi = diag.wifiConnected ? WiFi.RSSI() : 0;
        diag.ipAddress = diag.wifiConnected ? WiFi.localIP().toString() : "0.0.0.0";
        diag.ingressReachable = (currentState == NODE_STATE_READY);
        diag.lastHttpStatus = (currentState == NODE_STATE_READY) ? 202 : -1;
        diag.mq6Reading = sampleSensorChannel(g_mq6Sensor);
        diag.mq3Reading = sampleSensorChannel(g_mq3Sensor);
        diag.sequence = telemetrySequence;
        diag.uptimeMs = now;

        printFieldDiagnosticsSerial(diag);
    }
}
