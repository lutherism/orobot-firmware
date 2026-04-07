import type { DeviceSandboxService } from '../core/device-sandbox';
import type { StepperMotor } from '../hardware/stepper-motor';
import type { DeviceStateService } from '../core/device-state';
import type { MessageHandler } from './registry';
import { createLogger } from '../core/logger';

const log = createLogger('handler-load-code');

export function createLoadCodeHandler(
  deviceSandbox: DeviceSandboxService,
  motor: StepperMotor,
  state: DeviceStateService,
): MessageHandler {
  return async (msg) => {
    let payload: { code: string; unitId: string };
    try {
      payload = JSON.parse(msg.data) as { code: string; unitId: string };
    } catch {
      log.warn({ data: msg.data }, 'load-code: failed to parse data, ignoring');
      return;
    }

    const { code, unitId } = payload;
    deviceSandbox.load(code, motor, state);
    log.info({ unitId }, 'load-code applied');
  };
}
