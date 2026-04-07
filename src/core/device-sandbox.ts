import vm from 'vm';
import { createLogger } from './logger';
import type { StepperMotor } from '../hardware/stepper-motor';
import type { DeviceStateService } from './device-state';
import type { EventBus } from './event-bus';

const log = createLogger('device-sandbox');

type MessageHandler = (type: string, data: unknown) => void;

export class DeviceSandboxService {
  private handler: MessageHandler | null = null;

  /**
   * Loads and runs device JS code in an isolated vm context.
   * The code may call `onMessage(fn)` to register a catch-all message handler.
   * Clears any previously registered handler first.
   *
   * When `bus` is provided, `log()` calls in device code emit `device-log`
   * network messages so the IDE console can display them in real time.
   */
  load(code: string, motor: StepperMotor, state: DeviceStateService, bus?: EventBus): void {
    this.handler = null;

    const context = vm.createContext({
      motor,
      motors: [motor],
      state,
      log: (...args: unknown[]) => {
        const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        console.log('[device-sandbox]', text);
        if (bus) {
          bus.emit('network:send', {
            payload: {
              type:       'device-log',
              level:      'log',
              text,
              deviceUuid: state.get().deviceUuid,
            },
          });
        }
      },
      // Wrap user's handler so it receives {msg, motor, data} instead of (type, data)
      onMessage: (fn: (args: { msg: string; motor: StepperMotor; data: unknown }) => void) => {
        this.handler = (type: string, data: unknown) => fn({ msg: type, motor, data });
      },
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
