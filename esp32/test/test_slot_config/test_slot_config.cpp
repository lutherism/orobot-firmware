#include <unity.h>
#include "lib/slot_config.h"

using namespace orobot;

void test_emptyConfig_returnsNullForUnknownSlot(void) {
  SlotConfig cfg;
  TEST_ASSERT_NULL(cfg.find("motor-0"));
}

void test_addSlot_canBeFound(void) {
  SlotConfig cfg;
  cfg.add({"motor-0", /*stepPin=*/14, /*dirPin=*/15, /*minA=*/0, /*maxA=*/180,
           /*homeA=*/0, /*stepsPerRev=*/200});
  const auto* s = cfg.find("motor-0");
  TEST_ASSERT_NOT_NULL(s);
  TEST_ASSERT_EQUAL_INT(14, s->stepPin);
  TEST_ASSERT_EQUAL_INT(200, s->stepsPerRev);
}

void test_addSlot_overwritesExisting(void) {
  SlotConfig cfg;
  cfg.add({"motor-0", 14, 15, 0, 180, 0, 200});
  cfg.add({"motor-0", 22, 23, 0, 360, 90, 400});
  const auto* s = cfg.find("motor-0");
  TEST_ASSERT_EQUAL_INT(22, s->stepPin);
  TEST_ASSERT_EQUAL_INT(400, s->stepsPerRev);
  TEST_ASSERT_EQUAL_INT(90, s->homeAngle);
}

void test_clear_emptiesConfig(void) {
  SlotConfig cfg;
  cfg.add({"motor-0", 14, 15, 0, 180, 0, 200});
  cfg.clear();
  TEST_ASSERT_NULL(cfg.find("motor-0"));
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_emptyConfig_returnsNullForUnknownSlot);
  RUN_TEST(test_addSlot_canBeFound);
  RUN_TEST(test_addSlot_overwritesExisting);
  RUN_TEST(test_clear_emptiesConfig);
  return UNITY_END();
}
