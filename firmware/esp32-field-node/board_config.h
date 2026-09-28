#ifndef GASGUARD_BOARD_CONFIG_H
#define GASGUARD_BOARD_CONFIG_H

#include <stdint.h>
#include <Arduino.h>

// =============================================================================
// UNVERIFIED HARDWARE PROFILE WARNING
// DO NOT FLASH THIS FILE AS CONFIRMED FIELD CONFIG.
// Physical board model, ADC pins, and voltage divider ratios must be verified
// at the bench with physical hardware before setting CONFIRMED to true.
// =============================================================================
#define GASGUARD_HARDWARE_PROFILE_CONFIRMED false

#define GASGUARD_BOARD_VARIANT "ESP32_GENERIC_UNVERIFIED"

// ADC Pin Placeholders (ADC1 pins ONLY: GPIO 32, 33, 34, 35, 36, 39)
#define MQ6_ADC_PIN_PLACEHOLDER 34
#define MQ3_ADC_PIN_PLACEHOLDER 35

// Default Attenuation: ADC_11db (approx 150mV to 3100mV measurable input voltage range on classic ESP32)
// Note: Final measurable voltage range depends on exact ESP32 variant and configured attenuation.
#define GASGUARD_DEFAULT_ADC_ATTENUATION ADC_11db

// Default Input Scale (0.0f = Unconfirmed / Not set)
#define GASGUARD_DEFAULT_INPUT_SCALE 0.0f

#define GASGUARD_SERIAL_BAUD 115200

#endif // GASGUARD_BOARD_CONFIG_H
