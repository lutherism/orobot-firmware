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
 *
 * Digital writes: export a pin then call pin.set(0|1).
 * Hardware PWM:   call driver.pwmWrite(pin, 0–255) directly — no export needed.
 *                 Values are clamped to [0, 255] and rounded to integers.
 */
export interface GPIODriver {
  export(pin: number, direction: 'in' | 'out'): Promise<Pin>;
  /**
   * Write a hardware PWM duty cycle to a pin.
   *
   * @param pin   BCM GPIO pin number.
   * @param value Duty cycle: 0 (always-off) to 255 (always-on). Clamped &
   *              rounded to the nearest integer before writing.
   */
  pwmWrite(pin: number, value: number): Promise<void>;
}
