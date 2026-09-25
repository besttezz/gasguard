#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>
#include "secrets.h"

// Handshake-only synthetic values. They are NOT readings from MQ sensors.
static const float SYNTHETIC_MQ6_PPM = 120.0f;
static const float SYNTHETIC_MQ3_PPM = 60.0f;
static const bool SEND_OPTIONAL_MQ3 = false;
static const unsigned long SEND_INTERVAL_MS = 10000;

String bootId;
uint32_t mq6Sequence = 0;
uint32_t mq3Sequence = 0;
unsigned long lastSendAt = 0;

String utcTimestamp() {
  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 5000)) return "";
  char value[25];
  strftime(value, sizeof(value), "%Y-%m-%dT%H:%M:%SZ", &timeInfo);
  return String(value);
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(GASGUARD_WIFI_SSID, GASGUARD_WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print('.'); }
  Serial.printf("\nWiFi connected, IP: %s\n", WiFi.localIP().toString().c_str());
}

bool postSyntheticPacket(const char* sensorId, const char* sensorType, float ppm, uint32_t sequence) {
  const String timestamp = utcTimestamp();
  if (timestamp.isEmpty()) { Serial.println("Time unavailable, packet not sent"); return false; }
  const String payload = String("{\"deviceId\":\"ESP32-KITCHEN-01\",\"sensorId\":\"") + sensorId +
    "\",\"sensorType\":\"" + sensorType + "\",\"bootId\":\"" + bootId +
    "\",\"sequence\":" + String(sequence) + ",\"timestamp\":\"" + timestamp +
    "\",\"raw\":{},\"upstreamPpm\":" + String(ppm, 1) + "}";

  for (int attempt = 1; attempt <= 3; attempt++) {
    if (WiFi.status() != WL_CONNECTED) connectWiFi();
    HTTPClient http;
    http.begin(GASGUARD_SERVER_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-key", GASGUARD_DEVICE_KEY);
    http.addHeader("x-gasguard-data-classification", "SYNTHETIC_HANDSHAKE");
    const int status = http.POST(payload);
    Serial.printf("%s sequence=%u attempt=%d HTTP=%d\n", sensorId, sequence, attempt, status);
    if (status > 0) Serial.println(http.getString());
    http.end();
    if (status == 202) return true;
    if (status >= 400 && status < 500) return false;
    delay(1000 * attempt);
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  bootId = "esp32-" + String((uint32_t)(ESP.getEfuseMac() >> 32), HEX) + "-" + String(esp_random(), HEX);
  connectWiFi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.printf("Synthetic handshake bootId=%s\n", bootId.c_str());
}

void loop() {
  if (millis() - lastSendAt < SEND_INTERVAL_MS) { delay(100); return; }
  lastSendAt = millis();
  if (postSyntheticPacket("MQ6-01", "MQ6", SYNTHETIC_MQ6_PPM, mq6Sequence)) mq6Sequence++;
  if (SEND_OPTIONAL_MQ3 && postSyntheticPacket("MQ3-01", "MQ3", SYNTHETIC_MQ3_PPM, mq3Sequence)) mq3Sequence++;
}
