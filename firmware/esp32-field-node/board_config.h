#ifndef GASGUARD_BOARD_CONFIG_H
#define GASGUARD_BOARD_CONFIG_H

#include <stdint.h>

// Board Identification Placeholder (Must be configured per board variant)
#define GASGUARD_BOARD_VARIANT "ESP32_GENERIC_WROOM32"

// ADC Pin Selection (ADC1 pins ONLY: GPIO 32, 33, 34, 35, 36, 39)
// Note: Actual pins must be verified with physical board schematic & voltage divider before locking.
#define MQ6_ADC_PIN_PLACEHOLDER 34  // ADC1_CHANNEL_6 (GPI 34 - Input Only)
#define MQ3_ADC_PIN_PLACEHOLDER 35  // ADC1_CHANNEL_7 (GPI 35 - Input Only)

// Default ADC Attenuation: ADC_ATTEN_DB_12 (0 to 3.3V range)
#define GASGUARD_DEFAULT_ADC_ATTENUATION 3  // 3 = 12dB on ESP32 Arduino / ESP-IDF

// Default External Voltage Divider Scaling Factor (AO voltage / ADC pin voltage)
// Example: R1=10k, R2=20k -> (10k+20k)/20k = 1.5 scaling factor for 5V max AO to 3.3V max ADC
#define GASGUARD_DEFAULT_INPUT_SCALE 1.5f

// Serial Diagnostic Baud Rate
#define GASGUARD_SERIAL_BAUD 115200

#endif // GASGUARD_BOARD_CONFIG_H
