/**
 * Unit tests for the PCA9685 arm joint-command handler.
 *
 * Verifies:
 *   - Single joint command drives correct PCA9685 channel via MockI2CBus
 *   - Angle clamping per joint limits before driving the channel
 *   - Batch payload drives multiple channels
 *   - stop-all (home) centres all joints to 0°
 *   - Unknown joint names are warned and skipped, known joints still move
 *   - Malformed payloads are silently dropped without throwing
 */

import { describe, it, expect, vi } from 'vitest';
import { createJointCommandHandler } from './joint-command-handler';
import { ArmServoMap, type ArmServoConfig } from './arm-servo-map';
import { PCA9685Driver, MockI2CBus } from '../../drivers/pca9685';
import type { InboundMessage } from '../../core/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_CONFIG: ArmServoConfig = {
  joints: [
    { name: 'shoulder', channel: 0, minDeg: -60, maxDeg:  60 },
    { name: 'elbow',    channel: 2, minDeg: -90, maxDeg:   0 },
    { name: 'gripper',  channel: 5, minDeg:   0, maxDeg:  90 },
  ],
};

async function makeDriverAndMap(): Promise<{ driver: PCA9685Driver; servoMap: ArmServoMap; mockBus: MockI2CBus }> {
  const mockBus  = new MockI2CBus();
  const driver   = new PCA9685Driver({ mockBus });
  await driver.init();
  const servoMap = new ArmServoMap(TEST_CONFIG);
  return { driver, servoMap, mockBus };
}

function makeMsg(data: string): InboundMessage {
  return { type: 'motor-command', data, ackId: 'ack-1', deviceUuid: 'dev-test' };
}

// ── Single joint ──────────────────────────────────────────────────────────────

describe('joint-command handler — single joint', () => {
  it('drives correct channel for a known joint (shoulder → ch 0)', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await handler(makeMsg(JSON.stringify({ joint: 'shoulder', angle: 30 })));

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(0, 30);
  });

  it('drives correct channel for elbow (ch 2) at -45°', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await handler(makeMsg(JSON.stringify({ joint: 'elbow', angle: -45 })));

    expect(spy).toHaveBeenCalledWith(2, -45);
  });

  it('clamps angle above maxDeg to maxDeg before driving', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    // shoulder maxDeg = 60; sending 90 should clamp to 60
    await handler(makeMsg(JSON.stringify({ joint: 'shoulder', angle: 90 })));

    expect(spy).toHaveBeenCalledWith(0, 60);
  });

  it('clamps angle below minDeg to minDeg before driving', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    // elbow minDeg = -90; sending -120 should clamp to -90
    await handler(makeMsg(JSON.stringify({ joint: 'elbow', angle: -120 })));

    expect(spy).toHaveBeenCalledWith(2, -90);
  });

  it('skips unknown joint without calling driver', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await handler(makeMsg(JSON.stringify({ joint: 'wrist', angle: 0 })));

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── stop-all (home) ───────────────────────────────────────────────────────────

describe('joint-command handler — stop-all', () => {
  it('drives all joints to 0° on { joint: "all", stop: true }', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await handler(makeMsg(JSON.stringify({ joint: 'all', stop: true })));

    // 3 joints in TEST_CONFIG
    expect(spy).toHaveBeenCalledTimes(3);
    // All at channel/angle matching their 0° clamped position
    expect(spy).toHaveBeenCalledWith(0, 0); // shoulder ch 0
    expect(spy).toHaveBeenCalledWith(2, 0); // elbow    ch 2
    expect(spy).toHaveBeenCalledWith(5, 0); // gripper  ch 5
  });
});

// ── batch payload ─────────────────────────────────────────────────────────────

describe('joint-command handler — batch payload', () => {
  it('drives multiple channels from a joints array', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await handler(makeMsg(JSON.stringify({
      joints: [
        { joint: 'shoulder', angle: 20 },
        { joint: 'gripper',  angle: 45 },
      ],
    })));

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(0, 20);
    expect(spy).toHaveBeenCalledWith(5, 45);
  });

  it('skips unknown joints in batch but drives known ones', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await handler(makeMsg(JSON.stringify({
      joints: [
        { joint: 'unknown_joint', angle: 30 },
        { joint: 'elbow',         angle: -30 },
      ],
    })));

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(2, -30);
  });

  it('applies per-joint clamping in batch mode', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await handler(makeMsg(JSON.stringify({
      joints: [
        { joint: 'gripper', angle: 200 }, // maxDeg=90 → clamp to 90
      ],
    })));

    expect(spy).toHaveBeenCalledWith(5, 90);
  });
});

// ── malformed payloads ────────────────────────────────────────────────────────

describe('joint-command handler — malformed payloads', () => {
  it('ignores non-JSON data without throwing', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await expect(handler(makeMsg('not-json'))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores empty data without throwing', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await expect(handler(makeMsg(''))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores unknown payload shape without throwing', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await expect(handler(makeMsg(JSON.stringify({ foo: 'bar' })))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores null payload without throwing', async () => {
    const { driver, servoMap } = await makeDriverAndMap();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createJointCommandHandler(driver, servoMap);

    await expect(handler(makeMsg(JSON.stringify(null)))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
