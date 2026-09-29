#pragma once

// TEMPLATE ONLY — this file is public on GitHub. Keep the <...> placeholders here.
// Copy it to secrets.h in this folder (git-ignored) and put real values in that copy.
#define GASGUARD_WIFI_SSID "<YOUR_WIFI_SSID>"
#define GASGUARD_WIFI_PASSWORD "<YOUR_WIFI_PASSWORD>"

// 64-character device key issued by the software team (send privately, never commit).
#define GASGUARD_DEVICE_KEY "<64_HEX_DEVICE_KEY>"

// Internet (any WiFi): the GasGuard website. Same-WiFi computer test: http://<COMPUTER_LAN_IPV4>:5567/api/v1/device/telemetry
#define GASGUARD_SERVER_URL "https://gasguard-bu.pages.dev/api/v1/device/telemetry"

// Uncomment the sensors that are wired to send real readings (raw ADC + voltage) instead of
// synthetic handshake values. Use ADC1 pins (GPIO 32-39) behind a voltage divider: MQ modules
// output up to 5 V, ESP32 accepts 3.3 V. Each sensor needs its own pin.
// Pins below match the team's current wiring.
// #define GASGUARD_MQ6_ADC_PIN 35   // MQ-6: main LPG sensor
// #define GASGUARD_MQ2_ADC_PIN 34   // MQ-2: LPG / smoke sensor
