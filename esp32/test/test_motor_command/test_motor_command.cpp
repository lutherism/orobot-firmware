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

void test_motorState_initialIsHome(void) {
  MotorState ms(/*homeAngle=*/45);
  TEST_ASSERT_EQUAL_INT(45, ms.angle());
}

void test_motorState_applyDelta(void) {
  MotorState ms(0);
  ms.applyDelta(30);
  TEST_ASSERT_EQUAL_INT(30, ms.angle());
  ms.applyDelta(-10);
  TEST_ASSERT_EQUAL_INT(20, ms.angle());
}

void test_motorState_setAngle(void) {
  MotorState ms(0);
  ms.setAngle(90);
  TEST_ASSERT_EQUAL_INT(90, ms.angle());
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
  RUN_TEST(test_motorState_initialIsHome);
  RUN_TEST(test_motorState_applyDelta);
  RUN_TEST(test_motorState_setAngle);
  return UNITY_END();
}
