/**
 * WS message handler for `servo-command` messages.
 *
 * Accepts two payload shapes:
 *
 *   { channel: number, angle: number }
 *     — directly addresses a PCA9685 channel (0–15).
 *
 *   { leg: string, joint: string, angle: number }
 *     — resolved via SERVO_MAP to a channel, then forwarded to the driver.
 *
 * Commands are serialised through the FIFO queue baked into the PCA9685 driver
 * (each `setChannel` / `setServoAngle` call is synchronous and non-overlapping).
 */

import { PCA9685Driver } from '../drivers/pca9685';
import { resolveChannel } from '../drivers/spotmicro-servo-map';
import type { MessageHandler } from './registry';

// ── Payload types ─────────────────────────────────────────────────────────────

interface ChannelPayload {
  channel: number;
  angle:   number;
}

interface LegJointPayload {
  leg:   string;
  joint: string;
  angle: number;
}

type ServoPayload = ChannelPayload | LegJointPayload;

function isChannelPayload(p: unknown): p is ChannelPayload {
  return (
    typeof p === 'object' && p !== null &&
    typeof (p as ChannelPayload).channel === 'number' &&
    typeof (p as ChannelPayload).angle   === 'number'
  );
}

function isLegJointPayload(p: unknown): p is LegJointPayload {
  return (
    typeof p === 'object' && p !== null &&
    typeof (p as LegJointPayload).leg   === 'string' &&
    typeof (p as LegJointPayload).joint === 'string' &&
    typeof (p as LegJointPayload).angle === 'number'
  );
}

// ── Channel validation ────────────────────────────────────────────────────────

const MIN_CHANNEL = 0;
const MAX_CHANNEL = 15;

function isValidChannel(ch: number): boolean {
  return Number.isInteger(ch) && ch >= MIN_CHANNEL && ch <= MAX_CHANNEL;
}

// ── Handler factory ───────────────────────────────────────────────────────────

/**
 * Creates a `servo-command` message handler bound to the given PCA9685 driver.
 *
 * The driver must already be initialised (`await driver.init()`) before any
 * servo-command messages arrive.
 */
export function createServoCommandHandler(driver: PCA9685Driver): MessageHandler {
  return async (msg): Promise<void> => {
    let payload: unknown;
    try {
      payload = msg.data ? JSON.parse(msg.data) : undefined;
    } catch {
      console.warn('[servo-command] ignoring message with non-JSON data:', msg.data);
      return;
    }

    if (isChannelPayload(payload)) {
      const { channel, angle } = payload;
      if (!isValidChannel(channel)) {
        console.warn(`[servo-command] invalid channel ${channel}, must be 0–15`);
        return;
      }
      if (!Number.isFinite(angle)) {
        console.warn(`[servo-command] invalid angle ${angle}`);
        return;
      }
      driver.setServoAngle(channel, angle);
      return;
    }

    if (isLegJointPayload(payload)) {
      const { leg, joint, angle } = payload;
      const channel = resolveChannel(leg, joint);
      if (channel === null) {
        console.warn(`[servo-command] unknown leg/joint: ${leg}/${joint}`);
        return;
      }
      if (!Number.isFinite(angle)) {
        console.warn(`[servo-command] invalid angle ${angle}`);
        return;
      }
      driver.setServoAngle(channel, angle);
      return;
    }

    console.warn('[servo-command] unrecognised payload shape:', payload);
  };
}

// Re-export for convenience so callers can import the payload type guard.
export type { ServoPayload };
