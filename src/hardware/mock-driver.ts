import type { GPIODriver, Pin } from './types';

export class MockPin implements Pin {
  value: 0 | 1 = 0;

  set(v: 0 | 1): Promise<void> {
    this.value = v;
    return Promise.resolve();
  }

  unexport(): Promise<void> {
    return Promise.resolve();
  }
}

export class MockGPIODriver implements GPIODriver {
  /** Inspectable map of pin number → MockPin for assertions in tests. */
  readonly pins = new Map<number, MockPin>();

  export(pin: number, _direction: 'in' | 'out'): Promise<Pin> {
    const mockPin = new MockPin();
    this.pins.set(pin, mockPin);
    return Promise.resolve(mockPin);
  }
}
