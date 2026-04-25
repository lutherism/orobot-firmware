// ESP32 orobot device-control protocol dispatcher.

#include "protocol.h"

#if defined(ARDUINO)

#include <ArduinoJson.h>
#include <cstring>
#include <string>
#include "lib/slot_config.h"

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
    return handleRunStepper(doc["pins"].as<JsonArray>(),
                            doc["steps"] | 0,
                            doc["delay_us"] | 0);
  }
  if (strcmp(type, "load-config") == 0) {
    return handleLoadConfig(doc["data"] | static_cast<const char*>(nullptr));
  }
  if (strcmp(type, "command-in") == 0) {
    return handleCommandIn(doc["data"] | static_cast<const char*>(nullptr));
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

String Protocol::handleRunStepper(const JsonArray& pins, long steps, long delay_us) {
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

String Protocol::handleLoadConfig(const char* dataStr) {
  // data is a JSON-stringified string from the gateway deploy pipeline.
  // Inner shape: { config: { motors: [...] }, unitId: "<uuid>" }
  // Each motors[] entry mirrors the MotorSlot fields written by
  // robots-gateway/src/modules/programs/service.ts (load-config emit).
  if (!dataStr) {
    Serial.println("protocol load-config: no data");
    return ack("load-config", false, "no-data");
  }

  JsonDocument inner;
  const DeserializationError err = deserializeJson(inner, dataStr);
  if (err) {
    Serial.print("protocol load-config bad json: ");
    Serial.println(err.c_str());
    return ack("load-config", false, "bad-config-json");
  }

  SlotConfig cfg;
  for (JsonObject m : inner["config"]["motors"].as<JsonArray>()) {
    MotorSlot s;
    s.name = m["name"].as<const char*>() ? m["name"].as<const char*>() : "";
    s.stepPin = m["stepPin"] | -1;
    s.dirPin = m["dirPin"] | -1;
    s.minAngle = m["minAngle"] | 0;
    s.maxAngle = m["maxAngle"] | 180;
    s.homeAngle = m["homeAngle"] | 0;
    s.stepsPerRev = m["stepsPerRev"] | 200;
    cfg.add(s);
  }

  motorRuntime_.applyConfig(cfg);
  Serial.print("protocol load-config: slots=");
  Serial.println(static_cast<int>(motorRuntime_.slotCount()));
  return ack("load-config", true);
}

String Protocol::handleCommandIn(const char* dataStr) {
  // data is a colon-delimited string "<verb>:<arg>" from the cloud sandbox.
  // Example: "gotoangle:90"
  if (!dataStr) {
    Serial.println("protocol command-in: no data");
    return ack("command-in", false, "no-data");
  }

  const std::string s(dataStr);
  const size_t colon = s.find(':');
  const std::string verb = (colon == std::string::npos) ? s : s.substr(0, colon);
  const std::string arg = (colon == std::string::npos) ? "" : s.substr(colon + 1);

  if (verb == "gotoangle") {
    const int angle = atoi(arg.c_str());
    // Bring-up assumption: one motor per device; dispatch to the first loaded
    // slot. The gateway emits no slot field on command-in today.
    // TODO(stage-7): converge gateway to emit explicit slot per command so
    //   multi-motor devices can be addressed without this heuristic.
    const bool ok = motorRuntime_.gotoAngleFirstSlot(angle);
    Serial.print("protocol command-in gotoangle=");
    Serial.print(angle);
    Serial.print(" ok=");
    Serial.println(ok ? "1" : "0");
    return ack("command-in", ok, ok ? "" : "no-slot");
  }

  Serial.print("protocol command-in unknown verb: ");
  Serial.println(verb.c_str());
  return ack("command-in", false, "unknown-verb");
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
