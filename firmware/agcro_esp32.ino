/* AGCRO ESP32 DevKit V1 Sensor Node Firmware
 * Hardware: Capacitive Soil Moisture Sensor (v1.2), Adafruit SHT31-D (I2C 0x44).
 *
 * SECURITY ARCHITECTURE:
 * 1. Per-device authentication: Each physical device is assigned a unique cryptographically
 *    random token upon provisioning in AGCRO.
 * 2. Bearer Authentication: The device sends this token in the `Authorization: Bearer <DEVICE_TOKEN>` header.
 * 3. Server-side validation: AGCRO hashes the token with SHA-256 and verifies the device identity,
 *    mapping authorization (device-to-farm and device-to-zone), and active (non-revoked) status.
 * 4. IMPORTANT: Do NOT use the placeholder "REPLACE_WITH_PROVISIONED_DEVICE_TOKEN" in production.
 *    The AGCRO server strictly rejects placeholder or unregistered tokens (HTTP 401 Unauthorized)
 *    and revoked devices (HTTP 403 Forbidden).
 * 5. Fail-safe principle: The device sends sensor readings only; it never operates pumps or actuators.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_SHT31.h>

// --- Network and Server Configuration ---
const char* WIFI_SSID = "REPLACE_WIFI_SSID";
const char* WIFI_PASSWORD = "REPLACE_WIFI_PASSWORD";
const char* API_URL = "https://YOUR_AGCRO_HOST/api/sensor-readings";

// --- Device Identity & Credentials ---
// Must match registered device in AGCRO sensor_devices registry
const char* DEVICE_ID = "esp32-plot-a";
const char* FARM_ID = "farm-1";
const char* ZONE_ID = "zone-1";

// Provisioned secret token for this specific device. Keep confidential.
// For local testing with the demo dataset, use the demo token:
// "agcro_device_plot_a_token_2026"
const char* DEVICE_TOKEN = "REPLACE_WITH_PROVISIONED_DEVICE_TOKEN";

// --- Hardware Calibration ---
const int MOISTURE_PIN = 34;
const int DRY_RAW = 3100;  // Calibrate in dry target soil.
const int WET_RAW = 1200;  // Calibrate in water/saturated soil.
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

  Serial.println("AGCRO ESP32 Node Initializing...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected. Device ready.");
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

      // JSON telemetry payload
      String body = String("{\"deviceId\":\"") + DEVICE_ID +
        String("\",\"farmId\":\"") + FARM_ID +
        String("\",\"zoneId\":\"") + ZONE_ID +
        String("\",\"soilMoisturePct\":") + String(moisturePercent(), 1) +
        String(",\"temperatureC\":") + String(temperature, 1) +
        String(",\"humidityPct\":") + String(humidity, 1) +
        String(",\"source\":\"LIVE_SENSOR\"}");

      int status = http.POST(body);
      String response = http.getString();

      if (status == 200 || status == 201) {
        Serial.printf("AGCRO Telemetry Delivered Successfully: HTTP %d\n", status);
      } else if (status == 401) {
        Serial.println("AUTHENTICATION ERROR (HTTP 401): Invalid or missing device token.");
      } else if (status == 403) {
        Serial.println("ACCESS FORBIDDEN (HTTP 403): Device has been REVOKED by farm administrator.");
      } else if (status == 422) {
        Serial.println("MAPPING MISMATCH (HTTP 422): Device is not registered to this farm/zone.");
      } else {
        Serial.printf("AGCRO Post Error: HTTP %d, Response: %s\n", status, response.c_str());
      }
      http.end();
    } else {
      Serial.println("SHT31 sensor read fault: reading skipped to avoid transmitting invalid telemetry.");
    }
  } else {
    Serial.println("Wi-Fi disconnected: reading held, reconnecting...");
    WiFi.reconnect();
  }

  delay(300000); // 5-minute sampling cadence
}
