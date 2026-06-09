/**
 * WS `command-in:readangles` handler for the SO-101 Feetech bridge.
 *
 * When the calibration wizard (orobotio #3256 / #3303) sends
 * `{ type: "command-in", data: "readangles" }`, this handler:
 *
 *  1. Reads the current raw tick position from all 6 STS3215 servos.
 *  2. Converts ticks → angle in the joint's native unit (radians or
 *     0–1 normalised fraction for the gripper) via `ticksToAngle()`.
 *  3. Emits a `command-out` envelope over the WS channel with `data`
 *     set to a JSON-encoded `ReadAnglesPayload`:
 *
 *     ```json
 *     {
 *       "shoulder_pan":  0.0,
 *       "shoulder_lift": 0.5235987755982988,
 *       "elbow_flex":   -0.7853981633974483,
 *       "wrist_flex":    0.0,
 *       "wrist_roll":    0.0,
 *       "gripper":       0.25
 *     }
 *     ```
 *
 * The wizard consumes this `command-out` to populate `zeroPose` with
 * real servo angles and flips `firmwareReadback: true` in the snapshot.
 *
 * Wire format:
 *   - Outbound type:     `command-out`
 *   - `deviceUuid`:      forwarded from the inbound message
 *   - `data` (string):   JSON-encoded `ReadAnglesPayload`
 *
 * Error handling:
 *   - If reading any servo fails, the handler logs a warning and omits
 *     that joint from the response (remaining joints still returned).
 *   - An empty object response is a valid (though degenerate) reply.
 */

import type { MessageHandler } from '../../handlers/registry';
import type { FeetechBus } from './feetech-bus';
import type { EventBus } from '../../core/event-bus';
import { makeEnvelope } from '../../core/wire';
import { SO101_JOINTS, ticksToAngle } from './joint-map';

// ── Response type ─────────────────────────────────────────────────────────────

/** Map of joint name → current angle in the joint's native unit. */
export type ReadAnglesPayload = Record<string, number>;

// ── Handler factory ───────────────────────────────────────────────────────────

/**
 * Creates a `readangles` MessageHandler bound to the given Feetech bus.
 *
 * The bus must already be open (`await bus.open()`) before any readangles
 * messages arrive.
 *
 * @param feetechBus - Feetech bus implementation (production or mock).
 * @param eventBus   - EventBus used to emit the `network:send` reply.
 */
export function createReadAnglesHandler(
  feetechBus: FeetechBus,
  eventBus: EventBus,
): MessageHandler {
  return async (msg): Promise<void> => {
    const angles: ReadAnglesPayload = {};

    await Promise.all(
      SO101_JOINTS.map(async (joint) => {
        try {
          const ticks = await feetechBus.servo(joint.servoId).getPosition();
          angles[joint.name] = ticksToAngle(joint, ticks);
        } catch (err) {
          console.warn(`[so101:readangles] failed to read servo ${joint.servoId} (${joint.name}):`, err);
        }
      }),
    );

    eventBus.emit('network:send', {
      payload: makeEnvelope('command-out', {
        deviceUuid: msg.deviceUuid,
        data: angles,
      }),
    });
  };
}
