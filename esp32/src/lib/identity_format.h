// Pure identity-formatting helpers — no Arduino dependency.
//
// Hex encoding and RFC 4122 v4 UUID formatting from a 16-byte buffer.
// `nvs_store::generateIdentity()` calls these on a buffer filled by
// `esp_random()`; the host tests fill the buffer with deterministic bytes.

#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <string>

namespace orobot {

inline std::string hexEncode(const std::uint8_t* buf, std::size_t n) {
  static constexpr char kHex[] = "0123456789abcdef";
  std::string out;
  out.reserve(n * 2);
  for (std::size_t i = 0; i < n; ++i) {
    out.push_back(kHex[(buf[i] >> 4) & 0xF]);
    out.push_back(kHex[buf[i] & 0xF]);
  }
  return out;
}

// Format 16 bytes as `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. Caller is
// responsible for setting the version (byte 6 high nibble = 0x4) and variant
// (byte 8 top two bits = 0b10) bits per RFC 4122.
inline std::string formatUuid(const std::uint8_t b[16]) {
  char out[37];
  std::snprintf(
      out, sizeof(out),
      "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
      b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11],
      b[12], b[13], b[14], b[15]);
  return std::string(out);
}

// Apply RFC 4122 v4 version + variant bits in-place to a 16-byte buffer.
inline void applyUuidV4Bits(std::uint8_t b[16]) {
  b[6] = (b[6] & 0x0F) | 0x40;  // version 4
  b[8] = (b[8] & 0x3F) | 0x80;  // variant 1
}

}  // namespace orobot
