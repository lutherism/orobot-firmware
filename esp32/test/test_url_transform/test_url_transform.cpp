#include <unity.h>

#include "lib/url_transform.h"

using orobot::parseWsUrl;
using orobot::toHttpApiUrl;

void test_toHttpApiUrl_ws_with_port(void) {
  const auto u = toHttpApiUrl("ws://192.168.1.5:8080/device",
                              "/api/device/claim-code/redeem");
  TEST_ASSERT_EQUAL_STRING(
      "http://192.168.1.5:8080/api/device/claim-code/redeem", u.c_str());
}

void test_toHttpApiUrl_wss_no_port(void) {
  const auto u = toHttpApiUrl("wss://gateway.orobot.io/device",
                              "/api/device/claim-code/redeem");
  TEST_ASSERT_EQUAL_STRING(
      "https://gateway.orobot.io/api/device/claim-code/redeem", u.c_str());
}

void test_toHttpApiUrl_no_path_segment(void) {
  // Some configs omit the trailing /device — still produce a valid URL.
  const auto u = toHttpApiUrl("wss://gateway.orobot.io", "/api/x");
  TEST_ASSERT_EQUAL_STRING("https://gateway.orobot.io/api/x", u.c_str());
}

void test_toHttpApiUrl_rejects_http_scheme(void) {
  const auto u = toHttpApiUrl("http://nope/", "/api/x");
  TEST_ASSERT_EQUAL_STRING("", u.c_str());
}

void test_toHttpApiUrl_rejects_empty(void) {
  const auto u = toHttpApiUrl("", "/api/x");
  TEST_ASSERT_EQUAL_STRING("", u.c_str());
}

void test_parseWsUrl_ws_with_port_path(void) {
  const auto u = parseWsUrl("ws://192.168.86.99:8080/device");
  TEST_ASSERT_TRUE(u.ok);
  TEST_ASSERT_FALSE(u.ssl);
  TEST_ASSERT_EQUAL_STRING("192.168.86.99", u.host.c_str());
  TEST_ASSERT_EQUAL_UINT16(8080, u.port);
  TEST_ASSERT_EQUAL_STRING("/device", u.path.c_str());
}

void test_parseWsUrl_wss_default_port(void) {
  const auto u = parseWsUrl("wss://gateway.orobot.io/device");
  TEST_ASSERT_TRUE(u.ok);
  TEST_ASSERT_TRUE(u.ssl);
  TEST_ASSERT_EQUAL_STRING("gateway.orobot.io", u.host.c_str());
  TEST_ASSERT_EQUAL_UINT16(443, u.port);
  TEST_ASSERT_EQUAL_STRING("/device", u.path.c_str());
}

void test_parseWsUrl_ws_default_port(void) {
  const auto u = parseWsUrl("ws://localhost/device");
  TEST_ASSERT_TRUE(u.ok);
  TEST_ASSERT_FALSE(u.ssl);
  TEST_ASSERT_EQUAL_UINT16(80, u.port);
}

void test_parseWsUrl_no_path_defaults_to_slash(void) {
  const auto u = parseWsUrl("wss://h:8080");
  TEST_ASSERT_TRUE(u.ok);
  TEST_ASSERT_EQUAL_STRING("/", u.path.c_str());
}

void test_parseWsUrl_rejects_http(void) {
  const auto u = parseWsUrl("http://nope/x");
  TEST_ASSERT_FALSE(u.ok);
}

void test_parseWsUrl_rejects_garbage_port(void) {
  const auto u = parseWsUrl("ws://h:abc/x");
  TEST_ASSERT_FALSE(u.ok);
}

void test_parseWsUrl_rejects_empty_host(void) {
  const auto u = parseWsUrl("ws:///x");
  TEST_ASSERT_FALSE(u.ok);
}

void setUp(void) {}
void tearDown(void) {}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_toHttpApiUrl_ws_with_port);
  RUN_TEST(test_toHttpApiUrl_wss_no_port);
  RUN_TEST(test_toHttpApiUrl_no_path_segment);
  RUN_TEST(test_toHttpApiUrl_rejects_http_scheme);
  RUN_TEST(test_toHttpApiUrl_rejects_empty);
  RUN_TEST(test_parseWsUrl_ws_with_port_path);
  RUN_TEST(test_parseWsUrl_wss_default_port);
  RUN_TEST(test_parseWsUrl_ws_default_port);
  RUN_TEST(test_parseWsUrl_no_path_defaults_to_slash);
  RUN_TEST(test_parseWsUrl_rejects_http);
  RUN_TEST(test_parseWsUrl_rejects_garbage_port);
  RUN_TEST(test_parseWsUrl_rejects_empty_host);
  return UNITY_END();
}
