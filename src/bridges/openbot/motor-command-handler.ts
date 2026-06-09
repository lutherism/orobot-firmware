/**
 * WS `motor-command` handler for the OpenBot serial bridge.
 *
 * The orobot gateway sends `motor-command` messages with a JSON-encoded `data`
 * field.  This handler accepts two payload shapes specific to differential-drive
 * mobile robots:
 *
 *   Drive command (direct):
 *     { left: number, right: number }   — PWM values -255..255
 *
 *   Named action (translated to drive):
 *     { action: 'forward' | 'reverse' | 'turnLeft' | 'turnRight' |
 *               'pivotLeft' | 'pivotRight' | 'slowForward' | 'stop' }
 *
 * The handler clamps left/right to [-255..255] and rounds to integers before
 * writing the serial command `c:<left>,<right>\n` to the Arduino Nano.
 *
 * Messages with unrecognised payload shapes are logged and silently dropped.
 * Serial write failures are caught and logged; they do not throw (the Arduino
 * may be momentarily unavailable and will recover on reconnect).
 *
 * Named action → PWM mapping (mirrors script.js cloud handler constants):
 *   PWM_FULL = 200, PWM_SLOW = 100, PWM_TURN = 150
 */

import type { MessageHandler } from '../../handlers/registry';
import type { OpenBotSerialPort } from './serial-port';

// ── Protocol constants (must match script.js cloud handler) ──────────────────

export const PWM_MAX  = 255;  // Arduino 8-bit ceiling
export const PWM_FULL = 200;  // ~78% duty cycle
export const PWM_SLOW = 100;  // cautious speed
export const PWM_TURN = 150;  // differential turn

// ── Payload type guards ───────────────────────────────────────────────────────

interface DrivePayload {
  left:  number;
  right: number;
}

interface ActionPayload {
  action: string;
  left?:  number;
  right?: number;
}

function isDrive(p: unknown): p is DrivePayload {
  return (
    typeof p === 'object' && p !== null &&
    typeof (p as DrivePayload).left  === 'number' &&
    typeof (p as DrivePayload).right === 'number'
  );
}

function isAction(p: unknown): p is ActionPayload {
  return (
    typeof p === 'object' && p !== null &&
    typeof (p as ActionPayload).action === 'string'
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamp and round a PWM value to the valid Arduino range [-255..255]. */
export function clampPwm(v: number): number {
  return Math.round(Math.max(-PWM_MAX, Math.min(PWM_MAX, v)));
}

/** Translate a named action to { left, right } drive values. */
export function actionToDrive(action: string): { left: number; right: number } | null {
  switch (action) {
    case 'forward':     return { left:  PWM_FULL,  right:  PWM_FULL };
    case 'reverse':     return { left: -PWM_FULL,  right: -PWM_FULL };
    case 'turnLeft':    return { left: -PWM_TURN,  right:  PWM_TURN };
    case 'turnRight':   return { left:  PWM_TURN,  right: -PWM_TURN };
    case 'pivotLeft':   return { left:  0,          right:  PWM_FULL };
    case 'pivotRight':  return { left:  PWM_FULL,   right:  0 };
    case 'slowForward': return { left:  PWM_SLOW,   right:  PWM_SLOW };
    case 'stop':        return { left:  0,           right:  0 };
    case 'drive':       return null; // requires explicit left/right in payload
    default:            return null;
  }
}

// ── Handler factory ───────────────────────────────────────────────────────────

/**
 * Creates a `motor-command` MessageHandler that writes differential-drive
 * serial commands to the Arduino Nano over USB.
 *
 * The serial port must already be open before any motor-command messages
 * arrive (call `await serialPort.open()` in the bridge start routine).
 */
export function createOpenBotMotorCommandHandler(
  serialPort: OpenBotSerialPort,
): MessageHandler {
  async function drive(left: number, right: number): Promise<void> {
    const l = clampPwm(left);
    const r = clampPwm(right);
    const cmd = `c:${l},${r}`;
    try {
      await serialPort.writeLine(cmd);
    } catch (err) {
      console.warn(`[openbot] serial write failed — cmd="${cmd}":`, err);
    }
  }

  return async (msg): Promise<void> => {
    let payload: unknown;
    try {
      payload = msg.data ? JSON.parse(msg.data) : undefined;
    } catch {
      console.warn('[openbot] motor-command: non-JSON data — ignoring:', msg.data);
      return;
    }

    // Named action payload — translate to drive values
    if (isAction(payload)) {
      if (payload.action === 'drive') {
        // Inline left/right with 'drive' action
        const left  = payload.left  ?? 0;
        const right = payload.right ?? 0;
        await drive(left, right);
        return;
      }

      const vals = actionToDrive(payload.action);
      if (vals) {
        await drive(vals.left, vals.right);
        return;
      }

      console.warn(`[openbot] motor-command: unknown action "${payload.action}" — ignoring`);
      return;
    }

    // Direct drive payload { left, right }
    if (isDrive(payload)) {
      await drive(payload.left, payload.right);
      return;
    }

    console.warn('[openbot] motor-command: unrecognised payload shape — ignoring:', payload);
  };
}
