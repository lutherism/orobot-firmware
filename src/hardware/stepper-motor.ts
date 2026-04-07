import type { GPIODriver, Pin } from './types';
import type { EventBus } from '../core/event-bus';

// Coil activation order for each direction.
// Matches the `orders` array in scripts/commands.js:
//   orders[0] = [0,1,3,2] used for left/CCW  (increases angle)
//   orders[1] = [2,3,1,0] used for right/CW  (decreases angle)
const COIL_ORDERS = {
  ccw: [0, 1, 3, 2] as const, // increases angle
  cw:  [2, 3, 1, 0] as const, // decreases angle
} as const;

type Direction = keyof typeof COIL_ORDERS;
export class StepperMotor {
  private coils: Pin[] = [];
  private _currentAngle = 0;
  private activeCoil = 0;
  private queue: Promise<void> = Promise.resolve();
  private _minAngle = -Infinity;
  private _maxAngle = Infinity;

  constructor(
    private readonly driver: GPIODriver,
    private readonly pinNumbers: number[],
    private readonly bus: EventBus,
  ) {}

  get currentAngle(): number {
    return this._currentAngle;
  }

  /** Must be called once before any other method. */
  async initialize(): Promise<void> {
    this.coils = await Promise.all(
      this.pinNumbers.map((pin) => this.driver.export(pin, 'out')),
    );
    await this._stop();
  }

  /**
   * Raw stepper primitive. Drives coils in sequence for `durationMs` at
   * `intervalMs` per step. Does NOT update `currentAngle`.
   */
  async step(direction: Direction, intervalMs: number, durationMs: number): Promise<void> {
    const result = this.queue.then(() => this._step(direction, intervalMs, durationMs));
    this.queue = result.catch(() => {}); // keep queue alive even if this operation fails
    return result;
  }

  /**
   * Moves to `degrees` via the shortest arc path.
   * Updates `currentAngle` and emits `hardware:motor-moved` when done.
   */
  async gotoAngle(degrees: number): Promise<void> {
    const result = this.queue.then(() => this._gotoAngle(degrees));
    this.queue = result.catch(() => {}); // keep queue alive even if this operation fails
    return result;
  }

  /** De-energizes all coils. Queued after any in-progress operation. */
  async stop(): Promise<void> {
    const result = this.queue.then(() => this._stop());
    this.queue = result.catch(() => {}); // keep queue alive even if this operation fails
    return result;
  }

  /** Apply motor angle constraints from program config. */
  setConstraints(minAngle: number, maxAngle: number): void {
    this._minAngle = minAngle;
    this._maxAngle = maxAngle;
  }

  private async _step(
    direction: Direction,
    intervalMs: number,
    durationMs: number,
  ): Promise<void> {
    if (durationMs <= 0) return;
    const order = COIL_ORDERS[direction];
    return new Promise<void>((resolve) => {
      const job = setInterval(() => {
        const coilIndex = order[this.activeCoil % order.length];
        this.coils.forEach((coil, i) => {
          void coil.set(coilIndex === i ? 1 : 0); // fire-and-forget GPIO write
        });
        this.activeCoil = (this.activeCoil + 1) % this.pinNumbers.length;
      }, intervalMs);

      setTimeout(() => {
        clearInterval(job);
        resolve();
      }, durationMs);
    });
  }

  private async _gotoAngle(targetDegrees: number): Promise<void> {
    targetDegrees = Math.max(this._minAngle, Math.min(this._maxAngle, targetDegrees));

    // Always-positive modulo (JS % can return negative values)
    const mod = (a: number, n: number) => a - Math.floor(a / n) * n;

    let diff = targetDegrees - this._currentAngle;
    diff = mod(diff + 180, 360) - 180; // normalize to [−180, 180] — shortest path

    const absDiff = Math.abs(diff);
    const durationMs = Math.floor(absDiff * (200 / 360)) * 25;
    const direction: Direction = diff >= 0 ? 'ccw' : 'cw';

    if (durationMs > 0) {
      await this._step(direction, 25, durationMs);
    }

    this._currentAngle = targetDegrees;
    this.bus.emit('hardware:motor-moved', { angle: this._currentAngle });
  }

  private async _stop(): Promise<void> {
    await Promise.all(this.coils.map((coil) => coil.set(0)));
  }
}
