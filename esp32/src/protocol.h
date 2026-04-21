// ESP32 orobot device-control protocol dispatcher.
//
// Parses the small command subset required for the first ESP32 actuator port:
// ping/pong, pin control, pin readback, and 4-wire stepper motion.

#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

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
  String handleRunStepper(const JsonArrayConst& pins, long steps, long delay_us);
  String ack(const char* type, bool ok, const String& data = String());
  bool isSafePin(long pin, bool force) const;
};

}  // namespace orobot
