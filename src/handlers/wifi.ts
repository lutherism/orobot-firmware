import type { EventBus } from '../core/event-bus';
import type { MessageHandler } from './registry';

// WiFi scanning requires exec('iwlist wlan0 scan') — implemented in Phase 4.
// Registered now so MessageHandlerRegistry sends message-ack on receipt.
export function createWifiListHandler(_bus: EventBus): MessageHandler {
  return async (_msg) => {};
}

// WiFi credential sharing requires network switching — implemented in Phase 4.
export function createShareWifiHandler(_bus: EventBus): MessageHandler {
  return async (_msg) => {};
}
