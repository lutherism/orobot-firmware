import type { GPIODriver, Pin } from './types';

/** Recorded PWM write call for test assertions. */
export interface PwmCall {
  pin: number;
  /** Clamped + rounded duty cycle value written (0–255). */
  value: number;
}

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

/** Clamp and round a PWM duty-cycle value to the [0, 255] range. */
function clampPwmValue(value: number): number {
  return Math.round(Math.max(0, Math.min(255, value)));
}

export class MockGPIODriver implements GPIODriver {
  /** Inspectable map of pin number → MockPin for digital-write assertions. */
  readonly pins = new Map<number, MockPin>();

  /**
   * Ordered log of every pwmWrite() call made on this driver.
   * Each entry records the pin and the clamped duty-cycle value that was
   * applied, so tests can assert both the call sequence and the clamping.
   */
  readonly pwmCalls: PwmCall[] = [];

  export(pin: number, _direction: 'in' | 'out'): Promise<Pin> {
    const mockPin = new MockPin();
    this.pins.set(pin, mockPin);
    return Promise.resolve(mockPin);
  }

  pwmWrite(pin: number, value: number): Promise<void> {
    this.pwmCalls.push({ pin, value: clampPwmValue(value) });
    return Promise.resolve();
  }
}
