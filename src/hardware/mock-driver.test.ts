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

describe('MockGPIODriver — pwmWrite', () => {
  it('records a pwmWrite call with pin and value', async () => {
    const driver = new MockGPIODriver();
    await driver.pwmWrite(18, 128);
    expect(driver.pwmCalls).toHaveLength(1);
    expect(driver.pwmCalls[0]).toEqual({ pin: 18, value: 128 });
  });

  it('records multiple sequential pwmWrite calls in order', async () => {
    const driver = new MockGPIODriver();
    await driver.pwmWrite(18, 0);
    await driver.pwmWrite(18, 200);
    await driver.pwmWrite(27, 50);
    expect(driver.pwmCalls).toEqual([
      { pin: 18, value: 0 },
      { pin: 18, value: 200 },
      { pin: 27, value: 50 },
    ]);
  });

  it('clamps values above 255 to 255', async () => {
    const driver = new MockGPIODriver();
    await driver.pwmWrite(18, 300);
    expect(driver.pwmCalls[0].value).toBe(255);
  });

  it('clamps negative values to 0', async () => {
    const driver = new MockGPIODriver();
    await driver.pwmWrite(18, -10);
    expect(driver.pwmCalls[0].value).toBe(0);
  });

  it('rounds fractional values to the nearest integer', async () => {
    const driver = new MockGPIODriver();
    await driver.pwmWrite(18, 127.6);
    expect(driver.pwmCalls[0].value).toBe(128);
    await driver.pwmWrite(18, 127.4);
    expect(driver.pwmCalls[1].value).toBe(127);
  });

  it('accepts boundary values 0 and 255 unchanged', async () => {
    const driver = new MockGPIODriver();
    await driver.pwmWrite(18, 0);
    await driver.pwmWrite(18, 255);
    expect(driver.pwmCalls[0].value).toBe(0);
    expect(driver.pwmCalls[1].value).toBe(255);
  });

  it('digital export() and pwmWrite() are independent — pins map is unaffected', async () => {
    const driver = new MockGPIODriver();
    await driver.export(17, 'out');
    await driver.pwmWrite(18, 200);
    // Digital pin tracking unchanged
    expect(driver.pins.has(17)).toBe(true);
    expect(driver.pins.has(18)).toBe(false);
    // PWM call recorded
    expect(driver.pwmCalls).toHaveLength(1);
  });
});
