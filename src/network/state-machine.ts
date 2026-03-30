import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import type { NetworkMode } from '../core/types';
import { createLogger } from '../core/logger';

const VALID_TRANSITIONS: Record<NetworkMode, NetworkMode[]> = {
  // sim is boot-time only (set via NODE_ENV or data.json); not a runtime transition
  client: ['ap', 'dev'],
  ap:     ['client'],
  dev:    ['client', 'ap'],
  sim:    [],
};

const log = createLogger('network-state-machine');

export class NetworkStateMachine {
  private _current: NetworkMode;

  constructor(
    private readonly state: DeviceStateService,
    private readonly bus: EventBus,
  ) {
    this._current = state.get().networkMode;
  }

  get current(): NetworkMode {
    return this._current;
  }

  async transition(to: NetworkMode, options?: { devIP?: string }): Promise<void> {
    const allowed = VALID_TRANSITIONS[this._current];
    if (!allowed.includes(to)) {
      throw new Error(`Invalid transition: ${this._current} → ${to}`);
    }
    const from = this._current;
    const patch: Parameters<DeviceStateService['patch']>[0] = { networkMode: to };
    if (options?.devIP !== undefined) patch.devIP = options.devIP;
    await this.state.patch(patch);
    this._current = to;
    log.info({ event: 'network:transition', from, to }, 'Network mode changed');
    this.bus.emit('network:mode-changed', { from, to });
  }
}
