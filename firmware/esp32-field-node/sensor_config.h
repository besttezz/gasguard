#ifndef GASGUARD_SENSOR_CONFIG_H
#define GASGUARD_SENSOR_CONFIG_H

#include <stdint.h>
#include <Arduino.h>

enum SensorRole {
    PRIMARY_LPG_SENSOR = 1,
    AUXILIARY_CONTEXT_SENSOR = 2
};

struct SensorDescriptor {
    const char* sensorId;
    const char* sensorType;
    SensorRole role;
    uint8_t pin;
    adc_attenuation_t adcAttenuation;
    float inputScale;
    bool enabled;
    bool profileConfirmed;
};

extern SensorDescriptor g_mq6Sensor;
extern SensorDescriptor g_mq3Sensor;

void initSensorChannels();
bool isConfiguredBoardPinAllowed(const char* boardVariant, uint8_t pin);
bool validateSensorConfig(const SensorDescriptor& desc);
bool validateBoardProfile();

#endif // GASGUARD_SENSOR_CONFIG_H
