// orobot device WebSocket client.
//
// Owns the socket to `<gateway>/device`, runs the `identify-connection` +
// `connect-to-user` handshake (per `robots-gateway/docs/device-protocol.md`),
// keeps the connection alive with library-level pings (25s / 10s timeout),
// and reconnects with exponential backoff on disconnect.
//
// On inbound messages this class delegates to a `Protocol` instance for
// parsing and sends the response back over the same socket. The gateway
// envelope's `ackId`, when present, is echoed back via `message-ack`.
//
// Design notes:
// - URL is compile-time only (`OROBOT_GATEWAY_URL`). A config UI is a
//   follow-up; the device is a thin actuator and has no config surface today.
// - The library (`arduinoWebSockets`) handles the socket FSM, ping/pong, and
//   auto-reconnect. We add app-level state logging on top.
// - On `wss://` URLs the library uses `WiFiClientSecure` with an open trust
//   store; for the first iteration we expect `ws://` against a local gateway
//   (see #510 acceptance — wss + cert pinning are deferred).

#pragma once

#if defined(ARDUINO)

#include <Arduino.h>
#include <WebSocketsClient.h>

#include "nvs_store.h"
#include "protocol.h"

namespace orobot {

class WsClient {
 public:
  // Bind the client to the device identity and start connecting. Safe to
  // call once after WiFi has reached `WL_CONNECTED`.
  void begin(const DeviceIdentity& id, Protocol* protocol);

  // Pump the underlying library state machine. Call from `loop()`.
  void tick();

  // Non-blocking status — true once the handshake (`connect-to-user`) is sent
  // and the socket is up. Goes false on disconnect.
  bool ready() const { return ready_; }

 private:
  void onEvent(WStype_t type, uint8_t* payload, size_t length);
  void sendHandshake();
  void handleMessage(const String& raw);

  WebSocketsClient socket_;
  DeviceIdentity id_;
  Protocol* protocol_ = nullptr;
  bool ready_ = false;
};

}  // namespace orobot

#endif  // ARDUINO
