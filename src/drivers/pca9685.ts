/**
 * PCA9685 I²C PWM driver.
 *
 * Controls up to 16 PWM channels (12 used for SpotMicro servos) via the
 * i2c-bus package. In `NODE_ENV=sim` mode the I²C bus is mocked so all tests
 * run without real hardware.
 *
 * Datasheet reference: NXP PCA9685 — registers 0x00–0x4A.
 */

// ── PCA9685 register map ─────────────────────────────────────────────────────

const REG_MODE1        = 0x00;
const REG_PRESCALE     = 0xFE;
/** Base address of channel 0 LED_ON_L register; each channel spans 4 bytes. */
const REG_LED0_ON_L    = 0x06;

const MODE1_RESTART = 0x80;
const MODE1_SLEEP   = 0x10;
const MODE1_AI      = 0x20; // auto-increment
const MODE1_ALLCALL = 0x01;

/** Resolution of the PCA9685 PWM counter (12-bit). */
const PWM_RESOLUTION = 4096;

/** Default oscillator frequency in Hz (internal oscillator). */
const DEFAULT_OSC_FREQ_HZ = 25_000_000;

/** Default PWM frequency for hobby servos (50 Hz → 20 ms period). */
const DEFAULT_PWM_FREQ_HZ = 50;

// ── Mock I²C bus (sim mode) ──────────────────────────────────────────────────

export interface I2CBusLike {
  writeByteSync(addr: number, cmd: number, byte: number): void;
  readByteSync(addr: number, cmd: number): number;
  closeSync(): void;
}

export class MockI2CBus implements I2CBusLike {
  readonly registers = new Map<number, number>();

  writeByteSync(_addr: number, cmd: number, byte: number): void {
    this.registers.set(cmd, byte);
  }

  readByteSync(_addr: number, cmd: number): number {
    return this.registers.get(cmd) ?? 0;
  }

  closeSync(): void { /* no-op */ }
}

// ── PCA9685 driver ────────────────────────────────────────────────────────────

export interface PCA9685Options {
  /** I²C bus number (default 1 on Raspberry Pi). */
  busNumber?: number;
  /** I²C device address (default 0x40). */
  address?: number;
  /** Inject a mock bus for testing; when provided `busNumber` is ignored. */
  mockBus?: I2CBusLike;
}

export class PCA9685Driver {
  private readonly address: number;
  private bus: I2CBusLike | null = null;
  private readonly busNumber: number;
  private readonly mockBus?: I2CBusLike;
  private oscFreqHz = DEFAULT_OSC_FREQ_HZ;

  constructor(options: PCA9685Options = {}) {
    this.address   = options.address   ?? 0x40;
    this.busNumber = options.busNumber ?? 1;
    this.mockBus   = options.mockBus;
  }

  /**
   * Opens the I²C bus and configures the PCA9685 for servo PWM output.
   *
   * @param oscFreqHz  Internal oscillator frequency (Hz); defaults to 25 MHz.
   *                   Calibrate this if servo timing is slightly off.
   */
  async init(oscFreqHz = DEFAULT_OSC_FREQ_HZ): Promise<void> {
    this.oscFreqHz = oscFreqHz;

    if (this.mockBus) {
      this.bus = this.mockBus;
    } else if (process.env['NODE_ENV'] === 'sim') {
      this.bus = new MockI2CBus();
    } else {
      // Lazy-require so tests never import i2c-bus (it may not be installed).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const i2c = require('i2c-bus') as typeof import('i2c-bus');
      this.bus = i2c.openSync(this.busNumber);
    }

    await this._setPwmFrequency(DEFAULT_PWM_FREQ_HZ);
  }

  /** Releases the I²C bus. */
  close(): void {
    this.bus?.closeSync();
    this.bus = null;
  }

  /**
   * Sets a raw PWM pulse for one channel.
   *
   * @param channel      Channel index 0–15.
   * @param pulseWidthUs Pulse width in microseconds (e.g. 1500 for centre).
   */
  setChannel(channel: number, pulseWidthUs: number): void {
    if (channel < 0 || channel > 15) {
      throw new RangeError(`PCA9685: channel must be 0–15, got ${channel}`);
    }
    if (!this.bus) throw new Error('PCA9685: call init() before setChannel()');

    const periodUs = 1_000_000 / DEFAULT_PWM_FREQ_HZ; // 20 000 µs for 50 Hz
    const onTicks  = Math.round((pulseWidthUs / periodUs) * PWM_RESOLUTION);
    const clamped  = Math.max(0, Math.min(PWM_RESOLUTION - 1, onTicks));

    const base = REG_LED0_ON_L + channel * 4;
    // ON  time = 0 (start pulse at tick 0)
    this.bus.writeByteSync(this.address, base,     0x00); // LED_ON_L
    this.bus.writeByteSync(this.address, base + 1, 0x00); // LED_ON_H
    // OFF time = clamped ticks
    this.bus.writeByteSync(this.address, base + 2, clamped & 0xFF);        // LED_OFF_L
    this.bus.writeByteSync(this.address, base + 3, (clamped >> 8) & 0x0F); // LED_OFF_H
  }

  /**
   * Converts a servo angle to a pulse width and programs the channel.
   *
   * @param channel   Channel index 0–15.
   * @param angleDeg  Angle in degrees, −90 to +90.
   *                  −90 maps to ~500 µs, 0 to 1500 µs, +90 to ~2500 µs.
   */
  setServoAngle(channel: number, angleDeg: number): void {
    const pulseUs = angleToPulseUs(angleDeg);
    this.setChannel(channel, pulseUs);
  }

  // ── private helpers ──────────────────────────────────────────────────────

  private async _setPwmFrequency(freqHz: number): Promise<void> {
    const bus = this.bus!;

    // PCA9685 prescale formula (datasheet §7.3.5):
    //   prescale = round(osc_clock / (4096 × update_rate)) − 1
    const prescale = Math.round(this.oscFreqHz / (PWM_RESOLUTION * freqHz)) - 1;

    // Must be in SLEEP mode to change prescaler.
    const mode1 = bus.readByteSync(this.address, REG_MODE1);
    const sleepMode = (mode1 & ~MODE1_RESTART) | MODE1_SLEEP;
    bus.writeByteSync(this.address, REG_MODE1, sleepMode);
    bus.writeByteSync(this.address, REG_PRESCALE, prescale);

    // Wake up with auto-increment and ALLCALL enabled.
    bus.writeByteSync(this.address, REG_MODE1, mode1);
    // Datasheet requires ≥500 µs before RESTART — in firmware context a sync
    // sleep is impractical; yield once to allow the event loop to breathe.
    await new Promise<void>((r) => setImmediate(r));
    bus.writeByteSync(this.address, REG_MODE1, mode1 | MODE1_RESTART | MODE1_AI | MODE1_ALLCALL);
  }
}

// ── Pure conversion helper (exported for unit tests) ─────────────────────────

/** Minimum pulse width in µs (maps to −90°). */
export const SERVO_MIN_US = 500;
/** Centre pulse width in µs (maps to 0°). */
export const SERVO_CENTER_US = 1500;
/** Maximum pulse width in µs (maps to +90°). */
export const SERVO_MAX_US = 2500;

/**
 * Converts a servo angle (−90 to +90 degrees) to a PWM pulse width in µs.
 * Angles outside [−90, +90] are clamped.
 */
export function angleToPulseUs(angleDeg: number): number {
  const clamped = Math.max(-90, Math.min(90, angleDeg));
  // Linear interpolation: −90 → 500 µs, +90 → 2500 µs
  return SERVO_CENTER_US + (clamped / 90) * (SERVO_MAX_US - SERVO_CENTER_US);
}
