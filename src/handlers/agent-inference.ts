/**
 * Agent inference WS message handler.
 *
 * Handles the `agent-inference-request` message type:
 *   - Decodes the base64 JPEG payload from `msg.data`
 *   - Calls `agent.analyze(imageBuffer)` asynchronously (non-blocking)
 *   - Emits `agent-inference-result` back over the bus
 *
 * Wire contract (per MEMORY.md WebSocket discipline):
 *   Inbound  `agent-inference-request`: { type, data: "<base64 JPEG>", userUuid, deviceUuid, ackId }
 *   Outbound `agent-inference-result`:  { type, data: JSON<InferenceResult>, deviceUuid }
 *
 * `data` is always a string on the wire — outbound JSON is serialized by
 * `makeEnvelope` per the OutboundEnvelope contract in core/wire.ts.
 *
 * The handler itself must not block the event loop; the Promise chain from
 * `agent.analyze()` is detached via `setImmediate` so the registry can ack
 * the message immediately.
 */

import type { EventBus } from '../core/event-bus';
import type { MessageHandler } from './registry';
import type { Agent } from '../agent';
import { makeEnvelope } from '../core/wire';
import { createLogger } from '../core/logger';

const log = createLogger('agent-inference');

/**
 * Creates the `agent-inference-request` message handler.
 *
 * @param bus   EventBus — used to emit `network:send` with the result envelope.
 * @param agent Agent instance with a loaded model; if null, emits an error result.
 */
export function createAgentInferenceHandler(
  bus:   EventBus,
  agent: Agent | null,
): MessageHandler {
  return (msg) => {
    const { data: base64Image, deviceUuid } = msg;

    // Run inference asynchronously — do not block the WS event loop.
    setImmediate(() => {
      void (async () => {
        if (!agent) {
          log.warn({ deviceUuid }, 'agent-inference-request received but no agent loaded');
          bus.emit('network:send', {
            payload: makeEnvelope('agent-inference-result', {
              deviceUuid,
              data: { error: 'No inference agent loaded on this device.' },
            }),
          });
          return;
        }

        // Note: Buffer.from(str, 'base64') never throws in Node.js — it silently
        // ignores invalid or non-base64 characters and returns a truncated/garbage
        // Buffer. This try/catch is defensive for future compatibility (e.g. a
        // strict atob shim or WASM decoder) but cannot be triggered by the current
        // Node.js runtime. See agent-inference.test.ts for the pinned behavior.
        let imageBuffer: Buffer;
        try {
          imageBuffer = Buffer.from(base64Image, 'base64');
        } catch (err) {
          log.warn({ err, deviceUuid }, 'Failed to decode base64 image');
          bus.emit('network:send', {
            payload: makeEnvelope('agent-inference-result', {
              deviceUuid,
              data: { error: `Failed to decode image: ${err instanceof Error ? err.message : String(err)}` },
            }),
          });
          return;
        }

        try {
          const result = await agent.analyze(imageBuffer);
          bus.emit('network:send', {
            payload: makeEnvelope('agent-inference-result', {
              deviceUuid,
              data: result,
            }),
          });
        } catch (err) {
          log.warn({ err, deviceUuid }, 'agent.analyze() failed');
          bus.emit('network:send', {
            payload: makeEnvelope('agent-inference-result', {
              deviceUuid,
              data: { error: err instanceof Error ? err.message : String(err) },
            }),
          });
        }
      })();
    });

    // Return a resolved promise — the registry dispatches synchronously,
    // and the actual inference runs via setImmediate above.
    return Promise.resolve();
  };
}
