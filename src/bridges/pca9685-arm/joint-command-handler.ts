/**
 * WS `motor-command` handler for PCA9685-based multi-servo arms.
 *
 * Accepts the same payload shapes as the SO-101 motor-command handler so that
 * the orobot JointDriveControl UI can drive both Feetech serial arms and
 * PCA9685 PWM arms without any frontend changes:
 *
 *   Single joint:
 *     { joint: string, angle: number }   — angle in degrees (−90 to +90)
 *
 *   Home / stop-all:
 *     { joint: "all", stop: true }       — centres all joints (0°)
 *
 *   Multi-joint batch:
 *     { joints: Array<{ joint: string, angle: number }> }
 *
 * Angles are clamped to per-joint limits defined in the ArmServoMap before
 * being passed to the PCA9685 driver.  Unknown joint names produce a warn-and-skip
 * rather than an error so that a partially-supported config doesn't halt motion
 * on known joints.
 */

import { PCA9685Driver } from '../../drivers/pca9685';
import { ArmServoMap } from './arm-servo-map';
import type { MessageHandler } from '../../handlers/registry';

// ── Payload type guards ───────────────────────────────────────────────────────

interface SingleJointPayload {
  joint: string;
  angle: number;
}

interface StopAllPayload {
  joint: 'all';
  stop: true;
}

interface BatchPayload {
  joints: Array<{ joint: string; angle: number }>;
}

function isSingleJoint(p: unknown): p is SingleJointPayload {
  return (
    typeof p === 'object' && p !== null &&
    typeof (p as SingleJointPayload).joint === 'string' &&
    typeof (p as SingleJointPayload).angle === 'number'
  );
}

function isStopAll(p: unknown): p is StopAllPayload {
  return (
    typeof p === 'object' && p !== null &&
    (p as StopAllPayload).joint === 'all' &&
    (p as StopAllPayload).stop === true
  );
}

function isBatch(p: unknown): p is BatchPayload {
  return (
    typeof p === 'object' && p !== null &&
    Array.isArray((p as BatchPayload).joints)
  );
}

// ── Handler factory ───────────────────────────────────────────────────────────

/**
 * Creates a `motor-command` MessageHandler bound to the given PCA9685 driver
 * and ArmServoMap.
 *
 * The driver must already be initialised (`await driver.init()`) before any
 * motor-command messages arrive.
 */
export function createJointCommandHandler(
  driver: PCA9685Driver,
  servoMap: ArmServoMap,
): MessageHandler {
  function driveJoint(jointName: string, angleDeg: number): void {
    const clamped = servoMap.clampAngle(jointName, angleDeg);
    if (clamped === null) {
      console.warn(`[pca9685-arm] unknown joint "${jointName}" — ignoring`);
      return;
    }
    const channel = servoMap.resolveChannel(jointName)!;
    driver.setServoAngle(channel, clamped);
  }

  return async (msg): Promise<void> => {
    let payload: unknown;
    try {
      payload = msg.data ? JSON.parse(msg.data) : undefined;
    } catch {
      console.warn('[pca9685-arm] motor-command: non-JSON data — ignoring:', msg.data);
      return;
    }

    if (isStopAll(payload)) {
      // Home all joints to 0° (centre position)
      for (const name of servoMap.jointNames) {
        driveJoint(name, 0);
      }
      return;
    }

    if (isBatch(payload)) {
      for (const { joint, angle } of payload.joints) {
        driveJoint(joint, angle);
      }
      return;
    }

    if (isSingleJoint(payload)) {
      driveJoint(payload.joint, payload.angle);
      return;
    }

    console.warn('[pca9685-arm] motor-command: unrecognised payload shape — ignoring:', payload);
  };
}
