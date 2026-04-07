import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockGPIODriver } from './mock-driver';
import { StepperMotor } from './stepper-motor';
import { EventBus } from '../core/event-bus';

const RASPI_PINS = [17, 18, 22, 27] as const;

describe('StepperMotor', () => {
  let driver: MockGPIODriver;
  let bus: EventBus;
  let motor: StepperMotor;

  beforeEach(async () => {
    vi.useFakeTimers();
    driver = new MockGPIODriver();
    bus = new EventBus();
    motor = new StepperMotor(driver, [...RASPI_PINS], bus);
    await motor.initialize();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── initialization ────────────────────────────────────────────

  it('initialize() exports all 4 pins', () => {
    expect(driver.pins.size).toBe(4);
    for (const pin of RASPI_PINS) {
      expect(driver.pins.has(pin)).toBe(true);
    }
  });

  it('initialize() de-energizes all coils (sets to 0)', () => {
    for (const pin of driver.pins.values()) {
      expect(pin.value).toBe(0);
    }
  });

  it('currentAngle starts at 0', () => {
    expect(motor.currentAngle).toBe(0);
  });

  // ── gotoAngle ─────────────────────────────────────────────────

  it('gotoAngle() updates currentAngle', async () => {
    // 90° move: Math.floor(90 × 200/360) × 25 = 1250 ms
    const p = motor.gotoAngle(90);
    await vi.advanceTimersByTimeAsync(1300);
    await p;
    expect(motor.currentAngle).toBe(90);
  });

  it('gotoAngle() emits hardware:motor-moved with the new angle', async () => {
    const handler = vi.fn();
    bus.on('hardware:motor-moved', handler);
    const p = motor.gotoAngle(90);
    await vi.advanceTimersByTimeAsync(1300);
    await p;
    expect(handler).toHaveBeenCalledWith({ angle: 90 });
  });

  it('gotoAngle(0) when already at 0 emits motor-moved immediately without moving', async () => {
    const handler = vi.fn();
    bus.on('hardware:motor-moved', handler);
    const p = motor.gotoAngle(0);
    await vi.advanceTimersByTimeAsync(10);
    await p;
    expect(motor.currentAngle).toBe(0);
    expect(handler).toHaveBeenCalledWith({ angle: 0 });
  });

  it('gotoAngle() takes the shortest path — 270° target rotates -90° CW', async () => {
    // diff = 270, mod(270+180,360)−180 = mod(450,360)−180 = 90−180 = −90
    // → direction: 'cw', durationMs = Math.floor(90 × 200/360) × 25 = 1250 ms
    const p = motor.gotoAngle(270);
    await vi.advanceTimersByTimeAsync(1300);
    await p;
    expect(motor.currentAngle).toBe(270);
  });

  // ── stop ──────────────────────────────────────────────────────

  it('stop() de-energizes all coils', async () => {
    const p = motor.stop();
    await vi.advanceTimersByTimeAsync(10);
    await p;
    for (const pin of driver.pins.values()) {
      expect(pin.value).toBe(0);
    }
  });

  // ── queue serialization ───────────────────────────────────────

  it('serializes concurrent gotoAngle calls — both complete in order', async () => {
    const results: number[] = [];
    bus.on('hardware:motor-moved', (p) => results.push(p.angle));

    // Both calls go into the queue immediately — p2 starts only after p1 finishes
    const p1 = motor.gotoAngle(90);   // 1250 ms
    const p2 = motor.gotoAngle(180);  // from 90, diff = 90 → another 1250 ms
    await vi.advanceTimersByTimeAsync(3000); // more than 1250 + 1250
    await Promise.all([p1, p2]);

    expect(results).toEqual([90, 180]);
    expect(motor.currentAngle).toBe(180);
  });

  // ── angle constraints ─────────────────────────────────────────

  it('gotoAngle respects maxAngle constraint', async () => {
    motor.setConstraints(-90, 90);
    const p = motor.gotoAngle(200);
    await vi.advanceTimersByTimeAsync(1300);
    await p;
    expect(motor.currentAngle).toBe(90);
  });

  it('gotoAngle respects minAngle constraint', async () => {
    motor.setConstraints(-90, 90);
    const p = motor.gotoAngle(-200);
    await vi.advanceTimersByTimeAsync(1300);
    await p;
    expect(motor.currentAngle).toBe(-90);
  });

  it('gotoAngle passes through when within constraints', async () => {
    motor.setConstraints(-90, 90);
    const p = motor.gotoAngle(45);
    await vi.advanceTimersByTimeAsync(1300);
    await p;
    expect(motor.currentAngle).toBe(45);
  });

  it('gotoAngle is unconstrained by default', async () => {
    const p = motor.gotoAngle(300);
    await vi.advanceTimersByTimeAsync(1300);
    await p;
    expect(motor.currentAngle).toBe(300);
  });
});
