#pragma once

namespace orobot {

inline int clampAngle(int angle, int min, int max) {
  if (angle < min) return min;
  if (angle > max) return max;
  return angle;
}

// stepsPerRev = full revolution step count for the motor in use.
// Returns signed steps; negative means reverse direction.
inline int stepsForAngleDelta(int currentAngle, int targetAngle, int stepsPerRev) {
  const int delta = targetAngle - currentAngle;
  return (delta * stepsPerRev) / 360;
}

}  // namespace orobot
