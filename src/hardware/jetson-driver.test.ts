import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JetsonGPIODriver, JETSON_PIN_MAP } from './jetson-driver';

/**
 * The driver writes to /sys/class/gpio. We mirror that layout in a tmp dir and
 * pre-create the export/unexport files plus the per-pin gpioN dir so writes
 * land somewhere instead of erroring on a missing path.
 */
async function makeFakeSysfs(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'orobot-jetson-'));
  await fs.writeFile(path.join(root, 'export'), '');
  await fs.writeFile(path.join(root, 'unexport'), '');
  return root;
}

describe('JetsonGPIODriver', () => {
  let root: string;

  beforeEach(async () => { root = await makeFakeSysfs(); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('exports header pin 7 → SoC GPIO 216, writes direction, returns a Pin that writes value', async () => {
    const driver = new JetsonGPIODriver(root);
    // Pre-create the pin dir so the driver skips the export step
    await fs.mkdir(path.join(root, 'gpio216'));

    const pin = await driver.export(7, 'out');
    expect(await fs.readFile(path.join(root, 'gpio216', 'direction'), 'utf8')).toBe('out');

    await pin.set(1);
    expect(await fs.readFile(path.join(root, 'gpio216', 'value'), 'utf8')).toBe('1');
  });

  it('unexport writes the SoC GPIO number to the unexport file', async () => {
    const driver = new JetsonGPIODriver(root);
    await fs.mkdir(path.join(root, 'gpio50'));
    const pin = await driver.export(11, 'in');
    expect(await fs.readFile(path.join(root, 'gpio50', 'direction'), 'utf8')).toBe('in');
    await pin.unexport();
    expect(await fs.readFile(path.join(root, 'unexport'), 'utf8')).toBe('50');
  });

  it('throws when given a header pin with no GPIO mapping', async () => {
    const driver = new JetsonGPIODriver(root);
    // Pin 1 is 3.3V power on the J41 header — never a GPIO.
    await expect(driver.export(1, 'out')).rejects.toThrow(/not a GPIO-capable header pin/);
  });

  it('JETSON_PIN_MAP covers the documented GPIO header pins', () => {
    // Spot-check a few well-known mappings from the Jetson Nano J41 pinout.
    expect(JETSON_PIN_MAP[7]).toBe(216);
    expect(JETSON_PIN_MAP[12]).toBe(79);
    expect(JETSON_PIN_MAP[40]).toBe(78);
    // Non-GPIO pins (power/ground) must not appear.
    expect(JETSON_PIN_MAP[1]).toBeUndefined();
    expect(JETSON_PIN_MAP[2]).toBeUndefined();
    expect(JETSON_PIN_MAP[6]).toBeUndefined();
  });
});
