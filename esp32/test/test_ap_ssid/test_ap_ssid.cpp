#include <unity.h>

#include "lib/ap_ssid.h"

using orobot::apSsidFromMacPure;

void test_ap_ssid_uses_low_two_bytes(void) {
  // MAC e0:8c:fe:33:e3:60 → AP SSID should be orobot-setup-E360
  // (last two bytes, uppercase hex). This matches the device flashed during
  // bring-up on 2026-04-25.
  const std::uint64_t mac = 0xE08CFE33E360ULL;
  TEST_ASSERT_EQUAL_STRING("orobot-setup-E360", apSsidFromMacPure(mac).c_str());
}

void test_ap_ssid_zero_pads(void) {
  // Low byte 0x05 should render as "05", not "5".
  const std::uint64_t mac = 0x000000000105ULL;
  TEST_ASSERT_EQUAL_STRING("orobot-setup-0105", apSsidFromMacPure(mac).c_str());
}

void test_ap_ssid_ignores_high_bytes(void) {
  // Only the low 16 bits matter — collisions for a single user are rare and
  // captive-portal detectors don't care.
  const std::uint64_t a = 0x1122334455AAULL;
  const std::uint64_t b = 0xAABBCCDD55AAULL;
  TEST_ASSERT_EQUAL_STRING(apSsidFromMacPure(a).c_str(),
                           apSsidFromMacPure(b).c_str());
}

void test_ap_ssid_length(void) {
  // "orobot-setup-" (13) + 4 hex = 17 chars. Stays comfortably under the
  // SoftAP SSID limit of 32.
  const auto s = apSsidFromMacPure(0xDEADBEEFCAFEULL);
  TEST_ASSERT_EQUAL_UINT(17, s.size());
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_ap_ssid_uses_low_two_bytes);
  RUN_TEST(test_ap_ssid_zero_pads);
  RUN_TEST(test_ap_ssid_ignores_high_bytes);
  RUN_TEST(test_ap_ssid_length);
  return UNITY_END();
}
