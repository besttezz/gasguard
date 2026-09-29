#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
// Real WiFi password and device key live only in secrets.h, which git never uploads.
// Never point this include at secrets.example.h: that file is public on GitHub.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Missing secrets.h: copy secrets.example.h to secrets.h (same folder), fill in WiFi and device key, then compile again. Do not put real values in secrets.example.h."
#endif
#include "root_ca.h"
#include <math.h>
#include <string.h>

// ==================================================
// Gas calibration (from bench calibration on this device)
// ==================================================
// Voltage divider on the sensor's AO line: AO -> R1 -> ESP32 pin -> R2 -> GND
static const float GASGUARD_RL_VALUE   = 10.0f;   // kOhm, load resistor on the sensor module
static const float GASGUARD_SENSOR_VCC = 5.0f;    // volts, sensor supply
static const float GASGUARD_R1 = 10.0f;
static const float GASGUARD_R2 = 20.0f;
static const float GASGUARD_DIVIDER_RATIO = (GASGUARD_R1 + GASGUARD_R2) / GASGUARD_R2;

static const float GASGUARD_RO_MQ2 = 7.5f;   // kOhm, measured in clean air
static const float GASGUARD_RO_MQ6 = 2.0f;   // kOhm, measured in clean air

// log10(ppm) = (log10(Rs/Ro) - intercept) / slope
// intercept = y - slope*x, from the {x, y, slope} two-point form in each datasheet's LPG curve
struct GasGuardCurve {
  const char* name;
  float slope;
  float intercept;
};
static const GasGuardCurve GASGUARD_MQ2_CURVE = { "LPG", -0.47f, 1.291f };
static const GasGuardCurve GASGUARD_MQ6_CURVE = { "LPG", -0.41f, 1.243f };

static float gasguardCalculateRs(float pinVoltage) {
  float sensorV = pinVoltage * GASGUARD_DIVIDER_RATIO;
  if (sensorV < 0.01f) sensorV = 0.01f;
  if (sensorV > GASGUARD_SENSOR_VCC - 0.01f) sensorV = GASGUARD_SENSOR_VCC - 0.01f;
  return ((GASGUARD_SENSOR_VCC - sensorV) * GASGUARD_RL_VALUE) / sensorV;
}

static float gasguardCalculatePpm(float rs, float ro, const GasGuardCurve& curve) {
  if (rs <= 0 || ro <= 0) return 0;
  const float ratio = rs / ro;
  const float logPpm = (log10(ratio) - curve.intercept) / curve.slope;
  const float ppm = pow(10, logPpm);
  if (isnan(ppm) || isinf(ppm)) return 0;
  return ppm;
}

// Two modes, chosen in secrets.h:
// - Handshake (default): fixed synthetic values to prove WiFi -> HTTPS -> dashboard. NOT gas readings.
// - Sensor mode: define GASGUARD_MQ6_ADC_PIN and/or GASGUARD_MQ2_ADC_PIN to send each wired
//   sensor's ADC, voltages, Rs and an estimated LPG ppm from the bench calibration above.
//   MQ-6 is the primary LPG channel; MQ-2 (LPG/smoke) is reported as its own channel and never
//   merged into the MQ-6 value.
#if defined(GASGUARD_MQ6_ADC_PIN) || defined(GASGUARD_MQ2_ADC_PIN)
#define GASGUARD_RAW_SENSOR_MODE 1
#endif
static const float SYNTHETIC_MQ6_PPM = 120.0f;
static const float SYNTHETIC_MQ3_PPM = 60.0f;
static const bool SEND_OPTIONAL_MQ3 = false;
static const unsigned long SEND_INTERVAL_MS = 10000;

String bootId;
uint32_t mq6Sequence = 0;
uint32_t mq3Sequence = 0;
uint32_t mq2Sequence = 0;
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

String buildPayload(const char* sensorId, const char* sensorType, uint32_t sequence, const String& timestamp, const String& body) {
  return String("{\"deviceId\":\"ESP32-KITCHEN-01\",\"sensorId\":\"") + sensorId +
    "\",\"sensorType\":\"" + sensorType + "\",\"bootId\":\"" + bootId +
    "\",\"sequence\":" + String(sequence) + ",\"timestamp\":\"" + timestamp + "\"," + body + "}";
}

// Returns the HTTP status (202 = stored), or a negative HTTPClient/TLS error.
int postPacket(const String& payload, bool synthetic) {
  const String url = GASGUARD_SERVER_URL;
  WiFiClientSecure secureClient;
  HTTPClient http;
  bool started;
  if (url.startsWith("https://")) {
    secureClient.setCACert(GASGUARD_ROOT_CA_BUNDLE);  // certificate is always verified
    started = http.begin(secureClient, url);
  } else {
    started = http.begin(url);  // plain HTTP only for a computer on the same WiFi
  }
  if (!started) return -100;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", GASGUARD_DEVICE_KEY);
  if (synthetic) http.addHeader("x-gasguard-data-classification", "SYNTHETIC_HANDSHAKE");
  const int status = http.POST(payload);
  if (status > 0) Serial.println(http.getString());
  http.end();
  return status;
}

bool sendWithRetry(const char* sensorId, const String& payload, uint32_t sequence, bool synthetic) {
  for (int attempt = 1; attempt <= 3; attempt++) {
    if (WiFi.status() != WL_CONNECTED) connectWiFi();
    const int status = postPacket(payload, synthetic);
    Serial.printf("%s sequence=%u attempt=%d HTTP=%d\n", sensorId, sequence, attempt, status);
    if (status == 202) return true;
    if (status >= 400 && status < 500) return false;
    delay(1000 * attempt);
  }
  return false;
}

bool sendSynthetic(const char* sensorId, const char* sensorType, float ppm, uint32_t sequence) {
  const String timestamp = utcTimestamp();
  if (timestamp.isEmpty()) { Serial.println("Time unavailable, packet not sent"); return false; }
  const String payload = buildPayload(sensorId, sensorType, sequence, timestamp,
    String("\"raw\":{},\"upstreamPpm\":") + String(ppm, 1));
  return sendWithRetry(sensorId, payload, sequence, true);
}

#ifdef GASGUARD_RAW_SENSOR_MODE
// sensorType selects which calibration curve and Ro to apply ("MQ6" or "MQ2").
// Any other sensorType is sent uncalibrated, since no curve/Ro exists for it yet.
bool sendRawSensor(const char* sensorId, const char* sensorType, uint8_t pin, uint32_t sequence) {
  const String timestamp = utcTimestamp();
  if (timestamp.isEmpty()) { Serial.println("Time unavailable, packet not sent"); return false; }

  const int adc = analogRead(pin);
  const float pinVolts = analogReadMilliVolts(pin) / 1000.0f;   // voltage at the ESP32 pin
  const float sensorVolts = pinVolts * GASGUARD_DIVIDER_RATIO;  // true AO voltage after the divider
  const float rs = gasguardCalculateRs(pinVolts);

  bool haveCurve = true;
  float ro = 0, ppm = 0;
  const char* gasName = "";

  if (strcmp(sensorType, "MQ6") == 0) {
    ro = GASGUARD_RO_MQ6;
    ppm = gasguardCalculatePpm(rs, ro, GASGUARD_MQ6_CURVE);
    gasName = GASGUARD_MQ6_CURVE.name;
  } else if (strcmp(sensorType, "MQ2") == 0) {
    ro = GASGUARD_RO_MQ2;
    ppm = gasguardCalculatePpm(rs, ro, GASGUARD_MQ2_CURVE);
    gasName = GASGUARD_MQ2_CURVE.name;
  } else {
    haveCurve = false;
  }

  Serial.printf("%s raw adc=%d pinVoltage=%.3f V sensorVoltage=%.3f V Rs=%.3f kOhm ppm=%.2f\n",
                sensorType, adc, pinVolts, sensorVolts, rs, ppm);

  // calibrationStatus lives inside "raw" (Raw Measurement contract); the server keeps ppm only when CALIBRATED.
  String body = String("\"raw\":{\"adc\":") + adc +
    ",\"sensorVoltage\":" + String(pinVolts, 3) +
    ",\"inputAdjustedVoltage\":" + String(sensorVolts, 3) +
    ",\"rs\":" + String(rs, 3) +
    ",\"calibrationStatus\":\"" + (haveCurve ? "CALIBRATED" : "CALIBRATION_REQUIRED") + "\"}";

  if (haveCurve) {
    body += String(",\"ro\":") + String(ro, 3) +
      ",\"upstreamPpm\":" + String(ppm, 2) +
      ",\"gas\":\"" + gasName + "\"";
  }

  const String payload = buildPayload(sensorId, sensorType, sequence, timestamp, body);
  return sendWithRetry(sensorId, payload, sequence, false);
}
#endif

void setup() {
  Serial.begin(115200);
  delay(500);
  bootId = "esp32-" + String((uint32_t)(ESP.getEfuseMac() >> 32), HEX) + "-" + String(esp_random(), HEX);
#ifdef GASGUARD_MQ6_ADC_PIN
  analogSetPinAttenuation(GASGUARD_MQ6_ADC_PIN, ADC_11db);
#endif
#ifdef GASGUARD_MQ2_ADC_PIN
  analogSetPinAttenuation(GASGUARD_MQ2_ADC_PIN, ADC_11db);
#endif
  connectWiFi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");  // HTTPS certificate checks need the real time
  Serial.printf("GasGuard sender bootId=%s url=%s\n", bootId.c_str(), GASGUARD_SERVER_URL);
}

void loop() {
  if (millis() - lastSendAt < SEND_INTERVAL_MS) { delay(100); return; }
  lastSendAt = millis();
#ifdef GASGUARD_RAW_SENSOR_MODE
#ifdef GASGUARD_MQ6_ADC_PIN
  if (sendRawSensor("MQ6-01", "MQ6", GASGUARD_MQ6_ADC_PIN, mq6Sequence)) mq6Sequence++;
#endif
#ifdef GASGUARD_MQ2_ADC_PIN
  if (sendRawSensor("MQ2-01", "MQ2", GASGUARD_MQ2_ADC_PIN, mq2Sequence)) mq2Sequence++;
#endif
#else
  if (sendSynthetic("MQ6-01", "MQ6", SYNTHETIC_MQ6_PPM, mq6Sequence)) mq6Sequence++;
  if (SEND_OPTIONAL_MQ3 && sendSynthetic("MQ3-01", "MQ3", SYNTHETIC_MQ3_PPM, mq3Sequence)) mq3Sequence++;
#endif
}
