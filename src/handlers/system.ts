import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import type { MessageHandler } from './registry';

export function createGetDeviceDataHandler(
  state: DeviceStateService,
  bus: EventBus,
): MessageHandler {
  return async (msg) => {
    const data = state.get();
    bus.emit('network:send', {
      payload: {
        type: 'device-data-read',
        deviceUuid: data.deviceUuid,
        userUuid: data.ownerUuid,
        data,
      },
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

export function createNetworkModeHandler(
  state: DeviceStateService,
  bus: EventBus,
): MessageHandler {
  return async (msg) => {
    const from = state.get().networkMode;
    const raw  = msg.data; // e.g. 'client', 'ap', 'dev:192.168.1.1'

    let to: 'client' | 'ap' | 'dev' | 'sim';

    if (raw.startsWith('dev:')) {
      const ip = raw.slice(4); // slice 'dev:' prefix; handles IPv6 colons safely
      await state.patch({ networkMode: 'dev', devIP: ip });
      to = 'dev';
    } else {
      to = raw as 'client' | 'ap' | 'sim';
      await state.patch({ networkMode: to });
    }

    bus.emit('network:mode-changed', { from, to });
  };
}
