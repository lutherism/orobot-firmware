import vm from 'vm';
import { createLogger } from './logger';
import type { StepperMotor } from '../hardware/stepper-motor';
import type { DeviceStateService } from './device-state';

const log = createLogger('device-sandbox');

type MessageHandler = (type: string, data: unknown) => void;

export class DeviceSandboxService {
  private handler: MessageHandler | null = null;

  /**
   * Loads and runs device JS code in an isolated vm context.
   * The code may call `onMessage(fn)` to register a catch-all message handler.
   * Clears any previously registered handler first.
   */
  load(code: string, motor: StepperMotor, state: DeviceStateService): void {
    this.handler = null;

    const context = vm.createContext({
      motor,
      state,
      log: (...args: unknown[]) => console.log('[device-sandbox]', ...args),
      onMessage: (fn: MessageHandler) => { this.handler = fn; },
    });

    try {
      vm.runInContext(code, context);
    } catch (err) {
      log.error({ err }, 'device-sandbox: error running device code');
    }
  }

  /**
   * Dispatches a message to the registered handler.
   * Returns true if a handler was registered (regardless of whether it acted),
   * false if no handler is registered.
   */
  dispatch(type: string, data: unknown): boolean {
    if (!this.handler) return false;
    try {
      this.handler(type, data);
    } catch (err) {
      log.error({ err, type }, 'device-sandbox: message handler threw');
    }
    return true;
  }
}
