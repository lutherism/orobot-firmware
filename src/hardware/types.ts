/**
 * Represents a single exported GPIO pin.
 * Production: wraps the `gpio` npm package callback API.
 * Tests/sim: MockPin stores values in memory.
 */
export interface Pin {
  set(value: 0 | 1): Promise<void>;
  unexport(): Promise<void>;
}

/**
 * Abstraction over the GPIO hardware layer.
 * Inject RPiGPIODriver on a real device; inject MockGPIODriver in tests.
 */
export interface GPIODriver {
  export(pin: number, direction: 'in' | 'out'): Promise<Pin>;
}
