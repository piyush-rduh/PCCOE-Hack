/* AGCRO ESP32 DevKit V1 example
 * Hardware: capacitive soil moisture sensor, SHT31-D, optional water level.
 * Replace calibration bounds, Wi-Fi, endpoint, and device token before use.
 * The device sends readings only; it never controls a pump.
 */
#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>

const char* WIFI_SSID = "REPLACE_WIFI_SSID";
const char* WIFI_PASSWORD = "REPLACE_WIFI_PASSWORD";
const char* API_URL = "https://YOUR_AGCRO_HOST/api/sensor-readings";
const char* DEVICE_ID = "esp32-plot-a";
const char* FARM_ID = "farm-1";
const char* ZONE_ID = "zone-1";
const char* DEVICE_TOKEN = "REPLACE_DEVICE_TOKEN";
const int MOISTURE_PIN = 34;
const int DRY_RAW = 3100;  // Calibrate in the target soil.
const int WET_RAW = 1200;  // Calibrate in the target soil.
Adafruit_SHT31 sht31 = Adafruit_SHT31();

float moisturePercent() {
  int raw = analogRead(MOISTURE_PIN);
  float pct = 100.0f * (DRY_RAW - raw) / float(DRY_RAW - WET_RAW);
  return constrain(pct, 0.0f, 100.0f);
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  sht31.begin(0x44);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    float temperature = sht31.readTemperature();
    float humidity = sht31.readHumidity();
    if (!isnan(temperature) && !isnan(humidity)) {
      HTTPClient http;
      http.begin(API_URL);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
      String body = String("{\"deviceId\":\"") + DEVICE_ID +
        String("\",\"farmId\":\"") + FARM_ID +
        String("\",\"zoneId\":\"") + ZONE_ID +
        String("\",\"soilMoisturePct\":") + String(moisturePercent(), 1) +
        String(",\"temperatureC\":") + String(temperature, 1) +
        String(",\"humidityPct\":") + String(humidity, 1) +
        String(",\"source\":\"LIVE_SENSOR\"}");
      int status = http.POST(body);
      Serial.printf("AGCRO reading POST status: %d\n", status);
      http.end();
    } else {
      Serial.println("SHT31 fault: reading rejected; no fake value sent");
    }
  } else {
    Serial.println("Wi-Fi offline: reading not sent; reconnecting");
    WiFi.reconnect();
  }
  delay(300000); // five-minute cadence; tune after field validation.
}
