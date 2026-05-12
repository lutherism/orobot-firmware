import type { WebSocket as WsWebSocket } from 'ws';
import type { EventBus } from '../core/event-bus';
import type { DeviceStateService } from '../core/device-state';
import type { MessageHandlerRegistry } from '../handlers/registry';
import type { InboundMessage } from '../core/types';
import { createLogger } from '../core/logger';

export type WsFactory  = (url: string, protocol: string) => WsWebSocket;
export type SleepFn    = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROD_WS_URL          = 'wss://robots-gateway-v2.wl.r.appspot.com/';
const MIN_BACKOFF          = 2_000;
const MAX_BACKOFF          = 30_000;
const WS_OPEN              = 1;      // WebSocket.OPEN — socket is ready to send
const DEFAULT_PING_MS      = 25_000; // safely under load-balancer idle timeout (~60 s)
const DEFAULT_PONG_TIMEOUT = 10_000; // force-close if no pong received within this window
export class GatewayClient {
  private stopped            = false;
  private ws: WsWebSocket | null = null;
  private backoffMs          = MIN_BACKOFF;
  private sleepAbort: (() => void) | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly log: ReturnType<typeof createLogger>;

constructor(
    private readonly bus:         EventBus,
    private readonly state:       DeviceStateService,
    private readonly registry:    MessageHandlerRegistry,
    private readonly wsFactory:       WsFactory,
    private readonly urlOverride?:    string,  // injected URL; overrides dev/prod resolution when set
    device?: string,
    private readonly pingIntervalMs = DEFAULT_PING_MS,
    private readonly pongTimeoutMs  = DEFAULT_PONG_TIMEOUT,
    private readonly sleepFn: SleepFn = defaultSleep,
    /** Platform identifier sent in the handshake (pi, jetson, simulator). */
    public readonly platform: string = 'pi',
  ) {
    this.log = createLogger('gateway-client', device);
  }

  start(): void {
    this.stopped = false;  // allow restart after stop()
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

      let disconnectEmitted = false;
      const emitDisconnect = (reason: string) => {
        if (!disconnectEmitted) {
          disconnectEmitted = true;
          this.bus.emit('network:disconnected', { reason });
        }
      };

      // --- keepalive ping/pong -------------------------------------------
      // App Engine's load balancer silently kills idle TCP connections after
      // ~60 s.  Sending periodic ping frames keeps the connection alive and
      // lets us detect dead sockets via pong timeout rather than waiting for
      // OS-level TCP keepalive (which defaults to ~2 hours).
      let pingTimer: ReturnType<typeof setInterval> | null = null;
      let pongTimer: ReturnType<typeof setTimeout>  | null = null;
      const clearPingTimers = () => {
        if (pingTimer !== null) { clearInterval(pingTimer); pingTimer = null; }
        if (pongTimer !== null) { clearTimeout(pongTimer);  pongTimer = null; }
      };
      // -----------------------------------------------------------------------

      ws.on('open', () => {
        this.log.info({ event: 'ws:connected', url }, 'Gateway connection established');
        const { deviceUuid } = this.state.get();
        ws.send(JSON.stringify({ type: 'identify-connection', deviceUuid, platform: this.platform }));
        ws.send(JSON.stringify({ type: 'connect-to-user',     deviceUuid }));
        this.bus.emit('network:connected', { url });

        pingTimer = setInterval(() => {
          if (ws.readyState !== WS_OPEN) return;
          ws.ping();
          pongTimer = setTimeout(() => {
            this.log.warn({ event: 'ws:pong-timeout' }, 'No pong received — terminating dead socket');
            ws.terminate();
          }, this.pongTimeoutMs);
        }, this.pingIntervalMs);
      });

      ws.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString()) as InboundMessage;
          this.log.info({ type: msg.type }, 'Websocket Message Recieved');
          void this.registry.dispatch(msg);
        } catch { /* ignore malformed messages */ }
      });

      ws.on('pong', () => {
        if (pongTimer !== null) { clearTimeout(pongTimer); pongTimer = null; }
      });

      ws.on('close', () => {
        clearPingTimers();
        this.log.info({ event: 'ws:closed' }, 'Gateway connection closed');
        this.ws = null;
        emitDisconnect('closed');
        resolve();
      });

      ws.on('error', (err: Error) => {
        clearPingTimers();
        this.log.warn({ event: 'ws:error', err }, 'Gateway connection error');
        this.ws = null;
        emitDisconnect(err.message);
        reject(err);
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.sleepAbort = resolve;             // stop() can call this to abort early
      void this.sleepFn(ms).then(resolve);   // injected delay; defaults to setTimeout
    });
  }
}
