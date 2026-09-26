#ifndef GASGUARD_DIAGNOSTICS_H
#define GASGUARD_DIAGNOSTICS_H

#include <Arduino.h>
#include "network_provisioning.h"
#include "measurement.h"

struct FieldDiagnostics {
    const char* deviceId;
    String bootId;
    const char* firmwareVersion;
    NodeState currentState;
    bool profileConfirmed;
    bool wifiConnected;
    int32_t rssi;
    String ipAddress;
    bool ingressReachable;
    int mq6LastHttpStatus;
    int mq3LastHttpStatus;
    const char* softApStatus;
    MeasurementReading mq6Reading;
    MeasurementReading mq3Reading;
    uint32_t mq6Sequence;
    uint32_t mq3Sequence;
    uint32_t uptimeMs;
    uint32_t nextIngressAttemptInMs;
};

String formatFieldDiagnosticsJson(const FieldDiagnostics& diag);
void printFieldDiagnosticsSerial(const FieldDiagnostics& diag);

#endif // GASGUARD_DIAGNOSTICS_H
