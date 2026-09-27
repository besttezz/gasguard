#ifndef GASGUARD_TRANSPORT_H
#define GASGUARD_TRANSPORT_H

#include <Arduino.h>

// Default Local Ingress Endpoint URL Placeholder
#ifndef GASGUARD_INGRESS_URL
#define GASGUARD_INGRESS_URL "http://127.0.0.1:5567/api/v1/device/telemetry"
#endif

// Separate conceptual configuration for telemetry ingress CA certificate trust anchor
#ifndef GASGUARD_INGRESS_CA_CERT
#define GASGUARD_INGRESS_CA_CERT ""
#endif

// Deterministic Transport Failure Result Codes
#define TRANSPORT_ERR_WIFI_NOT_CONNECTED        -1
#define TRANSPORT_ERR_INGRESS_URL_NOT_HTTPS     -3
#define TRANSPORT_ERR_TLS_TRUST_NOT_CONFIGURED  -4
#define TRANSPORT_ERR_HTTPS_BEGIN_FAILED        -5
#define TRANSPORT_ERR_HTTP_ERROR                -6

struct TransportConfig {
    const char* ingressUrl;
    const char* deviceKey;
    const char* dataClassification; // e.g. "REAL_HARDWARE" or "HARDWARE_PILOT"
    const char* caCert; // Optional override; defaults to GASGUARD_INGRESS_CA_CERT
};

int sendTelemetryPacket(const TransportConfig& config, const String& payload);

#endif // GASGUARD_TRANSPORT_H
