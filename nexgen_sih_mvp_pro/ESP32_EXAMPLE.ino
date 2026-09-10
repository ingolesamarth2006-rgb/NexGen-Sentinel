#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_PASSWORD";
const char* endpoint = "http://192.168.1.100:8000/api/sensor-data"; // change laptop IP

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("WiFi connected");
}

void loop() {
  // Replace these demo values with readings from your actual sensors.
  float tilt = 1.20;
  float vibration = 0.12;
  float displacement = 1.10;
  float crack = 0.20;

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(endpoint);
    http.addHeader("Content-Type", "application/json");
    String body = String("{\"node_id\":\"N03\",\"tilt\":") + tilt +
                  ",\"vibration\":" + vibration +
                  ",\"displacement\":" + displacement +
                  ",\"crack\":" + crack +
                  ",\"battery\":92}";
    int code = http.POST(body);
    Serial.printf("POST status: %d\n", code);
    http.end();
  }
  delay(1500);
}
