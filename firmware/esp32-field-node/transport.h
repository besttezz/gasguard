#ifndef GASGUARD_TRANSPORT_H
#define GASGUARD_TRANSPORT_H

#include <Arduino.h>

// Default Local Ingress Endpoint URL Placeholder
#ifndef GASGUARD_INGRESS_URL
#define GASGUARD_INGRESS_URL "http://127.0.0.1:5567/api/v1/device/telemetry"
#endif

struct TransportConfig {
    const char* ingressUrl;
    const char* deviceKey;
    const char* dataClassification; // e.g. "REAL_HARDWARE" or "HARDWARE_PILOT"
};

int sendTelemetryPacket(const TransportConfig& config, const String& payload);

#endif // GASGUARD_TRANSPORT_H
