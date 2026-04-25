#if defined(ARDUINO)

#include "ws_client.h"

#include <ArduinoJson.h>

namespace orobot {

namespace {

WsClient* g_self = nullptr;

// Parse `ws://host:port/path` or `wss://host:port/path` into the form the
// library wants (host, port, path, ssl). Kept tiny — gateway URL is set at
// compile time, no need for a general-purpose parser.
struct ParsedUrl {
  String host;
  uint16_t port = 0;
  String path;
  bool ssl = false;
  bool ok = false;
};

ParsedUrl parseUrl(const char* url) {
  ParsedUrl p;
  String s(url);
  int i = 0;
  if (s.startsWith("wss://")) {
    p.ssl = true;
    i = 6;
  } else if (s.startsWith("ws://")) {
    p.ssl = false;
    i = 5;
  } else {
    return p;
  }
  const int slash = s.indexOf('/', i);
  const String authority = (slash < 0) ? s.substring(i) : s.substring(i, slash);
  p.path = (slash < 0) ? String("/") : s.substring(slash);
  const int colon = authority.indexOf(':');
  if (colon < 0) {
    p.host = authority;
    p.port = p.ssl ? 443 : 80;
  } else {
    p.host = authority.substring(0, colon);
    p.port = static_cast<uint16_t>(authority.substring(colon + 1).toInt());
  }
  p.ok = p.host.length() > 0 && p.port > 0;
  return p;
}

String typedFrame(const char* type, const String& deviceUuid) {
  // Connection-setup frame per device-protocol.md §3:
  //   { "type": "...", "deviceUuid": "..." }
  JsonDocument doc;
  doc["type"] = type;
  doc["deviceUuid"] = deviceUuid;
  String out;
  serializeJson(doc, out);
  return out;
}

}  // namespace

void WsClient::begin(const DeviceIdentity& id, Protocol* protocol) {
  id_ = id;
  protocol_ = protocol;
  g_self = this;

  const ParsedUrl u = parseUrl(OROBOT_GATEWAY_URL);
  if (!u.ok) {
    Serial.print("ws-bad-url ");
    Serial.println(OROBOT_GATEWAY_URL);
    return;
  }

  Serial.print("ws-connecting ");
  Serial.print(u.ssl ? "wss://" : "ws://");
  Serial.print(u.host);
  Serial.print(':');
  Serial.print(u.port);
  Serial.println(u.path);

  if (u.ssl) {
    socket_.beginSSL(u.host.c_str(), u.port, u.path.c_str());
  } else {
    socket_.begin(u.host.c_str(), u.port, u.path.c_str());
  }
  socket_.onEvent([](WStype_t type, uint8_t* payload, size_t length) {
    if (g_self) g_self->onEvent(type, payload, length);
  });
  // Library-managed reconnect: 1s → 30s cap is the defined behavior in
  // arduinoWebSockets when only an interval is provided. We pass the cap; the
  // library applies its own exponential backoff up to that.
  socket_.setReconnectInterval(30000);
  // App-level keepalive aligned to the Pi firmware: 25s ping, 10s pong
  // timeout, 2 missed pongs → drop. See MEMORY.md §3 for the canonical values.
  socket_.enableHeartbeat(25000, 10000, 2);
}

void WsClient::tick() { socket_.loop(); }

void WsClient::onEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("ws-connected");
      sendHandshake();
      break;
    case WStype_DISCONNECTED:
      ready_ = false;
      Serial.println("ws-disconnected");
      break;
    case WStype_TEXT: {
      String raw;
      raw.reserve(length);
      for (size_t i = 0; i < length; ++i) raw += static_cast<char>(payload[i]);
      handleMessage(raw);
      break;
    }
    case WStype_PING:
    case WStype_PONG:
      // Library handles these; no app action.
      break;
    case WStype_ERROR:
      Serial.println("ws-error");
      break;
    default:
      break;
  }
}

void WsClient::sendHandshake() {
  // Order matters per device-protocol.md §3: identify-connection first
  // (informational) then connect-to-user (subscribes to inbound topic).
  String idFrame = typedFrame("identify-connection", id_.uuid);
  socket_.sendTXT(idFrame);
  String connectFrame = typedFrame("connect-to-user", id_.uuid);
  socket_.sendTXT(connectFrame);
  ready_ = true;
  Serial.print("ws-authed deviceUuid=");
  Serial.println(id_.uuid);
}

void WsClient::handleMessage(const String& raw) {
  if (!protocol_) return;

  // Inbound frames may carry an `ackId` per §2; if so we must echo it back as
  // `message-ack` or PubSub will redeliver. Parse once here for the ack, then
  // hand the raw string to Protocol for the actual command dispatch.
  JsonDocument doc;
  const auto err = deserializeJson(doc, raw);
  if (!err) {
    const char* ackId = doc["ackId"] | "";
    if (ackId && ackId[0] != '\0') {
      JsonDocument ack;
      ack["type"] = "message-ack";
      ack["deviceUuid"] = id_.uuid;
      ack["ackId"] = ackId;
      String out;
      serializeJson(ack, out);
      socket_.sendTXT(out);
    }
  }

  String response = protocol_->handle(raw);
  if (response.length() > 0) {
    socket_.sendTXT(response);
  }
}

}  // namespace orobot

#endif  // ARDUINO
