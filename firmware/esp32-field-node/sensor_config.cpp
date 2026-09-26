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
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP32)
    analogReadResolution(12);
    if (g_mq6Sensor.enabled) {
        analogSetPinAttenuation(g_mq6Sensor.pin, g_mq6Sensor.adcAttenuation);
    }
    if (g_mq3Sensor.enabled) {
        analogSetPinAttenuation(g_mq3Sensor.pin, g_mq3Sensor.adcAttenuation);
    }
#endif
}

bool validateBoardProfile() {
    if (!GASGUARD_HARDWARE_PROFILE_CONFIRMED) {
        return false;
    }
    if (String(GASGUARD_BOARD_VARIANT) == "ESP32_GENERIC_UNVERIFIED" || String(GASGUARD_BOARD_VARIANT).length() == 0) {
        return false;
    }

    if (!g_mq6Sensor.enabled || !g_mq6Sensor.profileConfirmed) {
        return false;
    }
    if (g_mq6Sensor.pin < 32 || g_mq6Sensor.pin > 39) {
        return false;
    }
    if (g_mq6Sensor.inputScale <= 0.0f) {
        return false;
    }

    if (g_mq3Sensor.enabled) {
        if (!g_mq3Sensor.profileConfirmed) return false;
        if (g_mq3Sensor.pin < 32 || g_mq3Sensor.pin > 39) return false;
        if (g_mq3Sensor.pin == g_mq6Sensor.pin) return false;
        if (g_mq3Sensor.inputScale <= 0.0f) return false;
    }

    return true;
}

bool validateSensorConfig(const SensorDescriptor& desc) {
    if (!desc.enabled) return false;
    if (!desc.profileConfirmed) return false;
    if (desc.pin < 32 || desc.pin > 39) return false;
    if (desc.inputScale <= 0.0f) return false;
    return true;
}
