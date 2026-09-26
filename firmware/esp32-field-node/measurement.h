#ifndef GASGUARD_MEASUREMENT_H
#define GASGUARD_MEASUREMENT_H

#include <stdint.h>
#include "sensor_config.h"

struct MeasurementReading {
    const char* sensorId;
    const char* sensorType;
    SensorRole role;
    uint16_t rawAdc;
    float sensorVoltage;
    float inputAdjustedVoltage;
    bool hasInputScale;
    const char* calibrationStatus; // "CALIBRATION_REQUIRED"
    bool isValid;
};

MeasurementReading sampleSensorChannel(const SensorDescriptor& desc);

#endif // GASGUARD_MEASUREMENT_H
