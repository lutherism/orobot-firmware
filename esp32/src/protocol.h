// ESP32 orobot device-control protocol dispatcher.
//
// Parses the command subset required for the first ESP32 actuator port:
// ping/pong, pin control, pin readback, 4-wire stepper motion,
// load-config (deploy-time slot setup), and command-in (motor commands).

#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include "motor_runtime.h"

namespace orobot {

class Protocol {
 public:
  // Handle one inbound JSON message. Returns a JSON response string to send
  // back to the gateway, or an empty string if the message is malformed.
  String handle(const String& raw);

 private:
  String handlePing();
  String handleSetPin(long pin, const String& mode, long value);
  String handleReadPin(long pin);
  String handleRunStepper(const JsonArray& pins, long steps, long delay_us);
  String handleLoadConfig(const char* dataStr);
  String handleCommandIn(const char* dataStr);
  String ack(const char* type, bool ok, const String& data = String());
  bool isSafePin(long pin, bool force) const;

  MotorRuntime motorRuntime_;
};

}  // namespace orobot
