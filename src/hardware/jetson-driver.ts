/**
 * GPIO driver for NVIDIA Jetson boards (Nano, Xavier NX, Orin Nano).
 *
 * Talks to the Linux sysfs GPIO interface at /sys/class/gpio. The `gpio` npm
 * package used by RPiGPIODriver assumes Pi-style BCM numbering and ships with
 * Pi-specific timing — neither holds on Jetson — so we write to sysfs directly.
 *
 * The 40-pin Jetson header uses the same physical layout as a Raspberry Pi but
 * each header pin maps to a different SoC GPIO number. JETSON_PIN_MAP below
 * translates the logical (header) pin a caller passes in to the SoC GPIO that
 * sysfs expects. The map covers Jetson Nano / Orin Nano; other Jetson variants
 * have a near-identical layout but should be verified against the L4T
 * pinmux spreadsheet before using.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GPIODriver, Pin } from './types';

/**
 * Logical 40-pin header pin → Jetson SoC GPIO number.
 * Source: NVIDIA Jetson Nano J41 header pinout (matches Orin Nano / Xavier NX
 * for the GPIO-capable pins listed). Power, ground, and I²C pins are omitted.
 */
export const JETSON_PIN_MAP: Readonly<Record<number, number>> = Object.freeze({
  7:  216,
  11: 50,
  12: 79,
  13: 14,
  15: 194,
  16: 232,
  18: 15,
  19: 16,
  21: 17,
  22: 13,
  23: 18,
  24: 19,
  26: 20,
  29: 149,
  31: 200,
  32: 168,
  33: 38,
  35: 76,
  36: 51,
  37: 12,
  38: 77,
  40: 78,
});

const SYSFS_ROOT = '/sys/class/gpio';

class JetsonPin implements Pin {
  constructor(private readonly socGpio: number, private readonly root: string) {}

  async set(value: 0 | 1): Promise<void> {
    await fs.writeFile(path.join(this.root, `gpio${this.socGpio}`, 'value'), String(value));
  }

  async unexport(): Promise<void> {
    await fs.writeFile(path.join(this.root, 'unexport'), String(this.socGpio));
  }
}

export class JetsonGPIODriver implements GPIODriver {
  /** Override the sysfs root — useful for tests that mock the filesystem. */
  constructor(private readonly root: string = SYSFS_ROOT) {}

  async export(pin: number, direction: 'in' | 'out'): Promise<Pin> {
    const socGpio = JETSON_PIN_MAP[pin];
    if (socGpio === undefined) {
      const known = Object.keys(JETSON_PIN_MAP).join(', ');
      throw new Error(`Pin ${pin} is not a GPIO-capable header pin on Jetson. Known pins: ${known}`);
    }
    const pinDir = path.join(this.root, `gpio${socGpio}`);
    try {
      await fs.access(pinDir);
    } catch {
      await fs.writeFile(path.join(this.root, 'export'), String(socGpio));
    }
    await fs.writeFile(path.join(pinDir, 'direction'), direction);
    return new JetsonPin(socGpio, this.root);
  }
}
