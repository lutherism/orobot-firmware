import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServoCommandHandler } from './servo-command';
import { PCA9685Driver, MockI2CBus } from '../drivers/pca9685';
import type { InboundMessage } from '../core/types';

function makeMsg(data: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    type:       'servo-command',
    data,
    ackId:      'ack-1',
    deviceUuid: 'dev-123',
    ...overrides,
  };
}

async function makeDriver(): Promise<PCA9685Driver> {
  const driver = new PCA9685Driver({ mockBus: new MockI2CBus() });
  await driver.init();
  return driver;
}

// ── channel + angle payload ───────────────────────────────────────────────────

describe('servo-command handler — channel payload', () => {
  it('calls setServoAngle with channel and angle', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ channel: 3, angle: 45 })));

    expect(spy).toHaveBeenCalledWith(3, 45);
  });

  it('calls setServoAngle for channel 0 at -90°', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ channel: 0, angle: -90 })));

    expect(spy).toHaveBeenCalledWith(0, -90);
  });

  it('calls setServoAngle for channel 15 at +90°', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ channel: 15, angle: 90 })));

    expect(spy).toHaveBeenCalledWith(15, 90);
  });

  it('ignores channel < 0 (invalid)', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ channel: -1, angle: 0 })));

    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores channel > 15 (invalid)', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ channel: 16, angle: 0 })));

    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores non-finite angle (NaN)', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ channel: 0, angle: NaN })));

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── leg + joint payload ───────────────────────────────────────────────────────

describe('servo-command handler — leg/joint payload', () => {
  it('resolves frontLeft hip (ch 0) at 30°', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ leg: 'frontLeft', joint: 'hip', angle: 30 })));

    expect(spy).toHaveBeenCalledWith(0, 30);
  });

  it('resolves rearRight calf (ch 14) at -45°', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ leg: 'rearRight', joint: 'calf', angle: -45 })));

    expect(spy).toHaveBeenCalledWith(14, -45);
  });

  it('ignores unknown leg name', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ leg: 'middleLeft', joint: 'hip', angle: 0 })));

    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores unknown joint name', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await handler(makeMsg(JSON.stringify({ leg: 'frontLeft', joint: 'ankle', angle: 0 })));

    expect(spy).not.toHaveBeenCalled();
  });
});

// ── malformed payloads ────────────────────────────────────────────────────────

describe('servo-command handler — malformed payloads', () => {
  it('ignores non-JSON data without throwing', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await expect(handler(makeMsg('not-json'))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores empty data without throwing', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await expect(handler(makeMsg(''))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores unknown payload shape (missing fields)', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await expect(handler(makeMsg(JSON.stringify({ foo: 'bar' })))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores array payload without throwing', async () => {
    const driver  = await makeDriver();
    const spy     = vi.spyOn(driver, 'setServoAngle');
    const handler = createServoCommandHandler(driver);

    await expect(handler(makeMsg(JSON.stringify([0, 90])))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
