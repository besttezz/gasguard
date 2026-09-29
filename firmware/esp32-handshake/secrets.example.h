#pragma once

// Copy this file to secrets.h (git-ignored) and replace every placeholder before flashing.
#define GASGUARD_WIFI_SSID "true_home2G_248"
#define GASGUARD_WIFI_PASSWORD "7u393g45"

// 64-character device key issued by the software team (send privately, never commit).
#define GASGUARD_DEVICE_KEY "<64_HEX_DEVICE_KEY>"

// Internet (any WiFi): the GasGuard website. Same-WiFi computer test: http://<COMPUTER_LAN_IPV4>:5567/api/v1/device/telemetry
#define GASGUARD_SERVER_URL "https://gasguard-bu.pages.dev/api/v1/device/telemetry"

// Uncomment to send the real MQ-6 reading (raw ADC + voltage) instead of synthetic handshake values.
// Use an ADC1 pin (GPIO 32-39) behind a voltage divider: MQ modules output up to 5 V, ESP32 accepts 3.3 V.
#define GASGUARD_MQ6_ADC_PIN 35
