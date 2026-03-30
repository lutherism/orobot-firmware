// Production GPIO driver. Only runs on Raspberry Pi or Banana Pi.
// In development and tests, use MockGPIODriver instead.
import gpio from 'gpio';
import type { GPIODriver, Pin } from './types';

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
}
