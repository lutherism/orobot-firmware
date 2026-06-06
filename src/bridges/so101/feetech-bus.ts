/**
 * Feetech STS3215 serial bus abstraction.
 *
 * Production: wraps the `feetech-servo-sdk` npm package which sends
 * half-duplex UART packets over /dev/ttyACM0.
 *
 * Tests / dev-mode: FeetechMockBus stores the last commanded position
 * per servo ID in memory — zero hardware required.
 *
 * Usage pattern mirrors the MockGPIODriver / MockI2CBus pattern elsewhere
 * in orobot-firmware: inject an implementation at construction time.
 */

// ── Public interface ──────────────────────────────────────────────────────────

/** One servo on the Feetech bus.  Units are always raw STS3215 ticks (0–4095). */
export interface FeetechServo {
  readonly id: number;
  /**
   * Command the servo to move to `ticks` at `speed` ticks/s.
   * Returns once the command has been dispatched (does NOT wait for the
   * servo to finish moving — STS3215 has no sync reply for write ops).
   */
  setPosition(ticks: number, speed?: number): Promise<void>;
  /** Read the current position from the servo register. */
  getPosition(): Promise<number>;
}

/** Bus-level abstraction over a Feetech serial adapter. */
export interface FeetechBus {
  /** Open the serial port and initialise the SDK.  Idempotent. */
  open(): Promise<void>;
  /** Close the port cleanly. */
  close(): Promise<void>;
  /** Get (or create) a handle for a servo with the given bus ID (1–253). */
  servo(id: number): FeetechServo;
}

// ── Mock implementation ───────────────────────────────────────────────────────

/** In-memory mock servo — records every setPosition call for test assertions. */
export class MockServo implements FeetechServo {
  readonly calls: Array<{ ticks: number; speed?: number }> = [];
  private _position = 2048; // midpoint

  constructor(readonly id: number) {}

  setPosition(ticks: number, speed?: number): Promise<void> {
    this.calls.push({ ticks, speed });
    this._position = ticks;
    return Promise.resolve();
  }

  getPosition(): Promise<number> {
    return Promise.resolve(this._position);
  }

  /** Reset recorded call history (useful between test cases). */
  reset(): void {
    this.calls.length = 0;
  }
}

export class FeetechMockBus implements FeetechBus {
  /** Inspectable map of servo ID → MockServo for test assertions. */
  readonly servos = new Map<number, MockServo>();
  private _opened = false;

  open(): Promise<void> {
    this._opened = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this._opened = false;
    return Promise.resolve();
  }

  servo(id: number): MockServo {
    if (!this.servos.has(id)) {
      this.servos.set(id, new MockServo(id));
    }
    return this.servos.get(id)!;
  }

  get isOpen(): boolean { return this._opened; }
}

// ── Production implementation (dynamically loaded) ────────────────────────────

/**
 * Lazily require the feetech-servo-sdk so that:
 *  - Tests work without the native module installed.
 *  - Production devices with the SDK installed get real hardware control.
 *
 * The SDK exposes a `ServoController` class with a `write` method that
 * accepts (id, regAddr, value, byteLen).  We translate our `setPosition`
 * contract to its WritePosEx helper which sets position + speed atomically.
 *
 * If you need to switch to the lerobot Python SDK instead, replace this
 * class with a bridge that spawns a Python child process.
 */
class ProductionServo implements FeetechServo {
  constructor(
    readonly id: number,
    private readonly controller: unknown,  // feetech-servo-sdk ServoController
  ) {}

  setPosition(ticks: number, speed = 0): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.controller as any).WritePosEx(this.id, ticks, speed, 1 /* acceleration */);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  getPosition(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pos = (this.controller as any).ReadPos(this.id);
    return Promise.resolve(typeof pos === 'number' ? pos : 2048);
  }
}

export class FeetechProductionBus implements FeetechBus {
  private controller: unknown = null;
  private readonly _servos = new Map<number, ProductionServo>();

  constructor(
    private readonly port: string = '/dev/ttyACM0',
    private readonly baudRate: number = 1_000_000,
  ) {}

  async open(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdk = require('feetech-servo-sdk') as { ServoController: new (port: string, baud: number) => unknown };
    const ctrl = new sdk.ServoController(this.port, this.baudRate);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (ctrl as any).begin();
    this.controller = ctrl;
  }

  async close(): Promise<void> {
    if (this.controller) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.controller as any).end?.();
    }
    this.controller = null;
  }

  servo(id: number): ProductionServo {
    if (!this._servos.has(id)) {
      this._servos.set(id, new ProductionServo(id, this.controller));
    }
    return this._servos.get(id)!;
  }
}
