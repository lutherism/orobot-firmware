import type { WebSocket as WsWebSocket } from 'ws';
import type { EventBus } from '../core/event-bus';
import type { DeviceStateService } from '../core/device-state';
import type { MessageHandlerRegistry } from '../handlers/registry';
import type { InboundMessage } from '../core/types';
import { createLogger } from '../core/logger';

export type WsFactory = (url: string, protocol: string) => WsWebSocket;

const PROD_WS_URL  = 'wss://robots-gateway.uc.r.appspot.com/';
const MIN_BACKOFF  = 2_000;
const MAX_BACKOFF  = 30_000;
const WS_OPEN      = 1; // WebSocket.OPEN — socket is ready to send
const log = createLogger('gateway-client');

export class GatewayClient {
  private stopped            = false;
  private ws: WsWebSocket | null = null;
  private backoffMs          = MIN_BACKOFF;
  private sleepAbort: (() => void) | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly bus:         EventBus,
    private readonly state:       DeviceStateService,
    private readonly registry:    MessageHandlerRegistry,
    private readonly wsFactory:   WsFactory,
    private readonly urlOverride?: string,  // injected URL; overrides dev/prod resolution when set
  ) {}

  start(): void {
    this.unsubscribers.push(
      this.bus.on('network:send', ({ payload }) => {
        if (this.ws?.readyState === WS_OPEN) {
          this.ws.send(JSON.stringify(payload));
        }
      }),
      this.bus.on('pty:output', ({ data }) => {
        if (this.ws?.readyState === WS_OPEN) {
          this.ws.send(JSON.stringify({
            type:       'pty-out',
            data,
            deviceUuid: this.state.get().deviceUuid,
          }));
        }
      }),
      this.bus.on('network:mode-changed', () => {
        this.ws?.close();
      }),
    );
    void this.connectLoop();
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers.length = 0;
    this.sleepAbort?.();
    this.ws?.close();
  }

  private getUrl(): string {
    if (this.urlOverride) return this.urlOverride;
    const s = this.state.get();
    if (s.networkMode === 'dev' && s.devIP) return `ws://${s.devIP}:8080`;
    return PROD_WS_URL;
  }

  private async connectLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.openConnection();
        this.backoffMs = MIN_BACKOFF; // reset on clean close
      } catch {
        await this.sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF);
      }
    }
  }

  private openConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = this.getUrl();
      const ws  = this.wsFactory(url, 'ssh-protocol');
      this.ws   = ws;

      ws.on('open', () => {
        log.info({ event: 'ws:connected', url }, 'Gateway connection established');
        const { deviceUuid } = this.state.get();
        ws.send(JSON.stringify({ type: 'identify-connection', deviceUuid }));
        ws.send(JSON.stringify({ type: 'connect-to-user',     deviceUuid }));
        this.bus.emit('network:connected', { url });
      });

      ws.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString()) as InboundMessage;
          void this.registry.dispatch(msg);
        } catch { /* ignore malformed messages */ }
      });

      ws.on('close', () => {
        log.info({ event: 'ws:closed' }, 'Gateway connection closed');
        this.ws = null;
        this.bus.emit('network:disconnected', { reason: 'closed' });
        resolve();
      });

      ws.on('error', (err: Error) => {
        log.warn({ event: 'ws:error', err }, 'Gateway connection error');
        this.ws = null;
        this.bus.emit('network:disconnected', { reason: err.message });
        reject(err);
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer       = setTimeout(resolve, ms);
      this.sleepAbort   = () => { clearTimeout(timer); resolve(); };
    });
  }
}
