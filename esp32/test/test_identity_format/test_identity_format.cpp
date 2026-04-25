#include <unity.h>
#include <cstdint>
#include <cstring>

#include "lib/identity_format.h"

using orobot::applyUuidV4Bits;
using orobot::formatUuid;
using orobot::hexEncode;

void test_hexEncode_empty(void) {
  TEST_ASSERT_EQUAL_STRING("", hexEncode(nullptr, 0).c_str());
}

void test_hexEncode_known_bytes(void) {
  const std::uint8_t b[] = {0x00, 0xff, 0xab, 0x01};
  TEST_ASSERT_EQUAL_STRING("00ffab01", hexEncode(b, sizeof(b)).c_str());
}

void test_hexEncode_lowercase(void) {
  // The redeem endpoint and claim_redeem JSON expect lowercase hex
  // (matches the gateway's default device-key format).
  const std::uint8_t b[] = {0xDE, 0xAD, 0xBE, 0xEF};
  TEST_ASSERT_EQUAL_STRING("deadbeef", hexEncode(b, sizeof(b)).c_str());
}

void test_formatUuid_layout(void) {
  std::uint8_t b[16];
  for (std::uint8_t i = 0; i < 16; ++i) b[i] = i;
  TEST_ASSERT_EQUAL_STRING(
      "00010203-0405-0607-0809-0a0b0c0d0e0f", formatUuid(b).c_str());
}

void test_applyUuidV4Bits_sets_version_4(void) {
  std::uint8_t b[16] = {0};
  std::memset(b, 0xFF, sizeof(b));
  applyUuidV4Bits(b);
  // Byte 6 high nibble = 0x4 (version 4)
  TEST_ASSERT_EQUAL_HEX8(0x4F, b[6]);
}

void test_applyUuidV4Bits_sets_variant_10(void) {
  std::uint8_t b[16] = {0};
  std::memset(b, 0xFF, sizeof(b));
  applyUuidV4Bits(b);
  // Byte 8 top two bits = 10 (variant 1) → 0xBF (1011_1111)
  TEST_ASSERT_EQUAL_HEX8(0xBF, b[8]);
}

void test_applyUuidV4Bits_preserves_low_bits(void) {
  std::uint8_t b[16] = {0};
  applyUuidV4Bits(b);
  // Byte 6 low nibble = 0, byte 8 low 6 bits = 0
  TEST_ASSERT_EQUAL_HEX8(0x40, b[6]);
  TEST_ASSERT_EQUAL_HEX8(0x80, b[8]);
}

void test_full_uuid_v4_round_trip(void) {
  // Deterministic byte buffer simulating esp_random output, then format.
  std::uint8_t b[16];
  for (std::uint8_t i = 0; i < 16; ++i) b[i] = static_cast<std::uint8_t>(0xA0 + i);
  applyUuidV4Bits(b);
  const auto s = formatUuid(b);
  // Length: 32 hex + 4 dashes
  TEST_ASSERT_EQUAL_UINT(36, s.size());
  // Version nibble at index 14 (after "xxxxxxxx-xxxx-")
  TEST_ASSERT_EQUAL_CHAR('4', s[14]);
  // Variant nibble at index 19 must be one of 8, 9, a, b
  const char v = s[19];
  TEST_ASSERT_TRUE(v == '8' || v == '9' || v == 'a' || v == 'b');
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_hexEncode_empty);
  RUN_TEST(test_hexEncode_known_bytes);
  RUN_TEST(test_hexEncode_lowercase);
  RUN_TEST(test_formatUuid_layout);
  RUN_TEST(test_applyUuidV4Bits_sets_version_4);
  RUN_TEST(test_applyUuidV4Bits_sets_variant_10);
  RUN_TEST(test_applyUuidV4Bits_preserves_low_bits);
  RUN_TEST(test_full_uuid_v4_round_trip);
  return UNITY_END();
}
