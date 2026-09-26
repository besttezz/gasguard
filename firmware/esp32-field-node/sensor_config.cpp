#include "sensor_config.h"
#include "board_config.h"

// MQ-6: Primary LPG sensor channel
SensorDescriptor g_mq6Sensor = {
    "MQ6-01",
    "MQ6",
    PRIMARY_LPG_SENSOR,
    MQ6_ADC_PIN_PLACEHOLDER,
    GASGUARD_DEFAULT_ADC_ATTENUATION,
    GASGUARD_DEFAULT_INPUT_SCALE,
    true,
    GASGUARD_HARDWARE_PROFILE_CONFIRMED
};

// MQ-3: Auxiliary / Context sensor channel (NOT an LPG measurement channel)
SensorDescriptor g_mq3Sensor = {
    "MQ3-01",
    "MQ3",
    AUXILIARY_CONTEXT_SENSOR,
    MQ3_ADC_PIN_PLACEHOLDER,
    GASGUARD_DEFAULT_ADC_ATTENUATION,
    GASGUARD_DEFAULT_INPUT_SCALE,
    true,
    GASGUARD_HARDWARE_PROFILE_CONFIRMED
};

void initSensorChannels() {
    // Sensor channel initialization hook
}

bool validateSensorConfig(const SensorDescriptor& desc) {
    if (!desc.enabled) return false;
    if (!desc.profileConfirmed) return false; // Must be physically confirmed before running
    if (desc.pin < 32 || desc.pin > 39) return false; // Must be ADC1 pins
    return true;
}
