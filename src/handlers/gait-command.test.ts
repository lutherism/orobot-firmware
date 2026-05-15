/**
 * Tests for createGaitCommandHandler (src/handlers/gait-command.ts).
 *
 * The handler routes recognised gait commands to GaitStateMachine.command()
 * and silently ignores unrecognised payloads so other command-in consumers
 * can coexist.  All 7 valid commands are exercised, plus the unrecognised,
 * empty, and whitespace-only cases.
 */

import { describe, it, expect, vi } from 'vitest';
import { createGaitCommandHandler } from './gait-command';
import type { GaitStateMachine } from '../gait/quadruped';
import type { InboundMessage } from '../core/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMsg(data: string): InboundMessage {
  return { type: 'command-in', data, ackId: 'ack-1', deviceUuid: 'dev-gait' };
}

function makeGait(): { gait: GaitStateMachine; commandSpy: ReturnType<typeof vi.fn> } {
  const commandSpy = vi.fn();
  const gait = { command: commandSpy } as unknown as GaitStateMachine;
  return { gait, commandSpy };
}

// ── Valid gait commands ───────────────────────────────────────────────────────

const VALID_COMMANDS = [
  'stand',
  'sit',
  'walk:forward',
  'walk:backward',
  'turn:left',
  'turn:right',
  'stop',
] as const;

describe('createGaitCommandHandler — valid commands', () => {
  for (const cmd of VALID_COMMANDS) {
    it(`delegates "${cmd}" to gait.command()`, async () => {
      const { gait, commandSpy } = makeGait();
      const handler = createGaitCommandHandler(gait);
      await handler(makeMsg(cmd));
      expect(commandSpy).toHaveBeenCalledOnce();
      expect(commandSpy).toHaveBeenCalledWith(cmd);
    });
  }
});

// ── Unknown / edge-case payloads ──────────────────────────────────────────────

describe('createGaitCommandHandler — unrecognised payloads', () => {
  it('silently ignores an unknown command string', async () => {
    const { gait, commandSpy } = makeGait();
    const handler = createGaitCommandHandler(gait);
    await handler(makeMsg('fly'));
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it('silently ignores an empty data string', async () => {
    const { gait, commandSpy } = makeGait();
    const handler = createGaitCommandHandler(gait);
    await handler(makeMsg(''));
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it('silently ignores a whitespace-only data string', async () => {
    const { gait, commandSpy } = makeGait();
    const handler = createGaitCommandHandler(gait);
    await handler(makeMsg('   '));
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it('silently ignores a partial prefix like "walk"', async () => {
    // 'walk' alone is not a valid GaitCommand — only 'walk:forward' / 'walk:backward' are
    const { gait, commandSpy } = makeGait();
    const handler = createGaitCommandHandler(gait);
    await handler(makeMsg('walk'));
    expect(commandSpy).not.toHaveBeenCalled();
  });

  it('silently ignores a motor-style payload ("gotoangle:90")', async () => {
    // Motor and gait share the command-in type; each should ignore the other's data
    const { gait, commandSpy } = makeGait();
    const handler = createGaitCommandHandler(gait);
    await handler(makeMsg('gotoangle:90'));
    expect(commandSpy).not.toHaveBeenCalled();
  });
});
