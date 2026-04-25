#include <unity.h>
#include "lib/motor_command.h"

using namespace orobot;

void test_clampAngle_within_range(void) {
  TEST_ASSERT_EQUAL_INT(45, clampAngle(45, 0, 180));
}
void test_clampAngle_below_min(void) {
  TEST_ASSERT_EQUAL_INT(0, clampAngle(-10, 0, 180));
}
void test_clampAngle_above_max(void) {
  TEST_ASSERT_EQUAL_INT(180, clampAngle(999, 0, 180));
}
void test_stepsForAngleDelta_positive(void) {
  // 200 steps/rev, 90° target → 50 steps
  TEST_ASSERT_EQUAL_INT(50, stepsForAngleDelta(0, 90, 200));
}
void test_stepsForAngleDelta_negative(void) {
  // -90° → -50 steps (sign preserved for direction)
  TEST_ASSERT_EQUAL_INT(-50, stepsForAngleDelta(0, -90, 200));
}
void test_stepsForAngleDelta_zero(void) {
  TEST_ASSERT_EQUAL_INT(0, stepsForAngleDelta(45, 45, 200));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_clampAngle_within_range);
  RUN_TEST(test_clampAngle_below_min);
  RUN_TEST(test_clampAngle_above_max);
  RUN_TEST(test_stepsForAngleDelta_positive);
  RUN_TEST(test_stepsForAngleDelta_negative);
  RUN_TEST(test_stepsForAngleDelta_zero);
  return UNITY_END();
}
