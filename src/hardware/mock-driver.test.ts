import { describe, it, expect } from 'vitest';
import { MockGPIODriver } from './mock-driver';

describe('MockGPIODriver', () => {
  it('export() registers a pin and returns a Pin', async () => {
    const driver = new MockGPIODriver();
    const pin = await driver.export(17, 'out');
    expect(pin).toBeDefined();
    expect(driver.pins.has(17)).toBe(true);
  });

  it('exported pin starts at value 0', async () => {
    const driver = new MockGPIODriver();
    await driver.export(17, 'out');
    expect(driver.pins.get(17)!.value).toBe(0);
  });

  it('set(1) updates the inspectable pin value', async () => {
    const driver = new MockGPIODriver();
    const pin = await driver.export(17, 'out');
    await pin.set(1);
    expect(driver.pins.get(17)!.value).toBe(1);
  });

  it('set(0) after set(1) returns the pin to 0', async () => {
    const driver = new MockGPIODriver();
    const pin = await driver.export(17, 'out');
    await pin.set(1);
    await pin.set(0);
    expect(driver.pins.get(17)!.value).toBe(0);
  });

  it('unexport() resolves without throwing', async () => {
    const driver = new MockGPIODriver();
    const pin = await driver.export(17, 'out');
    await expect(pin.unexport()).resolves.toBeUndefined();
  });

  it('each pin number gets its own independent MockPin', async () => {
    const driver = new MockGPIODriver();
    const pin17 = await driver.export(17, 'out');
    const pin18 = await driver.export(18, 'out');
    await pin17.set(1);
    expect(driver.pins.get(17)!.value).toBe(1);
    expect(driver.pins.get(18)!.value).toBe(0);
  });
});
