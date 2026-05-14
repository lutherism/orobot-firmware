import { describe, it, expect, beforeEach } from 'vitest';
import {
  PCA9685Driver,
  MockI2CBus,
  angleToPulseUs,
  SERVO_MIN_US,
  SERVO_CENTER_US,
  SERVO_MAX_US,
} from './pca9685';
import {
  SERVO_MAP,
  ACTIVE_CHANNELS,
  resolveChannel,
} from './spotmicro-servo-map';

// ── angleToPulseUs ────────────────────────────────────────────────────────────

describe('angleToPulseUs', () => {
  it('maps 0° to centre pulse (1500 µs)', () => {
    expect(angleToPulseUs(0)).toBe(SERVO_CENTER_US);
  });

  it('maps -90° to minimum pulse (500 µs)', () => {
    expect(angleToPulseUs(-90)).toBe(SERVO_MIN_US);
  });

  it('maps +90° to maximum pulse (2500 µs)', () => {
    expect(angleToPulseUs(90)).toBe(SERVO_MAX_US);
  });

  it('maps +45° to midpoint between centre and max (2000 µs)', () => {
    expect(angleToPulseUs(45)).toBe(2000);
  });

  it('maps -45° to midpoint between min and centre (1000 µs)', () => {
    expect(angleToPulseUs(-45)).toBe(1000);
  });

  it('clamps angle below -90 to 500 µs', () => {
    expect(angleToPulseUs(-180)).toBe(SERVO_MIN_US);
  });

  it('clamps angle above +90 to 2500 µs', () => {
    expect(angleToPulseUs(180)).toBe(SERVO_MAX_US);
  });
});

// ── PCA9685Driver (mock bus) ──────────────────────────────────────────────────

describe('PCA9685Driver (mock bus)', () => {
  let mockBus: MockI2CBus;
  let driver: PCA9685Driver;

  beforeEach(async () => {
    mockBus = new MockI2CBus();
    driver  = new PCA9685Driver({ address: 0x40, mockBus });
    await driver.init();
  });

  it('initialises without throwing', async () => {
    const d = new PCA9685Driver({ mockBus: new MockI2CBus() });
    await expect(d.init()).resolves.toBeUndefined();
    d.close();
  });

  it('writes LED_ON and LED_OFF registers for channel 0 at 0°', () => {
    driver.setServoAngle(0, 0);
    // Centre pulse = 1500 µs.  Period = 20 000 µs.  Ticks = 1500/20000 * 4096 ≈ 307.
    const expectedTicks = Math.round((1500 / 20_000) * 4096);
    const base = 0x06; // REG_LED0_ON_L
    expect(mockBus.registers.get(base + 2)).toBe(expectedTicks & 0xFF);
    expect(mockBus.registers.get(base + 3)).toBe((expectedTicks >> 8) & 0x0F);
  });

  it('writes correct ticks for channel 4 at -90°', () => {
    driver.setServoAngle(4, -90);
    const expectedTicks = Math.round((500 / 20_000) * 4096); // ≈ 102
    const base = 0x06 + 4 * 4;
    expect(mockBus.registers.get(base + 2)).toBe(expectedTicks & 0xFF);
    expect(mockBus.registers.get(base + 3)).toBe((expectedTicks >> 8) & 0x0F);
  });

  it('writes correct ticks for channel 4 at +90°', () => {
    driver.setServoAngle(4, 90);
    const expectedTicks = Math.round((2500 / 20_000) * 4096); // ≈ 512
    const base = 0x06 + 4 * 4;
    expect(mockBus.registers.get(base + 2)).toBe(expectedTicks & 0xFF);
    expect(mockBus.registers.get(base + 3)).toBe((expectedTicks >> 8) & 0x0F);
  });

  it('throws RangeError for channel < 0', () => {
    expect(() => driver.setChannel(-1, 1500)).toThrow(RangeError);
  });

  it('throws RangeError for channel > 15', () => {
    expect(() => driver.setChannel(16, 1500)).toThrow(RangeError);
  });

  it('throws when setChannel called before init()', () => {
    const uninitialised = new PCA9685Driver({ mockBus });
    expect(() => uninitialised.setChannel(0, 1500)).toThrow('init()');
  });

  it('close() does not throw', () => {
    expect(() => driver.close()).not.toThrow();
  });
});

// ── sim mode (NODE_ENV=sim) ───────────────────────────────────────────────────

describe('PCA9685Driver sim mode (NODE_ENV=sim)', () => {
  it('uses MockI2CBus automatically when NODE_ENV=sim', async () => {
    const orig = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'sim';
    try {
      const d = new PCA9685Driver();
      await d.init();
      // Should not throw even without real hardware.
      expect(() => d.setServoAngle(0, 45)).not.toThrow();
      d.close();
    } finally {
      process.env['NODE_ENV'] = orig;
    }
  });
});

// ── SERVO_MAP ─────────────────────────────────────────────────────────────────

describe('SERVO_MAP', () => {
  it('has exactly 4 legs', () => {
    expect(Object.keys(SERVO_MAP)).toHaveLength(4);
  });

  it('every leg has hip, thigh, calf channels', () => {
    for (const [leg, channels] of Object.entries(SERVO_MAP)) {
      expect(typeof channels.hip,   `${leg}.hip`).toBe('number');
      expect(typeof channels.thigh, `${leg}.thigh`).toBe('number');
      expect(typeof channels.calf,  `${leg}.calf`).toBe('number');
    }
  });

  it('frontLeft channels are 0, 1, 2', () => {
    expect(SERVO_MAP.frontLeft).toEqual({ hip: 0, thigh: 1, calf: 2 });
  });

  it('frontRight channels are 4, 5, 6', () => {
    expect(SERVO_MAP.frontRight).toEqual({ hip: 4, thigh: 5, calf: 6 });
  });

  it('rearLeft channels are 8, 9, 10', () => {
    expect(SERVO_MAP.rearLeft).toEqual({ hip: 8, thigh: 9, calf: 10 });
  });

  it('rearRight channels are 12, 13, 14', () => {
    expect(SERVO_MAP.rearRight).toEqual({ hip: 12, thigh: 13, calf: 14 });
  });

  it('ACTIVE_CHANNELS has exactly 12 channels', () => {
    expect(ACTIVE_CHANNELS).toHaveLength(12);
  });

  it('ACTIVE_CHANNELS contains no duplicates', () => {
    expect(new Set(ACTIVE_CHANNELS).size).toBe(12);
  });

  it('all ACTIVE_CHANNELS are in range 0–15', () => {
    for (const ch of ACTIVE_CHANNELS) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(15);
    }
  });
});

// ── resolveChannel ────────────────────────────────────────────────────────────

describe('resolveChannel', () => {
  it('resolves frontLeft hip to channel 0', () => {
    expect(resolveChannel('frontLeft', 'hip')).toBe(0);
  });

  it('resolves rearRight calf to channel 14', () => {
    expect(resolveChannel('rearRight', 'calf')).toBe(14);
  });

  it('returns null for unknown leg', () => {
    expect(resolveChannel('middleLeft', 'hip')).toBeNull();
  });

  it('returns null for unknown joint', () => {
    expect(resolveChannel('frontLeft', 'ankle')).toBeNull();
  });

  it('returns null for empty strings', () => {
    expect(resolveChannel('', '')).toBeNull();
  });
});
