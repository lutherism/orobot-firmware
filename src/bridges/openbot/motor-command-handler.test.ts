/**
 * Unit tests for the OpenBot `motor-command` handler.
 *
 * Tests verify:
 *   1. Direct drive payload { left, right } → correct c:<l>,<r> serial command.
 *   2. Named action payloads → expected PWM drive values.
 *   3. Clamping: out-of-range values are clamped to [-255..255].
 *   4. Rounding: fractional values are rounded to integers.
 *   5. Unknown payload shapes are silently dropped (no serial write).
 *   6. Serial write errors are caught and do not propagate.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOpenBotMotorCommandHandler, clampPwm, actionToDrive, PWM_FULL, PWM_SLOW, PWM_TURN, PWM_MAX } from './motor-command-handler';
import { OpenBotMockSerialPort } from './serial-port';
import type { InboundMessage } from '../../core/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMsg(data: unknown): InboundMessage {
  return {
    type:       'motor-command',
    data:       JSON.stringify(data),
    deviceUuid: 'test-uuid',
    ackId:      'ack-1',
  };
}

// ── clampPwm unit tests ───────────────────────────────────────────────────────

describe('clampPwm()', () => {
  it('passes through values within range', () => {
    expect(clampPwm(0)).toBe(0);
    expect(clampPwm(200)).toBe(200);
    expect(clampPwm(-200)).toBe(-200);
    expect(clampPwm(255)).toBe(255);
    expect(clampPwm(-255)).toBe(-255);
  });

  it('clamps values above PWM_MAX to PWM_MAX', () => {
    expect(clampPwm(256)).toBe(PWM_MAX);
    expect(clampPwm(1000)).toBe(PWM_MAX);
  });

  it('clamps values below -PWM_MAX to -PWM_MAX', () => {
    expect(clampPwm(-256)).toBe(-PWM_MAX);
    expect(clampPwm(-1000)).toBe(-PWM_MAX);
  });

  it('rounds fractional values to integers', () => {
    expect(clampPwm(100.7)).toBe(101);
    expect(clampPwm(-100.2)).toBe(-100);
    expect(clampPwm(0.5)).toBe(1);
  });
});

// ── actionToDrive unit tests ──────────────────────────────────────────────────

describe('actionToDrive()', () => {
  it('maps "forward" to equal positive PWM_FULL on both wheels', () => {
    expect(actionToDrive('forward')).toEqual({ left: PWM_FULL, right: PWM_FULL });
  });

  it('maps "reverse" to equal negative PWM_FULL on both wheels', () => {
    expect(actionToDrive('reverse')).toEqual({ left: -PWM_FULL, right: -PWM_FULL });
  });

  it('maps "turnLeft" to left-negative, right-positive', () => {
    expect(actionToDrive('turnLeft')).toEqual({ left: -PWM_TURN, right: PWM_TURN });
  });

  it('maps "turnRight" to left-positive, right-negative', () => {
    expect(actionToDrive('turnRight')).toEqual({ left: PWM_TURN, right: -PWM_TURN });
  });

  it('maps "pivotLeft" to left=0, right=PWM_FULL', () => {
    expect(actionToDrive('pivotLeft')).toEqual({ left: 0, right: PWM_FULL });
  });

  it('maps "pivotRight" to left=PWM_FULL, right=0', () => {
    expect(actionToDrive('pivotRight')).toEqual({ left: PWM_FULL, right: 0 });
  });

  it('maps "slowForward" to equal PWM_SLOW on both wheels', () => {
    expect(actionToDrive('slowForward')).toEqual({ left: PWM_SLOW, right: PWM_SLOW });
  });

  it('maps "stop" to zeros', () => {
    expect(actionToDrive('stop')).toEqual({ left: 0, right: 0 });
  });

  it('returns null for "drive" (inline left/right required)', () => {
    expect(actionToDrive('drive')).toBeNull();
  });

  it('returns null for unknown actions', () => {
    expect(actionToDrive('unknown-xyz')).toBeNull();
    expect(actionToDrive('')).toBeNull();
  });
});

// ── Handler integration tests ─────────────────────────────────────────────────

describe('createOpenBotMotorCommandHandler — direct drive', () => {
  afterEach(() => vi.clearAllMocks());

  it('writes c:<left>,<right> for a valid { left, right } payload', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ left: 150, right: 150 }));

    expect(serial.written).toEqual(['c:150,150']);
  });

  it('writes c:0,0 when left=0, right=0', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ left: 0, right: 0 }));

    expect(serial.written).toEqual(['c:0,0']);
  });

  it('clamps left/right to [-255..255]', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ left: 999, right: -999 }));

    expect(serial.written).toEqual(['c:255,-255']);
  });

  it('rounds fractional PWM values to integers', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ left: 100.6, right: -50.2 }));

    expect(serial.written).toEqual(['c:101,-50']);
  });

  it('writes correct serial string for reverse drive', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ left: -200, right: -200 }));

    expect(serial.written).toEqual(['c:-200,-200']);
  });
});

describe('createOpenBotMotorCommandHandler — named actions', () => {
  it('translates "forward" action to c:200,200', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ action: 'forward' }));

    expect(serial.written).toEqual([`c:${PWM_FULL},${PWM_FULL}`]);
  });

  it('translates "stop" action to c:0,0', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ action: 'stop' }));

    expect(serial.written).toEqual(['c:0,0']);
  });

  it('translates "turnLeft" action to negative-left, positive-right', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ action: 'turnLeft' }));

    expect(serial.written).toEqual([`c:${-PWM_TURN},${PWM_TURN}`]);
  });

  it('handles "drive" action with explicit left/right values', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ action: 'drive', left: 180, right: 120 }));

    expect(serial.written).toEqual(['c:180,120']);
  });

  it('defaults to c:0,0 for "drive" action with missing left/right', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ action: 'drive' }));

    expect(serial.written).toEqual(['c:0,0']);
  });

  it('drops unknown action names without writing to serial', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    await handler(makeMsg({ action: 'turbo-boost' }));

    expect(serial.written).toHaveLength(0);
  });
});

describe('createOpenBotMotorCommandHandler — error cases', () => {
  it('drops non-JSON data without writing to serial', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);
    const msg: InboundMessage = {
      type: 'motor-command', data: 'not-json', deviceUuid: 'u', ackId: 'a',
    };

    await handler(msg);

    expect(serial.written).toHaveLength(0);
  });

  it('drops unrecognised payload shapes without writing to serial', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();
    const handler = createOpenBotMotorCommandHandler(serial);

    // Neither { left, right } nor { action }
    await handler(makeMsg({ speed: 100 }));

    expect(serial.written).toHaveLength(0);
  });

  it('catches and swallows serial write errors without throwing', async () => {
    const serial  = new OpenBotMockSerialPort();
    await serial.open();

    // Force writeLine to throw
    vi.spyOn(serial, 'writeLine').mockRejectedValueOnce(new Error('serial port error'));

    const handler = createOpenBotMotorCommandHandler(serial);

    // Should not throw
    await expect(handler(makeMsg({ left: 100, right: 100 }))).resolves.toBeUndefined();
  });
});
