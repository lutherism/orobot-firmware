import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import type { NetworkStateMachine } from '../network/state-machine';
import { makeEnvelope } from '../core/wire';
import type { MessageHandler } from './registry';

export function createGetDeviceDataHandler(
  state: DeviceStateService,
  bus: EventBus,
): MessageHandler {
  return async (msg) => {
    const data = state.get();
    bus.emit('network:send', {
      payload: makeEnvelope('device-data-read', {
        deviceUuid: data.deviceUuid,
        userUuid:   data.ownerUuid ?? undefined,
        data,
      }),
    });
  };
}

export function createRebootHandler(bus: EventBus): MessageHandler {
  return async (_msg) => {
    bus.emit('system:reboot-requested', {});
  };
}

export function createUpdateHandler(bus: EventBus): MessageHandler {
  return async (_msg) => {
    bus.emit('system:update-requested', {});
  };
}

export function createNetworkModeHandler(sm: NetworkStateMachine): MessageHandler {
  return async (msg) => {
    const raw = msg.data; // e.g. 'client', 'ap', 'dev:192.168.1.1'
    if (raw.startsWith('dev:')) {
      const devIP = raw.slice(4);
      await sm.transition('dev', { devIP });
    } else {
      await sm.transition(raw as import('../core/types').NetworkMode);
    }
  };
}
