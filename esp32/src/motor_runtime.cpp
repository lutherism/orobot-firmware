// MotorRuntime — live stepper dispatch.

#if defined(ARDUINO)
#include "motor_runtime.h"

namespace orobot {

void MotorRuntime::applyConfig(const SlotConfig& cfg) {
  slots_.clear();
  for (const auto& s : cfg.all()) {
    pinMode(static_cast<uint8_t>(s.stepPin), OUTPUT);
    pinMode(static_cast<uint8_t>(s.dirPin), OUTPUT);
    digitalWrite(static_cast<uint8_t>(s.stepPin), LOW);
    digitalWrite(static_cast<uint8_t>(s.dirPin), LOW);
    slots_.emplace_back(s);
  }
}

bool MotorRuntime::gotoAngle(const std::string& slotName, int targetAngle) {
  auto* live = findSlot(slotName);
  if (!live) return false;

  const int clamped = clampAngle(targetAngle,
                                 live->config.minAngle,
                                 live->config.maxAngle);
  const int steps = stepsForAngleDelta(live->state.angle(), clamped,
                                       live->config.stepsPerRev);
  const int dir = (steps >= 0) ? HIGH : LOW;
  digitalWrite(static_cast<uint8_t>(live->config.dirPin), dir);

  const int absSteps = (steps >= 0) ? steps : -steps;
  for (int i = 0; i < absSteps; ++i) {
    digitalWrite(static_cast<uint8_t>(live->config.stepPin), HIGH);
    delayMicroseconds(800);
    digitalWrite(static_cast<uint8_t>(live->config.stepPin), LOW);
    delayMicroseconds(800);
  }

  live->state.setAngle(clamped);
  return true;
}

bool MotorRuntime::stop(const std::string& slotName) {
  auto* live = findSlot(slotName);
  if (!live) return false;
  digitalWrite(static_cast<uint8_t>(live->config.stepPin), LOW);
  return true;
}

int MotorRuntime::getAngle(const std::string& slotName) const {
  const auto* live = findSlot(slotName);
  if (!live) return -32768;
  return live->state.angle();
}

bool MotorRuntime::gotoAngleFirstSlot(int targetAngle) {
  if (slots_.empty()) return false;
  return gotoAngle(slots_[0].config.name, targetAngle);
}

bool MotorRuntime::stopFirstSlot() {
  if (slots_.empty()) return false;
  return stop(slots_[0].config.name);
}

MotorRuntime::LiveSlot* MotorRuntime::findSlot(const std::string& name) {
  for (auto& s : slots_) {
    if (s.config.name == name) return &s;
  }
  return nullptr;
}

const MotorRuntime::LiveSlot* MotorRuntime::findSlot(
    const std::string& name) const {
  for (const auto& s : slots_) {
    if (s.config.name == name) return &s;
  }
  return nullptr;
}

}  // namespace orobot
#endif  // ARDUINO
