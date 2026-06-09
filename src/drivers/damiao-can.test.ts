import { describe, it, expect, beforeEach } from 'vitest';
import {
  floatToUint,
  uintToFloat,
  packMitFrame,
  parseFeedbackFrame,
  DamiaoCanDriver,
  MockCanBus,
  DM_MOTOR_LIMITS,
  type DmMotorLimits,
} from './damiao-can';

// ── Shared motor limits (DM4310 — most common test subject) ──────────────────

const DM4310 = DM_MOTOR_LIMITS['DM4310']!;

// ── floatToUint ───────────────────────────────────────────────────────────────

describe('floatToUint', () => {
  it('maps midpoint to 50% of the range', () => {
    // 0 maps to the midpoint of a ±12.5 range → 50% of 65535
    expect(floatToUint(0, -12.5, 12.5, 16)).toBe(Math.round(0.5 * 65535));
  });

  it('maps xMin to 0', () => {
    expect(floatToUint(-12.5, -12.5, 12.5, 16)).toBe(0);
  });

  it('maps xMax to 2^bits - 1', () => {
    expect(floatToUint(12.5, -12.5, 12.5, 16)).toBe(65535);
  });

  it('clamps below xMin to 0', () => {
    expect(floatToUint(-999, -12.5, 12.5, 16)).toBe(0);
  });

  it('clamps above xMax to 2^bits - 1', () => {
    expect(floatToUint(999, -12.5, 12.5, 16)).toBe(65535);
  });

  it('12-bit KP: maps 250 (midpoint of 0–500) to 2047', () => {
    expect(floatToUint(250, 0, 500, 12)).toBe(Math.round(0.5 * 4095));
  });

  it('12-bit KD: maps 2.5 (midpoint of 0–5) to 2047', () => {
    expect(floatToUint(2.5, 0, 5, 12)).toBe(Math.round(0.5 * 4095));
  });
});

// ── uintToFloat (round-trip) ──────────────────────────────────────────────────

describe('uintToFloat', () => {
  it('maps 0 back to xMin', () => {
    expect(uintToFloat(0, -12.5, 12.5, 16)).toBeCloseTo(-12.5);
  });

  it('maps 2^bits-1 back to xMax', () => {
    expect(uintToFloat(65535, -12.5, 12.5, 16)).toBeCloseTo(12.5);
  });

  it('round-trips a position value', () => {
    const pos = 3.14;
    const u   = floatToUint(pos, -12.5, 12.5, 16);
    // Quantisation error for 16-bit over ±12.5 rad is ≈ 0.0004 rad — accept 0.001.
    expect(uintToFloat(u, -12.5, 12.5, 16)).toBeCloseTo(pos, 2);
  });

  it('round-trips a velocity value', () => {
    const vel = 10;
    const u   = floatToUint(vel, -30, 30, 12);
    expect(uintToFloat(u, -30, 30, 12)).toBeCloseTo(vel, 1);
  });

  it('round-trips a torque value', () => {
    const tau = -5;
    const u   = floatToUint(tau, -10, 10, 12);
    expect(uintToFloat(u, -10, 10, 12)).toBeCloseTo(tau, 1);
  });
});

// ── packMitFrame ─────────────────────────────────────────────────────────────

describe('packMitFrame', () => {
  it('returns an 8-byte Buffer', () => {
    const buf = packMitFrame(0, 0, 0, 0, 0, DM4310);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(8);
  });

  it('position 0 → D[0..1] encode 32767 (midpoint of 16-bit)', () => {
    const buf = packMitFrame(0, 0, 0, 0, 0, DM4310);
    const posU = (buf[0]! << 8) | buf[1]!;
    // 0 in ±12.5 → midpoint ≈ 32767 (rounds)
    expect(posU).toBe(Math.round(0.5 * 65535));
  });

  it('velocity 0 → vel_u is 2047 (midpoint of 12-bit)', () => {
    const buf  = packMitFrame(0, 0, 0, 0, 0, DM4310);
    const velU = (buf[2]! << 4) | ((buf[3]! >> 4) & 0x0F);
    expect(velU).toBe(Math.round(0.5 * 4095));
  });

  it('kp=0 → kp_u is 0', () => {
    const buf = packMitFrame(0, 0, 0, 0, 0, DM4310);
    const kpU = ((buf[3]! & 0x0F) << 8) | buf[4]!;
    expect(kpU).toBe(0);
  });

  it('kp=500 → kp_u is 4095', () => {
    const buf = packMitFrame(0, 0, 500, 0, 0, DM4310);
    const kpU = ((buf[3]! & 0x0F) << 8) | buf[4]!;
    expect(kpU).toBe(4095);
  });

  it('kd=0 → kd_u is 0', () => {
    const buf = packMitFrame(0, 0, 0, 0, 0, DM4310);
    const kdU = (buf[5]! << 4) | ((buf[6]! >> 4) & 0x0F);
    expect(kdU).toBe(0);
  });

  it('kd=5 → kd_u is 4095', () => {
    const buf = packMitFrame(0, 0, 0, 5, 0, DM4310);
    const kdU = (buf[5]! << 4) | ((buf[6]! >> 4) & 0x0F);
    expect(kdU).toBe(4095);
  });

  it('torque 0 → torq_u is 2047 (midpoint)', () => {
    const buf   = packMitFrame(0, 0, 0, 0, 0, DM4310);
    const torqU = ((buf[6]! & 0x0F) << 8) | buf[7]!;
    expect(torqU).toBe(Math.round(0.5 * 4095));
  });

  it('torque = T_MAX → torq_u is 4095', () => {
    const buf   = packMitFrame(0, 0, 0, 0, DM4310.T_MAX, DM4310);
    const torqU = ((buf[6]! & 0x0F) << 8) | buf[7]!;
    expect(torqU).toBe(4095);
  });

  it('torque = -T_MAX → torq_u is 0', () => {
    const buf   = packMitFrame(0, 0, 0, 0, -DM4310.T_MAX, DM4310);
    const torqU = ((buf[6]! & 0x0F) << 8) | buf[7]!;
    expect(torqU).toBe(0);
  });

  it('clamps position exceeding P_MAX', () => {
    const saturated = packMitFrame(DM4310.P_MAX, 0, 0, 0, 0, DM4310);
    const over      = packMitFrame(DM4310.P_MAX * 10, 0, 0, 0, 0, DM4310);
    expect(over[0]).toBe(saturated[0]);
    expect(over[1]).toBe(saturated[1]);
  });

  it('clamps velocity exceeding V_MAX', () => {
    const saturated = packMitFrame(0, DM4310.V_MAX, 0, 0, 0, DM4310);
    const over      = packMitFrame(0, DM4310.V_MAX * 10, 0, 0, 0, DM4310);
    const velUSat   = (saturated[2]! << 4) | ((saturated[3]! >> 4) & 0x0F);
    const velUOver  = (over[2]! << 4) | ((over[3]! >> 4) & 0x0F);
    expect(velUOver).toBe(velUSat);
  });

  it('produces byte-stable output for documented example values', () => {
    // pos=3.14 rad, vel=1 rad/s, kp=100, kd=1, torque=2 Nm
    const buf = packMitFrame(3.14, 1, 100, 1, 2, DM4310);
    // Verify all bytes present (smoke test; exact values derive from formula)
    expect(buf.every((b) => b >= 0 && b <= 255)).toBe(true);
    // Verify we can round-trip the position back within quantisation tolerance
    const posU = (buf[0]! << 8) | buf[1]!;
    const pos  = uintToFloat(posU, -12.5, 12.5, 16);
    expect(pos).toBeCloseTo(3.14, 1);
  });
});

// ── Enable / Disable / SetZero frames ────────────────────────────────────────

describe('enable/disable/setZeroPosition frames', () => {
  let mock: MockCanBus;
  let driver: DamiaoCanDriver;

  beforeEach(async () => {
    mock   = new MockCanBus();
    driver = new DamiaoCanDriver({ motorId: 1, model: 'DM4310', mockBus: mock });
    await driver.init();
  });

  it('enable() sends [0xFF×7, 0xFC] to motorId', () => {
    driver.enable();
    expect(mock.sent).toHaveLength(1);
    const { id, data } = mock.sent[0]!;
    expect(id).toBe(1);
    expect([...data]).toEqual([0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF, 0xFC]);
  });

  it('disable() sends [0xFF×7, 0xFD] to motorId', () => {
    driver.disable();
    const { id, data } = mock.sent[0]!;
    expect(id).toBe(1);
    expect([...data]).toEqual([0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF, 0xFD]);
  });

  it('setZeroPosition() sends [0xFF×7, 0xFE] to motorId', () => {
    driver.setZeroPosition();
    const { id, data } = mock.sent[0]!;
    expect(id).toBe(1);
    expect([...data]).toEqual([0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF, 0xFE]);
  });
});

// ── parseFeedbackFrame ────────────────────────────────────────────────────────

describe('parseFeedbackFrame', () => {
  /**
   * Build a synthetic feedback frame from known logical values so tests
   * verify the *inverse* of packMitFrame's encoding.
   */
  function buildFeedback(
    motorId: number, status: number,
    pos: number, vel: number, torque: number,
    tempMos: number, tempRotor: number,
    limits: DmMotorLimits,
  ): Buffer {
    const posU  = floatToUint(pos,    -limits.P_MAX, limits.P_MAX, 16);
    const velU  = floatToUint(vel,    -limits.V_MAX, limits.V_MAX, 12);
    const torqU = floatToUint(torque, -limits.T_MAX, limits.T_MAX, 12);

    const buf = Buffer.alloc(8);
    buf[0] = ((status & 0x0F) << 4) | (motorId & 0x0F);
    buf[1] = (posU >> 8) & 0xFF;
    buf[2] =  posU       & 0xFF;
    buf[3] = (velU >> 4) & 0xFF;
    buf[4] = ((velU & 0x0F) << 4) | ((torqU >> 8) & 0x0F);
    buf[5] =  torqU      & 0xFF;
    buf[6] = tempMos;
    buf[7] = tempRotor;
    return buf;
  }

  it('decodes motorId and status correctly', () => {
    const buf = buildFeedback(3, 2, 0, 0, 0, 40, 35, DM4310);
    const fb  = parseFeedbackFrame(buf, DM4310);
    expect(fb.motorId).toBe(3);
    expect(fb.status).toBe(2);
  });

  it('decodes position round-trip within quantisation tolerance', () => {
    const pos = 5.5;
    const buf = buildFeedback(1, 0, pos, 0, 0, 0, 0, DM4310);
    const fb  = parseFeedbackFrame(buf, DM4310);
    expect(fb.position).toBeCloseTo(pos, 2);
  });

  it('decodes velocity round-trip within quantisation tolerance', () => {
    const vel = -15;
    const buf = buildFeedback(1, 0, 0, vel, 0, 0, 0, DM4310);
    const fb  = parseFeedbackFrame(buf, DM4310);
    expect(fb.velocity).toBeCloseTo(vel, 1);
  });

  it('decodes torque round-trip within quantisation tolerance', () => {
    const tau = 4.0;
    const buf = buildFeedback(1, 0, 0, 0, tau, 0, 0, DM4310);
    const fb  = parseFeedbackFrame(buf, DM4310);
    expect(fb.torque).toBeCloseTo(tau, 1);
  });

  it('decodes temperature fields', () => {
    const buf = buildFeedback(1, 0, 0, 0, 0, 55, 70, DM4310);
    const fb  = parseFeedbackFrame(buf, DM4310);
    expect(fb.tempMos).toBe(55);
    expect(fb.tempRotor).toBe(70);
  });

  it('throws RangeError for buffers shorter than 8 bytes', () => {
    expect(() => parseFeedbackFrame(Buffer.alloc(7), DM4310))
      .toThrow(RangeError);
  });
});

// ── DamiaoCanDriver — setMotorPosition ───────────────────────────────────────

describe('DamiaoCanDriver.setMotorPosition', () => {
  let mock: MockCanBus;
  let driver: DamiaoCanDriver;

  beforeEach(async () => {
    mock   = new MockCanBus();
    driver = new DamiaoCanDriver({ motorId: 2, model: 'DM4310', mockBus: mock });
    await driver.init();
  });

  it('sends exactly one 8-byte frame to motorId', () => {
    driver.setMotorPosition(1, 0, 50, 0.5, 0);
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0]!.id).toBe(2);
    expect(mock.sent[0]!.data.length).toBe(8);
  });

  it('throws if called before init()', () => {
    const d = new DamiaoCanDriver({ motorId: 1, model: 'DM4310', mockBus: mock });
    expect(() => d.setMotorPosition(0, 0, 0, 0, 0)).toThrow('init()');
  });
});

// ── DamiaoCanDriver — feedback loop via MockCanBus ────────────────────────────

describe('DamiaoCanDriver feedback via MockCanBus', () => {
  it('updates latestFeedback when a feedback frame arrives on masterId', async () => {
    const mock   = new MockCanBus();
    const driver = new DamiaoCanDriver({
      motorId: 1,
      masterId: 0x11,
      model: 'DM4310',
      mockBus: mock,
    });
    await driver.init();

    // Synthesise a feedback frame: motorId=1, pos≈3 rad, vel≈5 rad/s, torq≈1 Nm
    const posU  = floatToUint(3,  -12.5, 12.5, 16);
    const velU  = floatToUint(5,  -30,   30,   12);
    const torqU = floatToUint(1,  -10,   10,   12);
    const fb    = Buffer.alloc(8);
    fb[0] = (0 << 4) | 1;           // status=0, motorId=1
    fb[1] = (posU >> 8) & 0xFF;
    fb[2] =  posU       & 0xFF;
    fb[3] = (velU >> 4) & 0xFF;
    fb[4] = ((velU & 0x0F) << 4) | ((torqU >> 8) & 0x0F);
    fb[5] =  torqU      & 0xFF;
    fb[6] = 45;  // tempMos
    fb[7] = 60;  // tempRotor

    mock.simulateReceive(0x11, fb);

    expect(driver.latestFeedback).not.toBeNull();
    expect(driver.latestFeedback!.position).toBeCloseTo(3, 2);
    expect(driver.latestFeedback!.velocity).toBeCloseTo(5, 1);
    expect(driver.latestFeedback!.torque).toBeCloseTo(1, 1);
    expect(driver.latestFeedback!.tempMos).toBe(45);
  });

  it('ignores frames with wrong CAN ID', async () => {
    const mock   = new MockCanBus();
    const driver = new DamiaoCanDriver({ motorId: 1, masterId: 0x11, model: 'DM4310', mockBus: mock });
    await driver.init();

    mock.simulateReceive(0x99, Buffer.alloc(8)); // wrong ID — should be ignored
    expect(driver.latestFeedback).toBeNull();
  });
});

// ── DamiaoCanDriver — model validation ───────────────────────────────────────

describe('DamiaoCanDriver model validation', () => {
  it('throws for unknown model string', () => {
    expect(() => new DamiaoCanDriver({ motorId: 1, model: 'UNKNOWN_MODEL' }))
      .toThrow('unknown model');
  });

  it('accepts a custom DmMotorLimits object', () => {
    const customLimits = { P_MAX: 6.28, V_MAX: 20, T_MAX: 15 };
    expect(() => new DamiaoCanDriver({ motorId: 1, model: customLimits }))
      .not.toThrow();
  });
});

// ── DM_MOTOR_LIMITS catalogue ─────────────────────────────────────────────────

describe('DM_MOTOR_LIMITS', () => {
  const knownModels = ['DM4310', 'DM4310_48V', 'DM4340', 'DM6006', 'DM8006', 'DM8009', 'DM10010L', 'DM10010'];

  for (const model of knownModels) {
    it(`${model} has positive finite limits`, () => {
      const lim = DM_MOTOR_LIMITS[model]!;
      expect(lim.P_MAX).toBeGreaterThan(0);
      expect(lim.V_MAX).toBeGreaterThan(0);
      expect(lim.T_MAX).toBeGreaterThan(0);
      expect(Number.isFinite(lim.P_MAX)).toBe(true);
      expect(Number.isFinite(lim.V_MAX)).toBe(true);
      expect(Number.isFinite(lim.T_MAX)).toBe(true);
    });
  }
});

// ── MockCanBus ────────────────────────────────────────────────────────────────

describe('MockCanBus', () => {
  it('records sent frames', () => {
    const bus = new MockCanBus();
    bus.send(0x01, Buffer.from([1, 2, 3]));
    bus.send(0x02, Buffer.from([4, 5, 6]));
    expect(bus.sent).toHaveLength(2);
    expect(bus.sent[0]!.id).toBe(0x01);
    expect([...bus.sent[1]!.data]).toEqual([4, 5, 6]);
  });

  it('flush() clears the sent log', () => {
    const bus = new MockCanBus();
    bus.send(1, Buffer.alloc(8));
    bus.flush();
    expect(bus.sent).toHaveLength(0);
  });

  it('simulateReceive fires registered listeners', () => {
    const bus      = new MockCanBus();
    const received: Array<{ id: number; data: Buffer }> = [];
    bus.on('message', (id, data) => received.push({ id, data }));
    bus.simulateReceive(0x42, Buffer.from([0xAB, 0xCD]));
    expect(received).toHaveLength(1);
    expect(received[0]!.id).toBe(0x42);
    expect([...received[0]!.data]).toEqual([0xAB, 0xCD]);
  });
});

// ── sim mode ──────────────────────────────────────────────────────────────────

describe('DamiaoCanDriver sim mode (NODE_ENV=sim)', () => {
  it('uses MockCanBus automatically without hardware', async () => {
    const orig = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'sim';
    try {
      const d = new DamiaoCanDriver({ motorId: 1, model: 'DM4310' });
      await d.init();
      expect(() => d.enable()).not.toThrow();
      expect(() => d.setMotorPosition(0, 0, 50, 1, 0)).not.toThrow();
      d.close();
    } finally {
      process.env['NODE_ENV'] = orig;
    }
  });
});
