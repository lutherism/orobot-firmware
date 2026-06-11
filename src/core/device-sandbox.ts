import vm from 'vm';
import { createLogger } from './logger';
import type { StepperMotor } from '../hardware/stepper-motor';
import type { DeviceStateService } from './device-state';
import type { EventBus } from './event-bus';
import { makeEnvelope } from './wire';
import { OverlayPublisher } from '../handlers/overlay-frame';

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
   *
   * The `orobot` API object is injected into the context and exposes:
   *   - `orobot.publishOverlay(overlayId, imageBuffer)` — emit an overlay-frame WS message
   */
  load(code: string, motor: StepperMotor, state: DeviceStateService, bus?: EventBus): void {
    this.handler = null;

    // Build the orobot API surface available to script.js
    const overlayPublisher = bus ? new OverlayPublisher(bus, state.get().deviceUuid) : null;
    const orobot = {
      /**
       * Publish a secondary camera overlay (segmentation mask, depth map, etc.)
       * over the WS overlay-frame channel.
       *
       * @param overlayId  String key (e.g. 'depth', 'seg-mask'). Max 64 chars.
       * @param imageBuffer  Raw PNG bytes as a Buffer. When omitted in sim mode
       *                     a synthetic checkerboard PNG is generated automatically.
       */
      publishOverlay: (overlayId: string, imageBuffer?: Buffer | null): void => {
        if (!overlayPublisher) return;
        void overlayPublisher.publishOverlay(overlayId, imageBuffer);
      },
    };

    const context = vm.createContext({
      motor,
      motors: [motor],
      state,
      orobot,
      log: (...args: unknown[]) => {
        const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        console.log('[device-sandbox]', text);
        if (bus) {
          bus.emit('network:send', {
            payload: makeEnvelope('device-log', {
              level:      'log',
              text,
              deviceUuid: state.get().deviceUuid,
            }),
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
