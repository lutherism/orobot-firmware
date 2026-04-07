import type { EventBus } from '../core/event-bus';
import type { MessageHandler } from './registry';

// Camera snapshot requires HTTP POST to gateway — implemented in Phase 3.
export function createCameraHandler(_bus: EventBus): MessageHandler {
  return async (_msg) => {};
}
