import { describe, it, expect, beforeEach } from 'vitest';
import { createMotorCommandHandler } from './motor-command-handler';
import { FeetechMockBus, MockServo } from './feetech-bus';
import { JOINT_BY_NAME, angleToTicks } from './joint-map';
import type { InboundMessage } from '../../core/types';

function makeMsg(data: string, type = 'motor-command'): InboundMessage {
  return { type, data, ackId: 'ack-1', deviceUuid: 'dev-test' };
}

describe('motor-command handler — single joint', () => {
  let mockBus: FeetechMockBus;

  beforeEach(() => {
    mockBus = new FeetechMockBus();
  });

  it('moves shoulder_pan (servoId 1) to correct ticks for 0 rad', async () => {
    const handler = createMotorCommandHandler(mockBus);
    await handler(makeMsg(JSON.stringify({ joint: 'shoulder_pan', angle: 0 })));

    const servo = mockBus.servos.get(1) as MockServo;
    expect(servo).toBeDefined();
    expect(servo.calls).toHaveLength(1);
    expect(servo.calls[0]!.ticks).toBe(2048); // 0 rad → midpoint
  });

  it('moves shoulder_pan to correct ticks for π/2 rad', async () => {
    const handler = createMotorCommandHandler(mockBus);
    await handler(makeMsg(JSON.stringify({ joint: 'shoulder_pan', angle: Math.PI / 2 })));

    const servo = mockBus.servos.get(1) as MockServo;
    const expected = angleToTicks(JOINT_BY_NAME.get('shoulder_pan')!, Math.PI / 2);
    expect(servo.calls[0]!.ticks).toBe(expected);
  });

  it('moves gripper (servoId 6) to half-open (0.5)', async () => {
    const handler = createMotorCommandHandler(mockBus);
    await handler(makeMsg(JSON.stringify({ joint: 'gripper', angle: 0.5 })));

    const servo = mockBus.servos.get(6) as MockServo;
    expect(servo).toBeDefined();
    expect(servo.calls[0]!.ticks).toBe(2560); // 0.5 → midway between 2048 and 3072
  });

  it('ignores unknown joint name without throwing', async () => {
    const handler = createMotorCommandHandler(mockBus);
    await expect(
      handler(makeMsg(JSON.stringify({ joint: 'nonexistent_joint', angle: 0 }))),
    ).resolves.toBeUndefined();
    // No servo should have been touched
    expect(mockBus.servos.size).toBe(0);
  });

  it('passes defaultSpeed to servo', async () => {
    const handler = createMotorCommandHandler(mockBus, { defaultSpeed: 500 });
    await handler(makeMsg(JSON.stringify({ joint: 'shoulder_lift', angle: 0 })));

    const servo = mockBus.servos.get(2) as MockServo;
    expect(servo.calls[0]!.speed).toBe(500);
  });
});

describe('motor-command handler — stop-all (home)', () => {
  it('sends all 6 servos to midpoint (2048)', async () => {
    const mockBus = new FeetechMockBus();
    const handler  = createMotorCommandHandler(mockBus);

    await handler(makeMsg(JSON.stringify({ joint: 'all', stop: true })));

    // All 6 servo IDs should have received a command
    for (const id of [1, 2, 3, 4, 5, 6]) {
      const servo = mockBus.servos.get(id) as MockServo;
      expect(servo, `servo ${id} should exist`).toBeDefined();
      expect(servo.calls).toHaveLength(1);
      // All joints commanded to midpoint (2048)
      expect(servo.calls[0]!.ticks).toBe(2048);
    }
  });
});

describe('motor-command handler — batch payload', () => {
  it('moves multiple joints in parallel', async () => {
    const mockBus = new FeetechMockBus();
    const handler  = createMotorCommandHandler(mockBus);

    await handler(makeMsg(JSON.stringify({
      joints: [
        { joint: 'shoulder_pan',  angle: 0 },
        { joint: 'shoulder_lift', angle: Math.PI / 4 },
        { joint: 'gripper',       angle: 1.0 },
      ],
    })));

    expect(mockBus.servos.get(1)!.calls[0]!.ticks).toBe(2048);
    expect(mockBus.servos.get(2)!.calls).toHaveLength(1);
    expect(mockBus.servos.get(6)!.calls[0]!.ticks).toBe(3072);
  });
});

describe('motor-command handler — malformed payloads', () => {
  it('ignores non-JSON data without throwing', async () => {
    const mockBus = new FeetechMockBus();
    const handler  = createMotorCommandHandler(mockBus);

    await expect(handler(makeMsg('not-json'))).resolves.toBeUndefined();
    expect(mockBus.servos.size).toBe(0);
  });

  it('ignores empty data without throwing', async () => {
    const mockBus = new FeetechMockBus();
    const handler  = createMotorCommandHandler(mockBus);

    await expect(handler(makeMsg(''))).resolves.toBeUndefined();
    expect(mockBus.servos.size).toBe(0);
  });

  it('ignores unknown payload shape without throwing', async () => {
    const mockBus = new FeetechMockBus();
    const handler  = createMotorCommandHandler(mockBus);

    await expect(handler(makeMsg(JSON.stringify({ foo: 'bar' })))).resolves.toBeUndefined();
    expect(mockBus.servos.size).toBe(0);
  });
});
