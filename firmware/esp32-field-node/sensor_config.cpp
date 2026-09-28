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

bool isConfiguredBoardPinAllowed(const char* boardVariant, uint8_t pin) {
    if (boardVariant == NULL || String(boardVariant) == "ESP32_GENERIC_UNVERIFIED") {
        return false;
    }
    // Future additive confirmed board profile mapping will define allowed pins here.
    return false;
}

bool validateBoardProfile() {
    if (!GASGUARD_HARDWARE_PROFILE_CONFIRMED) {
        return false;
    }
    if (!isConfiguredBoardPinAllowed(GASGUARD_BOARD_VARIANT, g_mq6Sensor.pin)) {
        return false;
    }
    if (!g_mq6Sensor.enabled || !g_mq6Sensor.profileConfirmed || g_mq6Sensor.inputScale <= 0.0f) {
        return false;
    }
    if (g_mq3Sensor.enabled) {
        if (!g_mq3Sensor.profileConfirmed || g_mq3Sensor.inputScale <= 0.0f) return false;
        if (!isConfiguredBoardPinAllowed(GASGUARD_BOARD_VARIANT, g_mq3Sensor.pin)) return false;
        if (g_mq3Sensor.pin == g_mq6Sensor.pin) return false;
    }
    return true;
}

bool validateSensorConfig(const SensorDescriptor& desc) {
    if (!desc.enabled) return false;
    if (!desc.profileConfirmed) return false;
    if (!isConfiguredBoardPinAllowed(GASGUARD_BOARD_VARIANT, desc.pin)) return false;
    if (desc.inputScale <= 0.0f) return false;
    return true;
}
