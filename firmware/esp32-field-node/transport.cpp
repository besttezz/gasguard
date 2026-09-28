#include "transport.h"
#include <WiFi.h>
#include <HTTPClient.h>

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
#include <WiFiClientSecure.h>
#endif

int sendTelemetryPacket(const TransportConfig& config, const String& payload) {
    if (WiFi.status() != WL_CONNECTED) {
        return TRANSPORT_ERR_WIFI_NOT_CONNECTED;
    }

    if (!config.ingressUrl || strlen(config.ingressUrl) == 0) {
        return TRANSPORT_ERR_HTTP_ERROR;
    }

    String urlStr = String(config.ingressUrl);
    bool isHttps = urlStr.startsWith("https://");
    bool isHttp = urlStr.startsWith("http://");

    bool isFieldNode = false;
    if (config.dataClassification && (strcmp(config.dataClassification, "HARDWARE_PILOT") == 0 || strcmp(config.dataClassification, "REAL_HARDWARE") == 0)) {
        isFieldNode = true;
    }

    // Physical field mode requires HTTPS scheme EXACTLY. Rejects http://, ftp://, ws://, missing or malformed schemes.
    if (isFieldNode && !isHttps) {
        Serial.println("[GasGuard Transport] ERROR: Non-HTTPS ingress URL rejected for field node. HTTPS required.");
        return TRANSPORT_ERR_INGRESS_URL_NOT_HTTPS;
    }

    HTTPClient http;

    if (isHttps) {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
        const char* caCert = (config.caCert && strlen(config.caCert) > 0) ? config.caCert : GASGUARD_INGRESS_CA_CERT;
        if (!caCert || strlen(caCert) == 0) {
            Serial.println("[GasGuard Transport] ERROR: HTTPS ingress configured but GASGUARD_INGRESS_CA_CERT trust anchor absent.");
            return TRANSPORT_ERR_TLS_TRUST_NOT_CONFIGURED;
        }

        WiFiClientSecure client;
        client.setCACert(caCert);
        // NOTE: Certificate verification is NEVER bypassed. No insecure TLS mode.

        if (!http.begin(client, config.ingressUrl)) {
            Serial.println("[GasGuard Transport] ERROR: HTTPS begin failed.");
            return TRANSPORT_ERR_HTTPS_BEGIN_FAILED;
        }
#else
        // Host / contract testing boundary
        if (!http.begin(config.ingressUrl)) {
            return TRANSPORT_ERR_HTTPS_BEGIN_FAILED;
        }
#endif
    } else {
        if (!http.begin(config.ingressUrl)) {
            return TRANSPORT_ERR_HTTPS_BEGIN_FAILED;
        }
    }

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
