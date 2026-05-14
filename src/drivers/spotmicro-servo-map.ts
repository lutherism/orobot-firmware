/**
 * SpotMicro quadruped servo channel map.
 *
 * Channels 0–14 on a single PCA9685 (address 0x40).
 * Layout: 4 legs × 3 DOF (hip yaw, thigh/shoulder roll, calf/knee).
 *
 * Physical wiring matches the canonical SpotMicro community pinout:
 *   channels 0–2   → front-left  leg
 *   channels 4–6   → front-right leg
 *   channels 8–10  → rear-left   leg
 *   channels 12–14 → rear-right  leg
 *
 * Channels 3, 7, 11, 15 are intentionally left unused so that each leg's
 * connectors sit on a 4-channel aligned block — making physical wiring tidier
 * and enabling a second PCA9685 board to extend to 32 channels in future.
 */

export type LegName  = 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearRight';
export type JointName = 'hip' | 'thigh' | 'calf';

export interface LegChannels {
  /** Hip yaw / shoulder rotation. */
  hip:   number;
  /** Thigh / shoulder roll. */
  thigh: number;
  /** Calf / knee extension. */
  calf:  number;
}

/** Channel assignments for SpotMicro quadruped (4 legs × 3 joints = 12 servos). */
export const SERVO_MAP: Record<LegName, LegChannels> = {
  frontLeft:  { hip:  0, thigh:  1, calf:  2 },
  frontRight: { hip:  4, thigh:  5, calf:  6 },
  rearLeft:   { hip:  8, thigh:  9, calf: 10 },
  rearRight:  { hip: 12, thigh: 13, calf: 14 },
} as const;

/** All 12 servo channels used by a SpotMicro robot. */
export const ACTIVE_CHANNELS: ReadonlyArray<number> = [
  0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14,
] as const;

/**
 * Resolves a `{ leg, joint }` pair to the PCA9685 channel number.
 *
 * @returns The channel index, or `null` if the leg/joint combination is invalid.
 */
export function resolveChannel(leg: string, joint: string): number | null {
  const legChannels = SERVO_MAP[leg as LegName];
  if (!legChannels) return null;
  const channel = legChannels[joint as JointName];
  if (channel === undefined) return null;
  return channel;
}
