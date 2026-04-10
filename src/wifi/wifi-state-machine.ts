import type { EventBus } from '../core/event-bus';
import type { WifiState } from '../core/types';
import { createLogger } from '../core/logger';

const VALID_TRANSITIONS: Record<WifiState, WifiState[]> = {
  UNCONFIGURED: ['SETUP_MODE', 'CONNECTING'],
  SETUP_MODE:   ['PROVISIONING', 'CONNECTING'],
  PROVISIONING: ['CONNECTING'],
  CONNECTING:   ['CONNECTED', 'SETUP_MODE'],
  CONNECTED:    ['DEGRADED'],
  DEGRADED:     ['RECONNECTING'],
  RECONNECTING: ['CONNECTED', 'SETUP_MODE'],
};

export class WifiStateMachine {
  private _current: WifiState = 'UNCONFIGURED';
  private readonly log: ReturnType<typeof createLogger>;

  constructor(private readonly bus: EventBus, device?: string) {
    this.log = createLogger('wifi-state-machine', device);
  }

  get current(): WifiState {
    return this._current;
  }

  reset(): void {
    this._current = 'UNCONFIGURED';
  }

  transition(to: WifiState): void {
    const allowed = VALID_TRANSITIONS[this._current];
    if (!allowed.includes(to)) {
      throw new Error(`Invalid WiFi transition: ${this._current} → ${to}`);
    }
    const from     = this._current;
    this._current  = to;
    this.log.info({ event: 'wifi:transition', from, to }, 'WiFi state changed');
    this.bus.emit('wifi:state-changed', { from, to });
  }
}
