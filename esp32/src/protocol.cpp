// ESP32 orobot device-control protocol dispatcher.

#include "protocol.h"

#if defined(ARDUINO)

#include <ArduinoJson.h>
#include <cstring>

namespace orobot {

namespace {
constexpr long kInvalidPin = -1;
}

String Protocol::handle(const String& raw) {
  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, raw);
  if (err) {
    Serial.print("protocol malformed json: ");
    Serial.println(err.c_str());
    return String();
  }

  const char* type = doc["type"] | "";
  if (strcmp(type, "ping") == 0) {
    return handlePing();
  }
  if (strcmp(type, "set-pin") == 0) {
    return handleSetPin(doc["pin"] | kInvalidPin,
                        doc["mode"] | "",
                        doc["value"] | 0);
  }
  if (strcmp(type, "read-pin") == 0) {
    return handleReadPin(doc["pin"] | kInvalidPin);
  }
  if (strcmp(type, "run-stepper") == 0) {
    return handleRunStepper(doc["pins"].as<JsonArrayConst>(),
                            doc["steps"] | 0,
                            doc["delay_us"] | 0);
  }

  Serial.print("protocol unknown type: ");
  Serial.println(type);
  return ack(type, false, "unknown-command");
}

String Protocol::handlePing() {
  return ack("ping", true, "pong");
}

String Protocol::handleSetPin(long pin, const String& mode, long value) {
  if (!isSafePin(pin, /*force=*/false)) {
    Serial.print("protocol set-pin blocked pin=");
    Serial.println(pin);
    return ack("set-pin", false, "unsafe-pin");
  }

  const uint8_t pin8 = static_cast<uint8_t>(pin);
  if (mode == "INPUT") {
    pinMode(pin8, INPUT);
  } else if (mode == "OUTPUT") {
    pinMode(pin8, OUTPUT);
    digitalWrite(pin8, value != 0 ? HIGH : LOW);
  } else if (mode == "INPUT_PULLUP") {
    pinMode(pin8, INPUT_PULLUP);
  } else {
    return ack("set-pin", false, "bad-mode");
  }

  Serial.print("protocol set-pin pin=");
  Serial.print(pin);
  Serial.print(" mode=");
  Serial.print(mode);
  Serial.print(" value=");
  Serial.println(value);
  return ack("set-pin", true);
}

String Protocol::handleReadPin(long pin) {
  if (!isSafePin(pin, /*force=*/false)) {
    return ack("read-pin", false, "unsafe-pin");
  }

  const uint8_t pin8 = static_cast<uint8_t>(pin);
  const int value = digitalRead(pin8);
  Serial.print("protocol read-pin pin=");
  Serial.print(pin);
  Serial.print(" value=");
  Serial.println(value);
  return ack("read-pin", true, String(value));
}

String Protocol::handleRunStepper(const JsonArrayConst& pins, long steps, long delay_us) {
  if (pins.size() != 4) {
    return ack("run-stepper", false, "bad-pins");
  }

  long pin_values[4];
  for (size_t i = 0; i < 4; ++i) {
    pin_values[i] = pins[i] | kInvalidPin;
    if (!isSafePin(pin_values[i], /*force=*/false)) {
      return ack("run-stepper", false, "unsafe-pin");
    }
  }

  for (size_t i = 0; i < 4; ++i) {
    pinMode(static_cast<uint8_t>(pin_values[i]), OUTPUT);
  }

  const long total_steps = steps >= 0 ? steps : -steps;
  const uint8_t sequence[4][4] = {
      {HIGH, LOW, LOW, LOW},
      {LOW, HIGH, LOW, LOW},
      {LOW, LOW, HIGH, LOW},
      {LOW, LOW, LOW, HIGH},
  };

  for (long i = 0; i < total_steps; ++i) {
    const size_t phase = static_cast<size_t>(i & 3);
    for (size_t pin_index = 0; pin_index < 4; ++pin_index) {
      digitalWrite(static_cast<uint8_t>(pin_values[pin_index]), sequence[phase][pin_index]);
    }
    if (delay_us > 0) {
      delayMicroseconds(static_cast<unsigned int>(delay_us));
    }
  }

  Serial.print("protocol run-stepper steps=");
  Serial.print(steps);
  Serial.print(" delay_us=");
  Serial.println(delay_us);
  return ack("run-stepper", true);
}

String Protocol::ack(const char* type, bool ok, const String& data) {
  JsonDocument doc;
  doc["type"] = "message-ack";
  doc["deviceUuid"] = "";
  doc["ackType"] = type;
  doc["ok"] = ok;
  if (data.length() > 0) {
    doc["data"] = data;
  }
  String out;
  serializeJson(doc, out);
  return out;
}

bool Protocol::isSafePin(long pin, bool force) const {
  if (force) return true;
  switch (pin) {
    case 0:
    case 2:
    case 5:
    case 12:
    case 15:
      return false;
    default:
      return pin >= 0 && pin <= 39;
  }
}

}  // namespace orobot

#endif  // ARDUINO
