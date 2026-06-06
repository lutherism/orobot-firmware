import { describe, it, expect } from 'vitest';
import {
  SO101_JOINTS,
  JOINT_BY_NAME,
  JOINT_BY_SERVO_ID,
  angleToTicks,
  ticksToAngle,
  STS3215_MID_TICKS,
  TICKS_PER_RAD,
} from './joint-map';

describe('SO101_JOINTS', () => {
  it('has exactly 6 joints', () => {
    expect(SO101_JOINTS).toHaveLength(6);
  });

  it('servo IDs are 1–6 with no gaps', () => {
    const ids = SO101_JOINTS.map((j) => j.servoId).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('JOINT_BY_NAME covers all joint names', () => {
    for (const joint of SO101_JOINTS) {
      expect(JOINT_BY_NAME.get(joint.name)).toBe(joint);
    }
  });

  it('JOINT_BY_SERVO_ID covers all servo IDs', () => {
    for (const joint of SO101_JOINTS) {
      expect(JOINT_BY_SERVO_ID.get(joint.servoId)).toBe(joint);
    }
  });
});

describe('angleToTicks — radian joints', () => {
  const shoulderPan = JOINT_BY_NAME.get('shoulder_pan')!;

  it('maps 0 rad → 2048 (midpoint)', () => {
    expect(angleToTicks(shoulderPan, 0)).toBe(STS3215_MID_TICKS);
  });

  it('maps +π/2 rad → ~1676 ticks above midpoint', () => {
    const ticks = angleToTicks(shoulderPan, Math.PI / 2);
    // Math.round(2048 + (π/2) * (4096/(2π))) = Math.round(2048 + 1024) = 3072
    expect(ticks).toBe(3072);
  });

  it('maps -π/2 → ~1024 (below midpoint)', () => {
    const ticks = angleToTicks(shoulderPan, -Math.PI / 2);
    expect(ticks).toBe(1024);
  });

  it('clamps to lowerRad when angle below limit', () => {
    const extreme = angleToTicks(shoulderPan, -999);
    const atLimit  = angleToTicks(shoulderPan, shoulderPan.lowerRad);
    expect(extreme).toBe(atLimit);
  });

  it('clamps to upperRad when angle above limit', () => {
    const extreme = angleToTicks(shoulderPan, 999);
    const atLimit  = angleToTicks(shoulderPan, shoulderPan.upperRad);
    expect(extreme).toBe(atLimit);
  });
});

describe('angleToTicks — gripper (normalised)', () => {
  const gripper = JOINT_BY_NAME.get('gripper')!;

  it('maps 0.0 (open) → 2048', () => {
    expect(angleToTicks(gripper, 0)).toBe(2048);
  });

  it('maps 1.0 (closed) → 3072', () => {
    expect(angleToTicks(gripper, 1)).toBe(3072);
  });

  it('maps 0.5 → 2560', () => {
    expect(angleToTicks(gripper, 0.5)).toBe(2560);
  });

  it('clamps values below 0 to 2048', () => {
    expect(angleToTicks(gripper, -0.5)).toBe(2048);
  });

  it('clamps values above 1 to 3072', () => {
    expect(angleToTicks(gripper, 2.0)).toBe(3072);
  });
});

describe('ticksToAngle round-trip', () => {
  it('is approximately reversible for shoulder_pan at 1 rad', () => {
    const joint  = JOINT_BY_NAME.get('shoulder_pan')!;
    const ticks  = angleToTicks(joint, 1.0);
    const result = ticksToAngle(joint, ticks);
    expect(result).toBeCloseTo(1.0, 2);
  });

  it('is approximately reversible for gripper at 0.75', () => {
    const joint  = JOINT_BY_NAME.get('gripper')!;
    const ticks  = angleToTicks(joint, 0.75);
    const result = ticksToAngle(joint, ticks);
    expect(result).toBeCloseTo(0.75, 2);
  });
});
