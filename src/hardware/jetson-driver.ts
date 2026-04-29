/**
 * GPIO driver for NVIDIA Jetson Orin Nano / Orin NX (JetPack 6+).
 *
 * JetPack 6 removed the legacy sysfs GPIO interface (/sys/class/gpio) in favour
 * of the Linux character device API (/dev/gpiochip*). This driver uses the
 * `node-libgpiod` native bindings to talk to that interface.
 *
 * Pin numbers passed in are 40-pin header positions. JETSON_PIN_MAP translates
 * them to (chip, line) pairs. On Orin the primary GPIO bank is gpiochip0 and
 * line numbers are the Tegra SoC GPIO numbers — the same values the old sysfs
 * driver used, just accessed differently.
 *
 * To verify pin assignments on a live board: `gpioinfo` (install via `apt install gpiod`).
 */
import type { GPIODriver, Pin } from './types';

// Loaded lazily so tests and non-Jetson builds can import this file without
// the native module installed. The real load happens in JetsonGPIODriver.export().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let libgpiod: any;

/** 40-pin header position → { chip index, line number } */
export const JETSON_PIN_MAP: Readonly<Record<number, { chip: number; line: number }>> = Object.freeze({
  7:  { chip: 0, line: 106 },
  11: { chip: 0, line: 50  },
  12: { chip: 0, line: 79  },
  13: { chip: 0, line: 14  },
  15: { chip: 0, line: 194 },
  16: { chip: 0, line: 232 },
  18: { chip: 0, line: 15  },
  19: { chip: 0, line: 16  },
  21: { chip: 0, line: 17  },
  22: { chip: 0, line: 13  },
  23: { chip: 0, line: 18  },
  24: { chip: 0, line: 19  },
  26: { chip: 0, line: 20  },
  29: { chip: 0, line: 149 },
  31: { chip: 0, line: 200 },
  32: { chip: 0, line: 168 },
  33: { chip: 0, line: 38  },
  35: { chip: 0, line: 76  },
  36: { chip: 0, line: 51  },
  37: { chip: 0, line: 12  },
  38: { chip: 0, line: 77  },
  40: { chip: 0, line: 78  },
});

class JetsonPin implements Pin {
  constructor(private readonly line: { setValue(v: 0|1): void; release(): void }) {}

  async set(value: 0 | 1): Promise<void> {
    this.line.setValue(value);
  }

  async unexport(): Promise<void> {
    this.line.release();
  }
}

export class JetsonGPIODriver implements GPIODriver {
  private readonly chips = new Map<number, { getLine(n: number): { requestOutputMode(c: string): void; setValue(v: 0|1): void; release(): void } }>();

  async export(headerPin: number, _direction: 'in' | 'out'): Promise<Pin> {
    const mapping = JETSON_PIN_MAP[headerPin];
    if (!mapping) {
      const known = Object.keys(JETSON_PIN_MAP).join(', ');
      throw new Error(`Pin ${headerPin} is not a GPIO-capable header pin on Jetson. Known pins: ${known}`);
    }

    if (!libgpiod) libgpiod = await import('node-libgpiod');

    let chip = this.chips.get(mapping.chip);
    if (!chip) {
      chip = new libgpiod.Chip(mapping.chip);
      this.chips.set(mapping.chip, chip!);
    }

    const line = chip!.getLine(mapping.line);
    line.requestOutputMode('orobot');
    return new JetsonPin(line);
  }
}
