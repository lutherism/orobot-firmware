#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  Serial.println("{\"event\":\"boot\",\"version\":\"" STATION_FIRMWARE_VERSION "\"}");
}

void loop() {
  delay(1000);
}
