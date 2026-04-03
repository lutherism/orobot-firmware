import type { EventBus } from '../core/event-bus';
import type { InboundMessage } from '../core/types';
import { createLogger } from '../core/logger';

export type MessageHandler = (msg: InboundMessage) => Promise<void>;

type HandlerEntry =
  | { kind: 'exact';  handler: MessageHandler }
  | { kind: 'prefix'; handler: MessageHandler };

export class MessageHandlerRegistry {
  private readonly handlers = new Map<string, HandlerEntry>();
  private readonly log: ReturnType<typeof createLogger>;

  constructor(
    private readonly bus: EventBus,
    private readonly getDeviceUuid: () => string,
    device?: string,
  ) {
    this.log = createLogger('handler-registry', device);
  }

  register(type: string, handler: MessageHandler): void;
  register(type: string, isPrefix: true, handler: MessageHandler): void;
  register(
    type: string,
    handlerOrPrefix: MessageHandler | true,
    maybeHandler?: MessageHandler,
  ): void {
    if (typeof handlerOrPrefix === 'function') {
      this.handlers.set(type, { kind: 'exact', handler: handlerOrPrefix });
    } else {
      this.handlers.set(type, { kind: 'prefix', handler: maybeHandler! });
    }
  }

  async dispatch(msg: InboundMessage): Promise<void> {
    try {
      const handler = this.findHandler(msg);
      if (handler) {
        await handler(msg);
      }
    } catch (error) {
      // Silently catch handler errors and continue to send ack
    } finally {
      this.bus.emit('network:send', {
        payload: {
          type: 'message-ack',
          ackId: msg.ackId,
          deviceUuid: this.getDeviceUuid(),
        },
      });
    }
  }

  private findHandler(msg: InboundMessage): MessageHandler | undefined {
    // 1. Exact type match
    const byType = this.handlers.get(msg.type);
    if (byType?.kind === 'exact') return byType.handler;

    // 2. Exact data match (for command-in subtypes: reboot, update, wifiList, etc.)
    if (msg.data) {
      const byData = this.handlers.get(msg.data);
      if (byData?.kind === 'exact') return byData.handler;
    }

    // 3. Prefix data match (for gotoangle:90, varyspeed:3, etc.)
    for (const [key, entry] of this.handlers) {
      if (entry.kind === 'prefix' && msg.data?.startsWith(key)) {
        this.log.info({data: msg.data}, 'registry findHandler');
        return entry.handler;
      }
    }

    return undefined;
  }
}
