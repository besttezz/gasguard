#ifndef GASGUARD_SENSOR_CONFIG_H
#define GASGUARD_SENSOR_CONFIG_H

#include <stdint.h>

enum SensorRole {
    PRIMARY_LPG_SENSOR = 1,
    AUXILIARY_CONTEXT_SENSOR = 2
};

struct SensorDescriptor {
    const char* sensorId;
    const char* sensorType;
    SensorRole role;
    uint8_t pin;
    uint8_t adcAttenuation;
    float inputScale;
    bool enabled;
};

// Configured Sensor Channels (MQ-6 Primary, MQ-3 Auxiliary)
extern SensorDescriptor g_mq6Sensor;
extern SensorDescriptor g_mq3Sensor;

void initSensorChannels();
bool validateSensorConfig(const SensorDescriptor& desc);

#endif // GASGUARD_SENSOR_CONFIG_H
