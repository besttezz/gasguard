/* ============================================================
   GasGuard — ตัวอย่างโค้ดสำหรับ ESP32 / ESP8266
   ส่งค่าจากเซ็นเซอร์แก๊ส (MQ-2 / MQ-5 / MQ-135) ขึ้นระบบ GasGuard

   เลือกวิธีส่งได้ 2 แบบ (ตั้งค่าที่ USE_MQTT ด้านล่าง)
     1) MQTT  → เว็บ subscribe ผ่าน WebSocket โดยตรง (ไม่ต้องมีเซิร์ฟเวอร์ของเราเอง)
     2) HTTP  → POST ไปที่เซิร์ฟเวอร์ในโฟลเดอร์ server/ แล้วเว็บดึงผ่าน REST API

   ไลบรารีที่ต้องติดตั้งใน Arduino IDE:
     - PubSubClient (โดย Nick O'Leary)   ← เฉพาะโหมด MQTT
     - ArduinoJson (โดย Benoit Blanchon)
   ============================================================ */

#include <WiFi.h>            // ESP8266 ให้เปลี่ยนเป็น <ESP8266WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>

/* ---------------- ตั้งค่าผู้ใช้ ---------------- */
#define USE_MQTT      true          // true = ส่งผ่าน MQTT, false = ส่งผ่าน HTTP POST

const char* WIFI_SSID     = "ชื่อ-WiFi";
const char* WIFI_PASSWORD = "รหัสผ่าน-WiFi";

// รหัสอุปกรณ์ — ต้องตรงกับ "รหัสอุปกรณ์ (Device ID)" ในหน้าจัดการเซ็นเซอร์ของเว็บ
const char* DEVICE_ID = "kitchen-01";

// --- โหมด MQTT ---
const char* MQTT_HOST  = "broker.hivemq.com";   // broker สาธารณะสำหรับทดลอง
const int   MQTT_PORT  = 1883;                  // ฝั่งบอร์ดใช้ TCP 1883, ฝั่งเว็บใช้ wss 8884
const char* MQTT_USER  = "";                    // เว้นว่างถ้าไม่มี
const char* MQTT_PASS  = "";
// topic ที่เว็บ subscribe คือ gasguard/+/reading
String MQTT_TOPIC = String("gasguard/") + DEVICE_ID + "/reading";

// --- โหมด HTTP ---
const char* API_URL = "https://your-server.example.com/api/readings";
const char* API_KEY = "gasguard-demo-key";

/* ---------------- ขา/การสอบเทียบเซ็นเซอร์ ---------------- */
const int   GAS_PIN       = 34;      // ขา ADC ที่ต่อ AO ของ MQ sensor
const float RL            = 10.0;    // โหลดรีซิสเตอร์บนโมดูล (kΩ)
float       R0            = 10.0;    // ค่า R0 จากการสอบเทียบในอากาศสะอาด
const unsigned long SEND_INTERVAL = 5000;   // ส่งทุก 5 วินาที
const int   WARMUP_SECONDS = 20;     // อุ่นเซ็นเซอร์ก่อนเริ่มอ่าน

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);
unsigned long lastSend = 0;

/* ---------- อ่านค่าและแปลงเป็น PPM (สูตรโดยประมาณของ MQ-2 สำหรับ LPG) ---------- */
float readRs() {
  long sum = 0;
  for (int i = 0; i < 20; i++) { sum += analogRead(GAS_PIN); delay(5); }
  float adc = sum / 20.0;
  float volt = adc * (3.3 / 4095.0);          // ESP32 ADC 12 บิต
  if (volt < 0.01) volt = 0.01;
  return (3.3 - volt) / volt * RL;            // Rs (kΩ)
}

float readPPM() {
  float ratio = readRs() / R0;
  // เส้นโค้ง log-log โดยประมาณ: ppm = a * (Rs/R0)^b
  float ppm = 1000.0 * pow(ratio, -2.05);
  if (ppm < 0) ppm = 0;
  if (ppm > 10000) ppm = 10000;
  return ppm;
}

/* ---------- สอบเทียบ R0 ในอากาศสะอาด (เรียกครั้งเดียวตอน setup) ---------- */
void calibrateR0() {
  float sum = 0;
  for (int i = 0; i < 30; i++) { sum += readRs(); delay(100); }
  R0 = (sum / 30.0) / 9.83;    // 9.83 = Rs/R0 ในอากาศสะอาดของ MQ-2 (ดูดาต้าชีตของรุ่นที่ใช้)
  Serial.printf("ค่า R0 ที่สอบเทียบได้: %.2f kΩ\n", R0);
}

/* ---------- WiFi ---------- */
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("กำลังเชื่อมต่อ WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.printf("\nเชื่อมต่อแล้ว: %s\n", WiFi.localIP().toString().c_str());
}

/* ---------- MQTT ---------- */
void connectMQTT() {
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  while (!mqtt.connected()) {
    String cid = String("gasguard-") + DEVICE_ID + "-" + String(random(0xffff), HEX);
    bool ok = (strlen(MQTT_USER) > 0)
      ? mqtt.connect(cid.c_str(), MQTT_USER, MQTT_PASS)
      : mqtt.connect(cid.c_str());
    if (ok) Serial.println("MQTT เชื่อมต่อสำเร็จ");
    else { Serial.printf("MQTT ล้มเหลว rc=%d ลองใหม่ใน 3 วิ\n", mqtt.state()); delay(3000); }
  }
}

/* ---------- ส่งข้อมูล ---------- */
void sendReading(float ppm, float temp, float hum) {
  StaticJsonDocument<200> doc;
  doc["id"]       = DEVICE_ID;
  doc["ppm"]      = (int)ppm;
  doc["temp"]     = temp;
  doc["humidity"] = hum;

  char payload[200];
  serializeJson(doc, payload);
  Serial.println(payload);

#if USE_MQTT
  if (!mqtt.connected()) connectMQTT();
  mqtt.publish(MQTT_TOPIC.c_str(), payload, true);   // retain = true
#else
  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  int code = http.POST(payload);
  Serial.printf("HTTP %d\n", code);
  http.end();
#endif
}

void setup() {
  Serial.begin(115200);
  delay(500);
  analogSetAttenuation(ADC_11db);        // ให้ ADC อ่านได้ถึง ~3.3V
  Serial.printf("อุ่นเซ็นเซอร์ %d วินาที…\n", WARMUP_SECONDS);
  delay(WARMUP_SECONDS * 1000);
  calibrateR0();
  connectWiFi();
#if USE_MQTT
  connectMQTT();
#endif
}

void loop() {
#if USE_MQTT
  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();
#endif
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();
    float ppm = readPPM();
    // ถ้ามี DHT22 ให้แทนค่าจริงตรงนี้
    float temp = 30.0;
    float hum  = 60.0;
    sendReading(ppm, temp, hum);
  }
}
