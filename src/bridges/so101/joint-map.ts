/**
 * SO-101 joint → Feetech STS3215 servo mapping.
 *
 * Servo IDs match the standard LeRobot SO-101 calibration order.
 * Angle limits are derived from the so101_real.urdf fixture's <limit> tags
 * (lower/upper in radians) and converted to STS3215 raw ticks (0–4095,
 * midpoint 2048 ≙ 0 rad).
 *
 * The STS3215 has 4096 steps over ~360° (≈11.377 ticks/degree,
 * 651.7 ticks/radian).  The midpoint 2048 corresponds to the neutral
 * (zeroed) URDF position for each joint.
 *
 * Gripper is normalised 0→1 (open→closed) and maps to its own tick range.
 */

// ── STS3215 constants ─────────────────────────────────────────────────────────

/** Full tick range of STS3215 (12-bit). */
export const STS3215_MAX_TICKS = 4095;
export const STS3215_MID_TICKS = 2048;
/** ticks per radian (4096 / (2π) ≈ 651.9) */
export const TICKS_PER_RAD = 4096 / (2 * Math.PI);

// ── Joint definitions ─────────────────────────────────────────────────────────

export interface JointDef {
  /** Human-readable joint name matching the URDF joint name. */
  name: string;
  /** Feetech bus servo ID (1-indexed, per LeRobot SO-101 calibration). */
  servoId: number;
  /** URDF lower limit in radians (or 0 for normalised joints). */
  lowerRad: number;
  /** URDF upper limit in radians (or 1 for normalised joints). */
  upperRad: number;
  /** Whether angle is passed as a 0–1 normalised fraction instead of radians. */
  normalised?: boolean;
}

/**
 * The 6 joints of the SO-101 follower arm in servo-ID order.
 *
 * Limits sourced from so101_real.urdf <limit lower=... upper=...> tags.
 * The values below are conservative physical limits; the URDF fixture is
 * the authoritative source and should win if they diverge.
 */
export const SO101_JOINTS: readonly JointDef[] = [
  { name: 'shoulder_pan',  servoId: 1, lowerRad: -Math.PI,     upperRad: Math.PI },
  { name: 'shoulder_lift', servoId: 2, lowerRad: -Math.PI / 2, upperRad: Math.PI / 2 },
  { name: 'elbow_flex',    servoId: 3, lowerRad: -Math.PI,     upperRad: Math.PI },
  { name: 'wrist_flex',    servoId: 4, lowerRad: -Math.PI / 2, upperRad: Math.PI / 2 },
  { name: 'wrist_roll',    servoId: 5, lowerRad: -Math.PI,     upperRad: Math.PI },
  { name: 'gripper',       servoId: 6, lowerRad: 0,            upperRad: 1, normalised: true },
] as const;

/** Fast lookup: joint name → JointDef. Built once at module load time. */
export const JOINT_BY_NAME: ReadonlyMap<string, JointDef> = new Map(
  SO101_JOINTS.map((j) => [j.name, j]),
);

/** Fast lookup: servo ID → JointDef. */
export const JOINT_BY_SERVO_ID: ReadonlyMap<number, JointDef> = new Map(
  SO101_JOINTS.map((j) => [j.servoId, j]),
);

// ── Conversion helpers ────────────────────────────────────────────────────────

/**
 * Convert a radian angle (or 0–1 normalised fraction for gripper) to
 * STS3215 raw ticks, clamped to the joint's physical limits.
 *
 * - For radian joints: 0 rad → 2048 ticks; range is ±π → [0, 4095].
 * - For normalised (gripper): 0.0 → lowerTicks, 1.0 → upperTicks.
 *   We map gripper 0 (open) → 2048 and 1 (closed) → 3072 (a 1024-tick range
 *   that keeps the servo well within its mechanical limits).
 */
export function angleToTicks(joint: JointDef, value: number): number {
  if (joint.normalised) {
    // Gripper: 0 = open (2048), 1 = closed (3072).
    const GRIPPER_OPEN   = STS3215_MID_TICKS;
    const GRIPPER_CLOSED = 3072;
    const clamped = Math.max(0, Math.min(1, value));
    return Math.round(GRIPPER_OPEN + clamped * (GRIPPER_CLOSED - GRIPPER_OPEN));
  }
  // Radian joint: clamp to [lower, upper], then scale to ticks.
  const clamped = Math.max(joint.lowerRad, Math.min(joint.upperRad, value));
  return Math.round(STS3215_MID_TICKS + clamped * TICKS_PER_RAD);
}

/**
 * Convert STS3215 raw ticks back to radians (or normalised fraction).
 * Useful for reading servo positions and reporting them to the gateway.
 */
export function ticksToAngle(joint: JointDef, ticks: number): number {
  if (joint.normalised) {
    const GRIPPER_OPEN   = STS3215_MID_TICKS;
    const GRIPPER_CLOSED = 3072;
    return (ticks - GRIPPER_OPEN) / (GRIPPER_CLOSED - GRIPPER_OPEN);
  }
  return (ticks - STS3215_MID_TICKS) / TICKS_PER_RAD;
}
