#include "transport.h"
#include <WiFi.h>
#include <HTTPClient.h>

int sendTelemetryPacket(const TransportConfig& config, const String& payload) {
    if (WiFi.status() != WL_CONNECTED) {
        return -1;
    }

    HTTPClient http;
    http.begin(config.ingressUrl);
    http.addHeader("Content-Type", "application/json");
    if (config.deviceKey && strlen(config.deviceKey) > 0) {
        http.addHeader("x-device-key", config.deviceKey);
    }
    if (config.dataClassification && strlen(config.dataClassification) > 0) {
        http.addHeader("x-gasguard-data-classification", config.dataClassification);
    }

    int statusCode = http.POST(payload);
    http.end();
    return statusCode;
}
