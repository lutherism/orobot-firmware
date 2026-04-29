import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JetsonGPIODriver, JETSON_PIN_MAP } from './jetson-driver';

// Mock node-libgpiod so tests run without the native binary or real hardware.
const mockSetValue = vi.fn();
const mockRelease = vi.fn();
const mockRequestOutputMode = vi.fn();
const mockGetLine = vi.fn(() => ({
  requestOutputMode: mockRequestOutputMode,
  setValue: mockSetValue,
  release: mockRelease,
}));

vi.mock('node-libgpiod', async () => {
  class Chip { getLine = mockGetLine; }
  class Line {}
  return { Chip, Line };
});

describe('JetsonGPIODriver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports header pin 11 → chip 0 line 50, requests output mode', async () => {
    const driver = new JetsonGPIODriver();
    await driver.export(11, 'out');
    expect(mockGetLine).toHaveBeenCalledWith(50);
    expect(mockRequestOutputMode).toHaveBeenCalledWith('orobot');
  });

  it('pin.set() calls setValue with the given value', async () => {
    const driver = new JetsonGPIODriver();
    const pin = await driver.export(11, 'out');
    await pin.set(1);
    expect(mockSetValue).toHaveBeenCalledWith(1);
    await pin.set(0);
    expect(mockSetValue).toHaveBeenCalledWith(0);
  });

  it('pin.unexport() releases the line', async () => {
    const driver = new JetsonGPIODriver();
    const pin = await driver.export(12, 'out');
    await pin.unexport();
    expect(mockRelease).toHaveBeenCalled();
  });

  it('reuses the same Chip instance for pins on the same chip', async () => {
    const driver = new JetsonGPIODriver();
    await driver.export(11, 'out');
    await driver.export(12, 'out');
    // Both pins are on chip 0 — getLine should be called twice on the same mock instance.
    expect(mockGetLine).toHaveBeenCalledTimes(2);
    expect(mockGetLine).toHaveBeenCalledWith(50);
    expect(mockGetLine).toHaveBeenCalledWith(79);
  });

  it('throws for a non-GPIO header pin', async () => {
    const driver = new JetsonGPIODriver();
    await expect(driver.export(1, 'out')).rejects.toThrow(/not a GPIO-capable header pin/);
  });

  it('JETSON_PIN_MAP covers documented GPIO header pins', () => {
    expect(JETSON_PIN_MAP[7]).toEqual({ chip: 0, line: 106 });
    expect(JETSON_PIN_MAP[12]).toEqual({ chip: 0, line: 79 });
    expect(JETSON_PIN_MAP[40]).toEqual({ chip: 0, line: 78 });
    expect(JETSON_PIN_MAP[1]).toBeUndefined();
    expect(JETSON_PIN_MAP[6]).toBeUndefined();
  });
});
