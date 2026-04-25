// MotorRuntime — live stepper state for one device.
//
// Owns the set of motor slots loaded from the most recent load-config
// envelope.  Callers use named slots (from config) or the bring-up
// convenience helpers that act on the first loaded slot.

#pragma once

#if defined(ARDUINO)
#include <Arduino.h>
#include <string>
#include <vector>
#include "lib/motor_command.h"
#include "lib/slot_config.h"

namespace orobot {

class MotorRuntime {
 public:
  // Replace the running slot list with the slots in cfg.
  // Configures GPIO directions for every slot's step/dir pins.
  void applyConfig(const SlotConfig& cfg);

  // Drive the named slot to targetAngle (degrees).
  // Angle is clamped to [minAngle, maxAngle] from config.
  // Returns true on success; false if the slot name is not found or no config
  // has been loaded.
  bool gotoAngle(const std::string& slotName, int targetAngle);

  // Assert step pin LOW for the named slot (immediate halt).
  // Returns false if slot name is unknown.
  bool stop(const std::string& slotName);

  // Dead-reckoning current angle for named slot.
  // Returns -32768 if slot is unknown.
  int getAngle(const std::string& slotName) const;

  // Bring-up convenience: dispatch to the first loaded slot.
  // Returns false if no config has been loaded yet.
  // TODO(stage-7): remove once gateway emits explicit slot per command.
  bool gotoAngleFirstSlot(int targetAngle);
  bool stopFirstSlot();

  size_t slotCount() const { return slots_.size(); }

 private:
  struct LiveSlot {
    MotorSlot config;
    MotorState state;
    explicit LiveSlot(const MotorSlot& c) : config(c), state(c.homeAngle) {}
  };

  std::vector<LiveSlot> slots_;

  LiveSlot* findSlot(const std::string& name);
  const LiveSlot* findSlot(const std::string& name) const;
};

}  // namespace orobot
#endif  // ARDUINO
