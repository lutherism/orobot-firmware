/**
 * Generic configurable arm servo map for PCA9685-based multi-servo arms.
 *
 * Maps logical joint names → PCA9685 channels with per-joint angle limits.
 * The design is intentionally data-driven so the same bridge can serve any
 * PWM-wired arm (InMoov, custom 6-DOF arms, hand rigs, etc.) by swapping
 * the config — no code changes needed.
 *
 * Angle unit: degrees (matching the PCA9685 driver's `setServoAngle` interface).
 * Range supported by standard hobby servos: −90° to +90°.
 *
 * Example config (InMoov right arm, 6 DOF):
 *
 *   const INMOOV_RIGHT_ARM: ArmServoConfig = {
 *     joints: [
 *       { name: 'shoulder_rotate', channel: 0, minDeg: -90, maxDeg: 90 },
 *       { name: 'shoulder_flex',   channel: 1, minDeg: -60, maxDeg: 60 },
 *       { name: 'elbow',           channel: 2, minDeg: -90, maxDeg: 0  },
 *       { name: 'wrist_rotate',    channel: 3, minDeg: -90, maxDeg: 90 },
 *       { name: 'wrist_flex',      channel: 4, minDeg: -45, maxDeg: 45 },
 *       { name: 'thumb',           channel: 5, minDeg:   0, maxDeg: 90 },
 *     ],
 *   };
 */

// ── Joint definition ──────────────────────────────────────────────────────────

export interface ArmJointDef {
  /** Logical joint name matching the URDF joint name / orobot JointDriveControl key. */
  name: string;
  /** PCA9685 channel (0–15). */
  channel: number;
  /** Minimum allowed angle in degrees (inclusive). Must be ≥ −90. */
  minDeg: number;
  /** Maximum allowed angle in degrees (inclusive). Must be ≤ +90. */
  maxDeg: number;
}

export interface ArmServoConfig {
  /** Ordered list of joint definitions. Names must be unique within a config. */
  joints: readonly ArmJointDef[];
}

// ── Built-in reference configs ────────────────────────────────────────────────

/**
 * Generic 6-DOF arm reference config.
 *
 * Channel assignments follow a simple linear layout (0–5); physical wiring
 * should match this order.  Override minDeg/maxDeg per robot's URDF limits.
 *
 * Suitable as a starting point for InMoov, custom arms, or any 6-DOF PWM arm.
 */
export const GENERIC_ARM_6DOF: ArmServoConfig = {
  joints: [
    { name: 'shoulder_pan',  channel: 0, minDeg: -90, maxDeg:  90 },
    { name: 'shoulder_lift', channel: 1, minDeg: -60, maxDeg:  60 },
    { name: 'elbow_flex',    channel: 2, minDeg: -90, maxDeg:   0 },
    { name: 'wrist_flex',    channel: 3, minDeg: -45, maxDeg:  45 },
    { name: 'wrist_roll',    channel: 4, minDeg: -90, maxDeg:  90 },
    { name: 'gripper',       channel: 5, minDeg:   0, maxDeg:  90 },
  ],
} as const;

// ── Resolved map ──────────────────────────────────────────────────────────────

/**
 * Compiled arm servo map — built once from an `ArmServoConfig` for O(1) lookups.
 *
 * Validates channel range [0–15] and angle limit ordering on construction.
 * Throws if any joint definition is invalid (fail-fast at startup, not at runtime).
 */
export class ArmServoMap {
  private readonly byName: Map<string, ArmJointDef>;

  constructor(config: ArmServoConfig) {
    this.byName = new Map();

    for (const joint of config.joints) {
      if (joint.channel < 0 || joint.channel > 15) {
        throw new RangeError(
          `ArmServoMap: joint "${joint.name}" has invalid channel ${joint.channel} (must be 0–15)`,
        );
      }
      if (joint.minDeg > joint.maxDeg) {
        throw new RangeError(
          `ArmServoMap: joint "${joint.name}" has minDeg (${joint.minDeg}) > maxDeg (${joint.maxDeg})`,
        );
      }
      if (this.byName.has(joint.name)) {
        throw new Error(`ArmServoMap: duplicate joint name "${joint.name}"`);
      }
      this.byName.set(joint.name, joint);
    }
  }

  /**
   * Resolves a joint name to its PCA9685 channel.
   *
   * @returns The channel index, or `null` if the joint name is not in this map.
   */
  resolveChannel(name: string): number | null {
    return this.byName.get(name)?.channel ?? null;
  }

  /**
   * Returns the joint definition for the given name, or `null` if unknown.
   */
  joint(name: string): ArmJointDef | null {
    return this.byName.get(name) ?? null;
  }

  /**
   * Clamps an angle (degrees) to the joint's [minDeg, maxDeg] limits.
   *
   * Returns the clamped value, or `null` if the joint name is unknown.
   */
  clampAngle(name: string, angleDeg: number): number | null {
    const def = this.byName.get(name);
    if (!def) return null;
    return Math.max(def.minDeg, Math.min(def.maxDeg, angleDeg));
  }

  /** All joint names registered in this map. */
  get jointNames(): ReadonlyArray<string> {
    return Array.from(this.byName.keys());
  }
}
