/**
 * Agent model management WS message handlers.
 *
 * Handles three message types from the browser control channel:
 *
 *   agent-list-models-request  → agent-list-models-result
 *   agent-download-model-request → agent-download-model-progress (N times)
 *                              → agent-download-model-done
 *   agent-delete-model-request → agent-delete-model-done
 *
 * Wire contract:
 *   Inbound  `agent-list-models-request`:    { type, data: "", deviceUuid }
 *   Outbound `agent-list-models-result`:     { type, data: JSON<ModelMeta[]>, deviceUuid }
 *
 *   Inbound  `agent-download-model-request`: { type, data: "<modelId>", deviceUuid }
 *   Outbound `agent-download-model-progress`:{ type, data: JSON<{downloaded,total}>, deviceUuid }
 *   Outbound `agent-download-model-done`:    { type, data: JSON<{modelId,filePath}>, deviceUuid }
 *   (on error, `agent-download-model-done` carries { error: string })
 *
 *   Inbound  `agent-delete-model-request`:   { type, data: "<modelId>", deviceUuid }
 *   Outbound `agent-delete-model-done`:      { type, data: JSON<{modelId}>, deviceUuid }
 *   (on error, `agent-delete-model-done` carries { error: string })
 */

import type { EventBus } from '../core/event-bus';
import type { MessageHandler } from './registry';
import { ModelManager } from '../agent/model-manager.js';
import { makeEnvelope } from '../core/wire';
import { createLogger } from '../core/logger';

const log = createLogger('agent-model');

export interface AgentModelHandlers {
  listModels: MessageHandler;
  downloadModel: MessageHandler;
  deleteModel: MessageHandler;
}

/**
 * Create the three agent-model WS handlers sharing one ModelManager.
 *
 * @param bus         EventBus to emit outbound `network:send` messages.
 * @param modelManager Injected ModelManager (default: shared singleton).
 */
export function createAgentModelHandlers(
  bus: EventBus,
  modelManager: ModelManager = new ModelManager(),
): AgentModelHandlers {
  // ── agent-list-models-request ────────────────────────────────────────────

  const listModels: MessageHandler = (msg) => {
    const { deviceUuid } = msg;

    return (async () => {
      try {
        const models = await modelManager.listLocalModels();
        bus.emit('network:send', {
          payload: makeEnvelope('agent-list-models-result', { deviceUuid, data: models }),
        });
      } catch (err) {
        log.warn({ err, deviceUuid }, 'agent-list-models failed');
        bus.emit('network:send', {
          payload: makeEnvelope('agent-list-models-result', {
            deviceUuid,
            data: { error: err instanceof Error ? err.message : String(err) },
          }),
        });
      }
    })();
  };

  // ── agent-download-model-request ─────────────────────────────────────────

  const downloadModel: MessageHandler = (msg) => {
    const { data: modelId, deviceUuid } = msg;

    if (!modelId) {
      bus.emit('network:send', {
        payload: makeEnvelope('agent-download-model-done', {
          deviceUuid,
          data: { error: 'modelId is required' },
        }),
      });
      return Promise.resolve();
    }

    return (async () => {
      try {
        await modelManager.downloadModel(modelId, (downloaded, total) => {
          bus.emit('network:send', {
            payload: makeEnvelope('agent-download-model-progress', {
              deviceUuid,
              data: { modelId, downloaded, total },
            }),
          });
        });

        const filePath = modelManager.cachedPath(modelId);
        bus.emit('network:send', {
          payload: makeEnvelope('agent-download-model-done', {
            deviceUuid,
            data: { modelId, filePath },
          }),
        });
      } catch (err) {
        log.warn({ err, deviceUuid, modelId }, 'agent-download-model failed');
        bus.emit('network:send', {
          payload: makeEnvelope('agent-download-model-done', {
            deviceUuid,
            data: { error: err instanceof Error ? err.message : String(err) },
          }),
        });
      }
    })();
  };

  // ── agent-delete-model-request ───────────────────────────────────────────

  const deleteModel: MessageHandler = (msg) => {
    const { data: modelId, deviceUuid } = msg;

    if (!modelId) {
      bus.emit('network:send', {
        payload: makeEnvelope('agent-delete-model-done', {
          deviceUuid,
          data: { error: 'modelId is required' },
        }),
      });
      return Promise.resolve();
    }

    return (async () => {
      try {
        await modelManager.deleteModel(modelId);
        bus.emit('network:send', {
          payload: makeEnvelope('agent-delete-model-done', {
            deviceUuid,
            data: { modelId },
          }),
        });
      } catch (err) {
        log.warn({ err, deviceUuid, modelId }, 'agent-delete-model failed');
        bus.emit('network:send', {
          payload: makeEnvelope('agent-delete-model-done', {
            deviceUuid,
            data: { error: err instanceof Error ? err.message : String(err) },
          }),
        });
      }
    })();
  };

  return { listModels, downloadModel, deleteModel };
}
