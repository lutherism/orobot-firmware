/**
 * WS handler for `command-in` messages that carry quadruped gait commands.
 *
 * Recognised payloads (msg.data string):
 *   stand, sit, walk:forward, walk:backward, turn:left, turn:right, stop
 *
 * Unrecognised payloads are silently ignored so this handler can coexist with
 * other `command-in` consumers (e.g. motor commands in custom user programs).
 * The registry routes `command-in` by the `data` string value, so each gait
 * keyword is registered as its own exact-match data entry.
 */

import { GaitStateMachine, type GaitCommand } from '../gait/quadruped';
import type { MessageHandler } from './registry';

const GAIT_COMMANDS = new Set<GaitCommand>([
  'stand', 'sit', 'walk:forward', 'walk:backward', 'turn:left', 'turn:right', 'stop',
]);

function isGaitCommand(s: string): s is GaitCommand {
  return GAIT_COMMANDS.has(s as GaitCommand);
}

/**
 * Creates a `command-in` handler bound to the given GaitStateMachine.
 *
 * The GaitStateMachine must own a fully-initialised PCA9685Driver before any
 * gait commands arrive (`await driver.init()` must have completed).
 *
 * @param gait  GaitStateMachine instance shared with the rest of the firmware.
 * @returns A MessageHandler suitable for registration in MessageHandlerRegistry.
 */
export function createGaitCommandHandler(gait: GaitStateMachine): MessageHandler {
  return async (msg): Promise<void> => {
    const cmd = (msg.data ?? '').trim();
    if (!isGaitCommand(cmd)) {
      // Not a gait command — let other handlers deal with it.
      return;
    }
    gait.command(cmd);
  };
}
