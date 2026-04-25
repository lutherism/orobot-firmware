#pragma once

#include <string>
#include <vector>

namespace orobot {

struct MotorSlot {
  std::string name;
  int stepPin;
  int dirPin;
  int minAngle;
  int maxAngle;
  int homeAngle;
  int stepsPerRev;
};

class SlotConfig {
 public:
  void add(const MotorSlot& s) {
    for (auto& existing : slots_) {
      if (existing.name == s.name) {
        existing = s;
        return;
      }
    }
    slots_.push_back(s);
  }

  const MotorSlot* find(const std::string& name) const {
    for (const auto& s : slots_) {
      if (s.name == name) return &s;
    }
    return nullptr;
  }

  void clear() { slots_.clear(); }

  size_t size() const { return slots_.size(); }

 private:
  std::vector<MotorSlot> slots_;
};

}  // namespace orobot
