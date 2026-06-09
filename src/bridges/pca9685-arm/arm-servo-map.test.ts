/**
 * Unit tests for ArmServoMap — joint resolution, angle clamping, validation.
 */

import { describe, it, expect } from 'vitest';
import { ArmServoMap, GENERIC_ARM_6DOF, type ArmServoConfig } from './arm-servo-map';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal 3-joint config used for most tests. */
const THREE_JOINT_CONFIG: ArmServoConfig = {
  joints: [
    { name: 'shoulder', channel: 0, minDeg: -60, maxDeg:  60 },
    { name: 'elbow',    channel: 2, minDeg: -90, maxDeg:   0 },
    { name: 'gripper',  channel: 5, minDeg:   0, maxDeg:  90 },
  ],
};

// ── resolveChannel ────────────────────────────────────────────────────────────

describe('ArmServoMap.resolveChannel', () => {
  it('returns the correct channel for a known joint', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    expect(map.resolveChannel('shoulder')).toBe(0);
    expect(map.resolveChannel('elbow')).toBe(2);
    expect(map.resolveChannel('gripper')).toBe(5);
  });

  it('returns null for an unknown joint name', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    expect(map.resolveChannel('wrist')).toBeNull();
    expect(map.resolveChannel('')).toBeNull();
  });
});

// ── clampAngle ────────────────────────────────────────────────────────────────

describe('ArmServoMap.clampAngle', () => {
  it('passes through angles within limits unchanged', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    expect(map.clampAngle('shoulder', 0)).toBe(0);
    expect(map.clampAngle('shoulder', 30)).toBe(30);
    expect(map.clampAngle('shoulder', -30)).toBe(-30);
  });

  it('clamps to minDeg when angle is below the minimum', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    expect(map.clampAngle('shoulder', -90)).toBe(-60);
    expect(map.clampAngle('elbow', -120)).toBe(-90);
    expect(map.clampAngle('gripper', -10)).toBe(0);
  });

  it('clamps to maxDeg when angle is above the maximum', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    expect(map.clampAngle('shoulder', 90)).toBe(60);
    expect(map.clampAngle('elbow', 45)).toBe(0);
    expect(map.clampAngle('gripper', 180)).toBe(90);
  });

  it('clamps exactly to boundary values', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    expect(map.clampAngle('shoulder', -60)).toBe(-60);
    expect(map.clampAngle('shoulder',  60)).toBe(60);
  });

  it('returns null for unknown joint name', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    expect(map.clampAngle('unknown', 45)).toBeNull();
  });
});

// ── joint() lookup ────────────────────────────────────────────────────────────

describe('ArmServoMap.joint', () => {
  it('returns the joint definition for a known joint', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    const def = map.joint('shoulder');
    expect(def).not.toBeNull();
    expect(def!.channel).toBe(0);
    expect(def!.minDeg).toBe(-60);
    expect(def!.maxDeg).toBe(60);
  });

  it('returns null for unknown joints', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    expect(map.joint('nonexistent')).toBeNull();
  });
});

// ── jointNames ────────────────────────────────────────────────────────────────

describe('ArmServoMap.jointNames', () => {
  it('returns all joint names in insertion order', () => {
    const map = new ArmServoMap(THREE_JOINT_CONFIG);
    expect(map.jointNames).toEqual(['shoulder', 'elbow', 'gripper']);
  });
});

// ── construction validation ───────────────────────────────────────────────────

describe('ArmServoMap construction validation', () => {
  it('throws RangeError on channel < 0', () => {
    expect(() => new ArmServoMap({
      joints: [{ name: 'bad', channel: -1, minDeg: -90, maxDeg: 90 }],
    })).toThrow(RangeError);
  });

  it('throws RangeError on channel > 15', () => {
    expect(() => new ArmServoMap({
      joints: [{ name: 'bad', channel: 16, minDeg: -90, maxDeg: 90 }],
    })).toThrow(RangeError);
  });

  it('throws RangeError when minDeg > maxDeg', () => {
    expect(() => new ArmServoMap({
      joints: [{ name: 'bad', channel: 0, minDeg: 45, maxDeg: -45 }],
    })).toThrow(RangeError);
  });

  it('throws on duplicate joint names', () => {
    expect(() => new ArmServoMap({
      joints: [
        { name: 'dup', channel: 0, minDeg: -90, maxDeg: 90 },
        { name: 'dup', channel: 1, minDeg: -90, maxDeg: 90 },
      ],
    })).toThrow(/duplicate joint/i);
  });

  it('accepts a config where minDeg === maxDeg (zero-range joint)', () => {
    // Unusual but valid — a locked joint.
    const map = new ArmServoMap({
      joints: [{ name: 'locked', channel: 0, minDeg: 0, maxDeg: 0 }],
    });
    expect(map.clampAngle('locked', 30)).toBe(0);
  });
});

// ── GENERIC_ARM_6DOF built-in config ──────────────────────────────────────────

describe('GENERIC_ARM_6DOF reference config', () => {
  it('has 6 joints', () => {
    const map = new ArmServoMap(GENERIC_ARM_6DOF);
    expect(map.jointNames).toHaveLength(6);
  });

  it('all 6 joints have channels in [0, 15]', () => {
    for (const j of GENERIC_ARM_6DOF.joints) {
      expect(j.channel).toBeGreaterThanOrEqual(0);
      expect(j.channel).toBeLessThanOrEqual(15);
    }
  });

  it('all joint names resolve to non-null channels', () => {
    const map = new ArmServoMap(GENERIC_ARM_6DOF);
    for (const j of GENERIC_ARM_6DOF.joints) {
      expect(map.resolveChannel(j.name)).not.toBeNull();
    }
  });
});
