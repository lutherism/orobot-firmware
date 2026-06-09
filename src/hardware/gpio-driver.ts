// Production GPIO driver. Only runs on Raspberry Pi or Banana Pi.
// In development and tests, use MockGPIODriver instead.
import gpio from 'gpio';
import type { GPIODriver, Pin } from './types';

// pigpio is lazy-required (same pattern as node-pty in main.ts) so that
// importing this module in non-Pi environments doesn't fail at load time.
// It is only resolved when pwmWrite() is actually called on real hardware.
type Pigpio = { pwmWrite(pin: number, value: number): void };
let _pigpio: Pigpio | undefined;
function getPigpio(): Pigpio {
  if (!_pigpio) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _pigpio = require('pigpio').Gpio
      ? (() => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { pigpio } = require('pigpio') as { pigpio: Pigpio };
          return pigpio;
        })()
      // Fallback: the top-level `pigpio` export itself provides pwmWrite
      // on some package versions.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      : (require('pigpio') as Pigpio);
  }
  return _pigpio!;
}

/** Clamp and round a PWM duty-cycle value to the [0, 255] range. */
function clampPwmValue(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}

class RPiPin implements Pin {
  constructor(private readonly handle: ReturnType<typeof gpio.export>) {}

  set(value: 0 | 1): Promise<void> {
    return new Promise((resolve) => {
      this.handle.set(value, resolve);
    });
  }

  unexport(): Promise<void> {
    return new Promise((resolve) => {
      this.handle.unexport(resolve);
    });
  }
}

export class RPiGPIODriver implements GPIODriver {
  export(pin: number, direction: 'in' | 'out'): Promise<Pin> {
    return new Promise((resolve) => {
      // gpio.export() returns the handle synchronously before `ready` fires.
      // The closure captures it so `ready` can wrap it in RPiPin.
      const handle = gpio.export(pin, {
        direction,
        interval: 100,
        ready: () => resolve(new RPiPin(handle)),
      });
    });
  }

  pwmWrite(pin: number, value: number): Promise<void> {
    const duty = clampPwmValue(value);
    getPigpio().pwmWrite(pin, duty);
    return Promise.resolve();
  }
}
