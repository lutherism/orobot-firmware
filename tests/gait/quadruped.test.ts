/**
 * Tests for the quadruped gait sequencer (GaitStateMachine).
 *
 * All I²C interaction uses MockI2CBus so no hardware is required. The step
 * loop is exercised by advancing fake timers — drivers are initialised before
 * fake timers are installed to avoid blocking setImmediate inside pca9685.init().
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { GaitStateMachine } from '../../src/gait/quadruped';
import { PCA9685Driver, MockI2CBus } from '../../src/drivers/pca9685';
import { SERVO_MAP } from '../../src/drivers/spotmicro-servo-map';

// ── Shared driver (real async init must complete before fake timers) ───────────

let sharedDriver: PCA9685Driver;

beforeAll(async () => {
  sharedDriver = new PCA9685Driver({ mockBus: new MockI2CBus() });
  await sharedDriver.init();
});

/** Creates a fresh GaitStateMachine backed by the shared (already-inited) driver. */
function makeGait(stepRateHz = 10): { gait: GaitStateMachine; spy: ReturnType<typeof vi.spyOn> } {
  // Re-use sharedDriver — the mock bus accumulates all writes, spies track calls.
  const spy  = vi.spyOn(sharedDriver, 'setServoAngle');
  const gait = new GaitStateMachine(sharedDriver, { stepRateHz });
  return { gait, spy };
}

// ── Stand ─────────────────────────────────────────────────────────────────────

describe('GaitStateMachine — stand command', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('transitions to standing state', () => {
    const { gait } = makeGait();
    gait.command('stand');
    expect(gait.currentState).toBe('standing');
  });

  it('drives all 12 servo channels', () => {
    const { gait, spy } = makeGait();
    gait.command('stand');
    const calledChannels = spy.mock.calls.map(([ch]) => ch).sort((a, b) => a - b);
    const expected = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];
    expect(calledChannels).toEqual(expected);
  });

  it('sets frontLeft hip (ch 0) to 0°', () => {
    const { gait, spy } = makeGait();
    gait.command('stand');
    const hipCall = spy.mock.calls.find(([ch]) => ch === SERVO_MAP.frontLeft.hip);
    expect(hipCall).toBeDefined();
    expect(hipCall?.[1]).toBe(0);
  });

  it('sets rearRight calf (ch 14) to -90°', () => {
    const { gait, spy } = makeGait();
    gait.command('stand');
    const calfCall = spy.mock.calls.find(([ch]) => ch === SERVO_MAP.rearRight.calf);
    expect(calfCall).toBeDefined();
    expect(calfCall?.[1]).toBe(-90);
  });
});

// ── Sit ───────────────────────────────────────────────────────────────────────

describe('GaitStateMachine — sit command', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('transitions to sitting state', () => {
    const { gait } = makeGait();
    gait.command('sit');
    expect(gait.currentState).toBe('sitting');
  });

  it('lowers rear thigh below stand angle (45°)', () => {
    const { gait, spy } = makeGait();
    gait.command('sit');

    const rearLeftThighCh  = SERVO_MAP.rearLeft.thigh;
    const rearRightThighCh = SERVO_MAP.rearRight.thigh;

    const rlCall = spy.mock.calls.find(([ch]) => ch === rearLeftThighCh);
    const rrCall = spy.mock.calls.find(([ch]) => ch === rearRightThighCh);

    expect(rlCall?.[1]).toBeLessThan(45);
    expect(rrCall?.[1]).toBeLessThan(45);
  });

  it('keeps front legs at stand angles', () => {
    const { gait, spy } = makeGait();
    gait.command('sit');

    const flThighCh = SERVO_MAP.frontLeft.thigh;
    const frThighCh = SERVO_MAP.frontRight.thigh;

    const flCall = spy.mock.calls.find(([ch]) => ch === flThighCh);
    const frCall = spy.mock.calls.find(([ch]) => ch === frThighCh);

    expect(flCall?.[1]).toBe(45);
    expect(frCall?.[1]).toBe(45);
  });
});

// ── Walk: forward ─────────────────────────────────────────────────────────────

describe('GaitStateMachine — walk:forward', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('transitions to walking state', () => {
    const { gait } = makeGait();
    gait.command('walk:forward');
    expect(gait.currentState).toBe('walking');
  });

  it('drives servos after one step interval', () => {
    const { gait, spy } = makeGait(10);
    gait.command('walk:forward');
    spy.mockClear();

    vi.advanceTimersByTime(100); // one step at 10 Hz
    expect(spy).toHaveBeenCalled();
  });

  it('drives servos across multiple step intervals (full walk cycle)', () => {
    const { gait, spy } = makeGait(10);
    gait.command('walk:forward');
    spy.mockClear();

    vi.advanceTimersByTime(400); // 4 steps
    expect(spy.mock.calls.length).toBeGreaterThan(0);
  });

  it('forward hip angles are positive for swing leg', () => {
    const { gait, spy } = makeGait(10);
    gait.command('walk:forward');
    spy.mockClear();

    vi.advanceTimersByTime(100); // first keyframe: FL+RR swing
    const hipChannels = [
      SERVO_MAP.frontLeft.hip,
      SERVO_MAP.frontRight.hip,
      SERVO_MAP.rearLeft.hip,
      SERVO_MAP.rearRight.hip,
    ];
    const hipCalls = spy.mock.calls.filter(([ch]) => hipChannels.includes(ch));
    const hasPositiveHip = hipCalls.some(([, angle]) => (angle as number) > 0);
    expect(hasPositiveHip).toBe(true);
  });

  it('stops cleanly — no more servo calls after stop', () => {
    const { gait, spy } = makeGait(10);
    gait.command('walk:forward');
    vi.advanceTimersByTime(200);
    gait.command('stop');
    spy.mockClear();

    vi.advanceTimersByTime(500);
    expect(spy).not.toHaveBeenCalled();
    expect(gait.currentState).toBe('idle');
  });
});

// ── Walk: backward ────────────────────────────────────────────────────────────

describe('GaitStateMachine — walk:backward', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('transitions to walking state', () => {
    const { gait } = makeGait();
    gait.command('walk:backward');
    expect(gait.currentState).toBe('walking');
  });

  it('backward hip angles are negative for swing leg', () => {
    const { gait, spy } = makeGait(10);
    gait.command('walk:backward');
    spy.mockClear();

    vi.advanceTimersByTime(100); // first keyframe: FL+RR swing backward
    const hipChannels = [
      SERVO_MAP.frontLeft.hip,
      SERVO_MAP.frontRight.hip,
      SERVO_MAP.rearLeft.hip,
      SERVO_MAP.rearRight.hip,
    ];
    const hipCalls = spy.mock.calls.filter(([ch]) => hipChannels.includes(ch));
    const hasNegativeHip = hipCalls.some(([, angle]) => (angle as number) < 0);
    expect(hasNegativeHip).toBe(true);
  });
});

// ── Turn cycle ────────────────────────────────────────────────────────────────

describe('GaitStateMachine — turn:left / turn:right', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('turn:left → transitions to turning state', () => {
    const { gait } = makeGait();
    gait.command('turn:left');
    expect(gait.currentState).toBe('turning');
  });

  it('turn:right → transitions to turning state', () => {
    const { gait } = makeGait();
    gait.command('turn:right');
    expect(gait.currentState).toBe('turning');
  });

  it('drives servos on each step interval during turn', () => {
    const { gait, spy } = makeGait(10);
    gait.command('turn:left');
    spy.mockClear();

    vi.advanceTimersByTime(200); // 2 steps — full turn cycle
    expect(spy.mock.calls.length).toBeGreaterThan(0);
  });

  it('stops cleanly from turning state', () => {
    const { gait, spy } = makeGait(10);
    gait.command('turn:right');
    vi.advanceTimersByTime(100);
    gait.command('stop');
    spy.mockClear();

    vi.advanceTimersByTime(500);
    expect(spy).not.toHaveBeenCalled();
    expect(gait.currentState).toBe('idle');
  });
});

// ── State transitions ──────────────────────────────────────────────────────────

describe('GaitStateMachine — state transitions', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('stand → walk:forward — tears down previous state, starts walking', () => {
    const { gait, spy } = makeGait(10);
    gait.command('stand');
    spy.mockClear();

    gait.command('walk:forward');
    expect(gait.currentState).toBe('walking');
    vi.advanceTimersByTime(100);
    expect(spy).toHaveBeenCalled();
  });

  it('walk:forward → sit — tears down loop, applies sit pose', () => {
    const { gait, spy } = makeGait(10);
    gait.command('walk:forward');
    vi.advanceTimersByTime(200);
    spy.mockClear();

    gait.command('sit');
    expect(gait.currentState).toBe('sitting');
    // Record how many calls were made synchronously for the sit pose
    const callsAfterSit = spy.mock.calls.length;
    // Advance further — loop must be stopped, no new calls
    vi.advanceTimersByTime(500);
    expect(spy.mock.calls.length).toBe(callsAfterSit);
  });

  it('stop from idle is a no-op', () => {
    const { gait } = makeGait();
    expect(() => gait.command('stop')).not.toThrow();
    expect(gait.currentState).toBe('idle');
  });

  it('initial state is idle', () => {
    const { gait } = makeGait();
    expect(gait.currentState).toBe('idle');
  });
});

// ── IMU stub ──────────────────────────────────────────────────────────────────

describe('GaitStateMachine — IMU stub', () => {
  it('accepts an IMU option and does not crash', () => {
    const imu = { getOrientation: () => ({ roll: 0, pitch: 0, yaw: 0 }) };
    const gait = new GaitStateMachine(sharedDriver, { imu });
    expect(() => gait.command('stand')).not.toThrow();
  });

  it('works normally if IMU getOrientation returns null', () => {
    const imu = { getOrientation: () => null };
    const gait = new GaitStateMachine(sharedDriver, { imu });
    expect(() => gait.command('stand')).not.toThrow();
  });
});
