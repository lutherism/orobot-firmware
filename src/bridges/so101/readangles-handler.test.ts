import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReadAnglesHandler } from './readangles-handler';
import { FeetechMockBus } from './feetech-bus';
import { EventBus } from '../../core/event-bus';
import { SO101_JOINTS, angleToTicks, ticksToAngle } from './joint-map';
import type { InboundMessage } from '../../core/types';

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { type: 'command-in', data: 'readangles', ackId: 'ack-1', deviceUuid: 'dev-123', ...overrides };
}

// ── readangles handler ────────────────────────────────────────────────────────

describe('readangles handler', () => {
  let mockBus: FeetechMockBus;
  let eventBus: EventBus;

  beforeEach(() => {
    mockBus = new FeetechMockBus();
    eventBus = new EventBus();
  });

  it('emits command-out with all 6 joint angles at midpoint (default state)', async () => {
    // FeetechMockBus initialises all servos to 2048 (midpoint = 0 rad)
    const handler = createReadAnglesHandler(mockBus, eventBus);
    const sent: unknown[] = [];
    eventBus.on('network:send', (p) => sent.push(p.payload));

    await handler(makeMsg());

    expect(sent).toHaveLength(1);
    const payload = sent[0] as Record<string, unknown>;
    expect(payload.type).toBe('command-out');
    expect(payload.deviceUuid).toBe('dev-123');

    const data = JSON.parse(payload.data as string) as Record<string, number>;
    // All joints at midpoint 2048 → 0 rad (or 0.0 for gripper)
    for (const joint of SO101_JOINTS) {
      expect(data).toHaveProperty(joint.name);
      expect(data[joint.name]).toBeCloseTo(0, 5);
    }
  });

  it('forwards deviceUuid from the inbound message', async () => {
    const handler = createReadAnglesHandler(mockBus, eventBus);
    const sent: unknown[] = [];
    eventBus.on('network:send', (p) => sent.push(p.payload));

    await handler(makeMsg({ deviceUuid: 'custom-uuid' }));

    const payload = sent[0] as Record<string, unknown>;
    expect(payload.deviceUuid).toBe('custom-uuid');
  });

  it('returns correct radian angle after a servo has been commanded to a non-zero position', async () => {
    const handler = createReadAnglesHandler(mockBus, eventBus);
    const sent: unknown[] = [];
    eventBus.on('network:send', (p) => sent.push(p.payload));

    // Command shoulder_pan (servoId 1) to π/4 rad
    const shoulderPanDef = SO101_JOINTS.find((j) => j.name === 'shoulder_pan')!;
    const targetRad = Math.PI / 4;
    const ticks = angleToTicks(shoulderPanDef, targetRad);
    await mockBus.servo(1).setPosition(ticks);

    await handler(makeMsg());

    const payload = sent[0] as Record<string, unknown>;
    const data = JSON.parse(payload.data as string) as Record<string, number>;
    expect(data['shoulder_pan']).toBeCloseTo(targetRad, 3);
    // Other joints still at midpoint
    expect(data['shoulder_lift']).toBeCloseTo(0, 5);
  });

  it('returns correct normalised fraction for gripper after setPosition', async () => {
    const handler = createReadAnglesHandler(mockBus, eventBus);
    const sent: unknown[] = [];
    eventBus.on('network:send', (p) => sent.push(p.payload));

    // Set gripper (servoId 6) halfway closed
    const gripperDef = SO101_JOINTS.find((j) => j.name === 'gripper')!;
    const halfClosedTicks = angleToTicks(gripperDef, 0.5); // 2560
    await mockBus.servo(6).setPosition(halfClosedTicks);

    await handler(makeMsg());

    const payload = sent[0] as Record<string, unknown>;
    const data = JSON.parse(payload.data as string) as Record<string, number>;
    expect(data['gripper']).toBeCloseTo(0.5, 3);
  });

  it('data field is a JSON string (wire contract)', async () => {
    const handler = createReadAnglesHandler(mockBus, eventBus);
    const sent: unknown[] = [];
    eventBus.on('network:send', (p) => sent.push(p.payload));

    await handler(makeMsg());

    const payload = sent[0] as Record<string, unknown>;
    expect(typeof payload.data).toBe('string');
    expect(() => JSON.parse(payload.data as string)).not.toThrow();
  });

  it('still emits a reply when a servo read fails (partial response)', async () => {
    // Inject a bus where servo 3 (elbow_flex) throws on getPosition
    const failingBus: FeetechMockBus = new FeetechMockBus();
    const spy = vi.spyOn(failingBus.servo(3), 'getPosition').mockRejectedValue(new Error('serial timeout'));

    const handler = createReadAnglesHandler(failingBus, eventBus);
    const sent: unknown[] = [];
    eventBus.on('network:send', (p) => sent.push(p.payload));

    await expect(handler(makeMsg())).resolves.toBeUndefined();

    expect(sent).toHaveLength(1);
    const payload = sent[0] as Record<string, unknown>;
    const data = JSON.parse(payload.data as string) as Record<string, number>;

    // elbow_flex (servoId 3) should be absent
    expect(data).not.toHaveProperty('elbow_flex');
    // Other joints should still be present
    expect(data).toHaveProperty('shoulder_pan');
    expect(data).toHaveProperty('shoulder_lift');
    expect(data).toHaveProperty('wrist_flex');
    expect(data).toHaveProperty('wrist_roll');
    expect(data).toHaveProperty('gripper');

    spy.mockRestore();
  });

  it('round-trips all SO101_JOINTS through angleToTicks → getPosition → ticksToAngle', async () => {
    // For each joint, set a known angle, then verify readangles returns it faithfully
    const handler = createReadAnglesHandler(mockBus, eventBus);

    const testAngles: Record<string, number> = {
      shoulder_pan:  Math.PI / 6,
      shoulder_lift: -Math.PI / 4,
      elbow_flex:    Math.PI / 3,
      wrist_flex:    Math.PI / 8,
      wrist_roll:    -Math.PI / 2,
      gripper:       0.75,
    };

    for (const joint of SO101_JOINTS) {
      const ticks = angleToTicks(joint, testAngles[joint.name]!);
      await mockBus.servo(joint.servoId).setPosition(ticks);
    }

    const sent: unknown[] = [];
    eventBus.on('network:send', (p) => sent.push(p.payload));
    await handler(makeMsg());

    const data = JSON.parse((sent[0] as any).data as string) as Record<string, number>;

    for (const joint of SO101_JOINTS) {
      const expected = ticksToAngle(joint, angleToTicks(joint, testAngles[joint.name]!));
      expect(data[joint.name]).toBeCloseTo(expected, 3);
    }
  });
});
