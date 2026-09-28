#ifndef GASGUARD_TELEMETRY_H
#define GASGUARD_TELEMETRY_H

#include <Arduino.h>
#include <stdint.h>
#include "measurement.h"

// Builds raw measurement packet for pre-telemetry ingress
String buildRawMeasurementPayload(
    const char* deviceId,
    const MeasurementReading& reading,
    const String& bootId,
    uint32_t sequence,
    const String& timestampIso
);

#endif // GASGUARD_TELEMETRY_H
