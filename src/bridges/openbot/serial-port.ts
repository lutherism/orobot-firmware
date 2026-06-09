/**
 * USB serial port abstraction for OpenBot Arduino Nano communication.
 *
 * Production: wraps Node.js `serialport` package to open /dev/ttyUSB0 (or
 * configurable path) at 115200 baud and send line-terminated commands.
 *
 * Tests / dev-mode: OpenBotMockSerialPort records every written line for test
 * assertions — no hardware or serialport package required.
 *
 * Serial protocol (Arduino Nano running openbot.ino):
 *   Control command:  "c:<left>,<right>\n"  — values -255..255 (negative = reverse)
 *   Heartbeat:        "h:<interval_ms>\n"   — keep-alive; Arduino stops motors if missed
 *
 * Usage pattern mirrors FeetechBus for SO-101: inject the implementation at
 * bridge construction time; production uses OpenBotProductionSerialPort.
 */

// ── Public interface ──────────────────────────────────────────────────────────

/** Abstraction over the USB serial connection to the Arduino Nano. */
export interface OpenBotSerialPort {
  /** Open the serial port. Idempotent. */
  open(): Promise<void>;
  /** Write a line to the serial port (newline appended automatically). */
  writeLine(line: string): Promise<void>;
  /** Close the port cleanly. */
  close(): Promise<void>;
}

// ── Mock implementation ───────────────────────────────────────────────────────

/** In-memory mock serial port — records every written line for test assertions. */
export class OpenBotMockSerialPort implements OpenBotSerialPort {
  /** All lines written since the mock was created (or since last reset). */
  readonly written: string[] = [];
  private _open = false;

  open(): Promise<void> {
    this._open = true;
    return Promise.resolve();
  }

  writeLine(line: string): Promise<void> {
    if (!this._open) throw new Error('OpenBotMockSerialPort: port not open');
    this.written.push(line);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this._open = false;
    return Promise.resolve();
  }

  get isOpen(): boolean { return this._open; }

  /** Reset recorded write history (useful between test cases). */
  reset(): void { this.written.length = 0; }
}

// ── Production implementation ─────────────────────────────────────────────────

/** Lazily-loaded serialport binding — loaded only in production paths. */
interface SerialPortLike {
  isOpen: boolean;
  open(cb: (err: Error | null | undefined) => void): void;
  write(data: string, cb?: (err: Error | null | undefined) => void): boolean;
  drain(cb: (err: Error | null | undefined) => void): void;
  close(cb: (err: Error | null | undefined) => void): void;
}

type SerialPortConstructor = new (options: {
  path: string;
  baudRate: number;
  autoOpen: boolean;
}) => SerialPortLike;

/**
 * Production serial port — delegates to the `serialport` npm package.
 *
 * The `serialport` package is loaded lazily via `require()` so the firmware
 * can boot without it on platforms that don't have native bindings compiled
 * (e.g., the simulator or CI).  Pass a mock in tests instead.
 */
export class OpenBotProductionSerialPort implements OpenBotSerialPort {
  private port: SerialPortLike | null = null;

  constructor(private readonly devicePath: string = '/dev/ttyUSB0') {}

  async open(): Promise<void> {
    if (this.port?.isOpen) return;

    // Lazy-require so the module doesn't fail to load on platforms without
    // the native serialport binding (simulator, test env).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SerialPort } = require('serialport') as { SerialPort: SerialPortConstructor };

    const port = new SerialPort({
      path:      this.devicePath,
      baudRate:  115200,
      autoOpen:  false,
    });

    await new Promise<void>((resolve, reject) => {
      port.open((err) => (err ? reject(err) : resolve()));
    });

    this.port = port;
  }

  async writeLine(line: string): Promise<void> {
    if (!this.port?.isOpen) {
      throw new Error(`OpenBotProductionSerialPort: port not open — cannot write "${line}"`);
    }

    await new Promise<void>((resolve, reject) => {
      const ok = this.port!.write(line + '\n', (err) => {
        if (err) reject(err);
      });
      if (ok) {
        this.port!.drain((err) => (err ? reject(err) : resolve()));
      }
    });
  }

  async close(): Promise<void> {
    if (!this.port?.isOpen) return;
    await new Promise<void>((resolve, reject) => {
      this.port!.close((err) => (err ? reject(err) : resolve()));
    });
    this.port = null;
  }
}
