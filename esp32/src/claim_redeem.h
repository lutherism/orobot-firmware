// One-shot pairing call — redeems the captive-portal-supplied 6-digit code
// against `/api/device/claim-code/redeem` so the gateway provisions the
// device row + PubSub topic/sub before the WS handshake.
//
// Returns true on HTTP 200; the caller is expected to clear the pair code
// from NVS only on success. Failures are logged to Serial — the WS connect
// will fail later anyway, surfacing the issue end-to-end.

#pragma once

#if defined(ARDUINO)

#include <Arduino.h>

namespace orobot {

bool redeemPairCode(const String& deviceUuid, const String& code);

}  // namespace orobot

#endif  // ARDUINO
