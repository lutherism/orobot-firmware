/**
 * WS `motor-command` handler for the SO-101 Feetech bridge.
 *
 * The orobot gateway sends `motor-command` messages with a JSON-encoded `data`
 * field.  This handler accepts two payload shapes:
 *
 *   Single joint:
 *     { joint: string, angle: number }
 *
 *   Home / stop-all:
 *     { joint: "all", stop: true }
 *     { joint: "all", angle: number }  — not used by current UI, but accepted
 *
 *   Multi-joint batch (Phase 2 protocol, already handled here as forward-compat):
 *     { joints: Array<{ joint: string, angle: number }> }
 *
 * Angle unit for radian joints is radians.  Gripper is normalised 0–1.
 * Messages with an unrecognised joint name are silently dropped (warn only).
 *
 * The handler follows the same MessageHandler signature as other handlers in
 * orobot-firmware so it integrates naturally with MessageHandlerRegistry.
 */

import type { MessageHandler } from '../../handlers/registry';
import type { FeetechBus } from './feetech-bus';
import { JOINT_BY_NAME, SO101_JOINTS, angleToTicks } from './joint-map';

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

export interface MotorCommandHandlerOptions {
  /** Default servo speed in ticks/s (0 = max speed). */
  defaultSpeed?: number;
}

/**
 * Creates a `motor-command` MessageHandler bound to the given Feetech bus.
 *
 * The bus must already be open (`await bus.open()`) before any motor-command
 * messages arrive.  All servo writes are fire-and-forget (STS3215 write ops
 * have no synchronous ACK), so the handler always resolves immediately after
 * dispatching the command.
 */
export function createMotorCommandHandler(
  bus: FeetechBus,
  opts: MotorCommandHandlerOptions = {},
): MessageHandler {
  const defaultSpeed = opts.defaultSpeed ?? 0;

  async function sendJoint(jointName: string, angle: number): Promise<void> {
    const joint = JOINT_BY_NAME.get(jointName);
    if (!joint) {
      console.warn(`[so101] unknown joint "${jointName}" — ignoring`);
      return;
    }
    const ticks = angleToTicks(joint, angle);
    await bus.servo(joint.servoId).setPosition(ticks, defaultSpeed);
  }

  return async (msg): Promise<void> => {
    let payload: unknown;
    try {
      payload = msg.data ? JSON.parse(msg.data) : undefined;
    } catch {
      console.warn('[so101] motor-command: non-JSON data — ignoring:', msg.data);
      return;
    }

    if (isStopAll(payload)) {
      // Home all joints (send midpoint = 0 rad / 0.0 gripper)
      await Promise.all(SO101_JOINTS.map((j) => {
        const homeTicks = j.normalised ? 2048 : 2048; // midpoint for all
        return bus.servo(j.servoId).setPosition(homeTicks, defaultSpeed);
      }));
      return;
    }

    if (isBatch(payload)) {
      await Promise.all(
        payload.joints.map(({ joint, angle }) => sendJoint(joint, angle)),
      );
      return;
    }

    if (isSingleJoint(payload)) {
      await sendJoint(payload.joint, payload.angle);
      return;
    }

    console.warn('[so101] motor-command: unrecognised payload shape — ignoring:', payload);
  };
}
