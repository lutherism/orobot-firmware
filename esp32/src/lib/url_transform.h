// Pure URL helpers — no Arduino dependency, testable on host.
//
// `claim_redeem` and `ws_client` both need to derive HTTP/host/port from the
// compile-time `OROBOT_GATEWAY_URL`. Keeping the parse/transform logic here
// (std::string, no `String`) lets `pio test -e native` cover them without
// pulling in WiFi / HTTPClient.

#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace orobot {

// Convert a `ws://host[:port][/path]` or `wss://...` gateway URL to its HTTP
// twin and append `apiPath` (which must start with '/'). Returns "" on a
// malformed input.
//
// Examples:
//   ws://h:8080/device,  /api/x  -> http://h:8080/api/x
//   wss://h/device,      /api/x  -> https://h/api/x
//   wss://h:443/device,  /api/x  -> https://h:443/api/x
inline std::string toHttpApiUrl(std::string_view gatewayUrl,
                                std::string_view apiPath) {
  std::string scheme;
  std::size_t cursor = 0;
  if (gatewayUrl.rfind("wss://", 0) == 0) {
    scheme = "https://";
    cursor = 6;
  } else if (gatewayUrl.rfind("ws://", 0) == 0) {
    scheme = "http://";
    cursor = 5;
  } else {
    return {};
  }
  // authority = host[:port], everything up to the first '/' after the scheme
  const auto slash = gatewayUrl.find('/', cursor);
  const auto authority = (slash == std::string_view::npos)
                             ? gatewayUrl.substr(cursor)
                             : gatewayUrl.substr(cursor, slash - cursor);
  if (authority.empty()) return {};
  std::string out;
  out.reserve(scheme.size() + authority.size() + apiPath.size());
  out.append(scheme).append(authority).append(apiPath);
  return out;
}

struct WsUrl {
  std::string host;
  std::uint16_t port = 0;
  std::string path;
  bool ssl = false;
  bool ok = false;
};

// Parse `ws[s]://host[:port][/path]`. Default ports follow scheme: 80 / 443.
// Empty path becomes "/". Returns `ok=false` on malformed input.
inline WsUrl parseWsUrl(std::string_view url) {
  WsUrl u;
  std::size_t cursor = 0;
  if (url.rfind("wss://", 0) == 0) {
    u.ssl = true;
    cursor = 6;
  } else if (url.rfind("ws://", 0) == 0) {
    u.ssl = false;
    cursor = 5;
  } else {
    return u;
  }
  const auto slash = url.find('/', cursor);
  const auto authority = (slash == std::string_view::npos)
                             ? url.substr(cursor)
                             : url.substr(cursor, slash - cursor);
  u.path = (slash == std::string_view::npos)
               ? std::string("/")
               : std::string(url.substr(slash));
  const auto colon = authority.find(':');
  if (colon == std::string_view::npos) {
    u.host = std::string(authority);
    u.port = u.ssl ? 443 : 80;
  } else {
    u.host = std::string(authority.substr(0, colon));
    const auto portStr = std::string(authority.substr(colon + 1));
    try {
      const long n = std::stol(portStr);
      if (n > 0 && n <= 0xFFFF) u.port = static_cast<std::uint16_t>(n);
    } catch (...) {  // NOLINT(bugprone-empty-catch)
      // Fall through: u.port stays 0 → ok = false
    }
  }
  u.ok = !u.host.empty() && u.port > 0;
  return u;
}

}  // namespace orobot
