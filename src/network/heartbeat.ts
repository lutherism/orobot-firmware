import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import { createLogger } from '../core/logger';

const PROD_API_URL     = 'https://robots-gateway.uc.r.appspot.com/api';
const DEFAULT_INTERVAL = 8_000;
const log = createLogger('heartbeat');

export class HeartbeatService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly state:    DeviceStateService,
    private readonly bus:      EventBus,
    private readonly fetchFn:  typeof fetch = fetch,
  ) {}

  start(intervalMs = DEFAULT_INTERVAL): void {
    this.stop(); // clear any existing timer before starting a new one
    void this.beat();
    this.timer = setInterval(() => void this.beat(), intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async beat(): Promise<void> {
    const s      = this.state.get();
    const apiUrl = s.networkMode === 'dev' && s.devIP
      ? `http://${s.devIP}:8080/api`
      : PROD_API_URL;

    try {
      await this.fetchFn(`${apiUrl}/device/state`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          deviceUuid:  s.deviceUuid,
          payloadJSON: JSON.stringify({ type: s.type, pingTime: s.pingTime }),
        }),
      });
      log.info({ event: 'heartbeat', pingTime: s.pingTime }, 'Heartbeat sent');
      this.bus.emit('system:heartbeat-sent', { pingTime: s.pingTime });
    } catch (err) {
      log.warn({ event: 'heartbeat:fail', err: String(err) }, 'Heartbeat failed');
      // Swallow errors — network may be temporarily unavailable
    }
  }
}
