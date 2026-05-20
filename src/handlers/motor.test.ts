import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMotorHandler, createGotoRelativeHandler, createStopAllHandler } from './motor';
import { StepperMotor } from '../hardware/stepper-motor';
import { MockGPIODriver } from '../hardware/mock-driver';
import { EventBus } from '../core/event-bus';
import type { InboundMessage } from '../core/types';

const RASPI_PINS = [17, 18, 22, 27] as const;

function makeMsg(data: string, overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    type: 'motor-command',
    data,
    ackId: 'ack-1',
    deviceUuid: 'dev-123',
    ...overrides,
  };
}

async function makeMotor(): Promise<StepperMotor> {
  const driver = new MockGPIODriver();
  const bus = new EventBus();
  const motor = new StepperMotor(driver, [...RASPI_PINS], bus);
  await motor.initialize();
  return motor;
}

// ── createMotorHandler (gotoangle) ──────────────────────────────────────────

describe('createMotorHandler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls gotoAngle with the parsed degree value', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoAngle').mockResolvedValue(undefined);
    const handler = createMotorHandler(motor);

    await handler(makeMsg('gotoangle:45'));

    expect(spy).toHaveBeenCalledWith(45);
  });

  it('calls gotoAngle with a negative degree value', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoAngle').mockResolvedValue(undefined);
    const handler = createMotorHandler(motor);

    await handler(makeMsg('gotoangle:-90'));

    expect(spy).toHaveBeenCalledWith(-90);
  });

  it('calls gotoAngle with 0 degrees', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoAngle').mockResolvedValue(undefined);
    const handler = createMotorHandler(motor);

    await handler(makeMsg('gotoangle:0'));

    expect(spy).toHaveBeenCalledWith(0);
  });

  it('ignores NaN data without calling gotoAngle', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoAngle').mockResolvedValue(undefined);
    const handler = createMotorHandler(motor);

    await expect(handler(makeMsg('gotoangle:notanumber'))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores missing colon suffix — undefined parses as NaN', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoAngle').mockResolvedValue(undefined);
    const handler = createMotorHandler(motor);

    // 'gotoangle'.split(':')[1] === undefined → Number(undefined) === NaN
    await expect(handler(makeMsg('gotoangle'))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats empty string after colon as 0 (Number("") === 0)', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoAngle').mockResolvedValue(undefined);
    const handler = createMotorHandler(motor);

    // 'gotoangle:'.split(':')[1] === '' → Number('') === 0, not NaN
    await expect(handler(makeMsg('gotoangle:'))).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(0);
  });

  it('does not throw on NaN input', async () => {
    const motor = await makeMotor();
    vi.spyOn(motor, 'gotoAngle').mockResolvedValue(undefined);
    const handler = createMotorHandler(motor);

    await expect(handler(makeMsg('gotoangle:abc'))).resolves.toBeUndefined();
  });
});

// ── createGotoRelativeHandler ────────────────────────────────────────────────

describe('createGotoRelativeHandler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls gotoRelative with the parsed degree value', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoRelative').mockResolvedValue(undefined);
    const handler = createGotoRelativeHandler(motor);

    await handler(makeMsg('gotorelative:30'));

    expect(spy).toHaveBeenCalledWith(30);
  });

  it('calls gotoRelative with a negative offset', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoRelative').mockResolvedValue(undefined);
    const handler = createGotoRelativeHandler(motor);

    await handler(makeMsg('gotorelative:-15'));

    expect(spy).toHaveBeenCalledWith(-15);
  });

  it('ignores NaN data without calling gotoRelative', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoRelative').mockResolvedValue(undefined);
    const handler = createGotoRelativeHandler(motor);

    await expect(handler(makeMsg('gotorelative:bad'))).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('treats empty value after colon as 0 (Number("") === 0)', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'gotoRelative').mockResolvedValue(undefined);
    const handler = createGotoRelativeHandler(motor);

    // 'gotorelative:'.split(':')[1] === '' → Number('') === 0 (not NaN)
    await expect(handler(makeMsg('gotorelative:'))).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith(0);
  });

  it('does not throw on NaN input', async () => {
    const motor = await makeMotor();
    vi.spyOn(motor, 'gotoRelative').mockResolvedValue(undefined);
    const handler = createGotoRelativeHandler(motor);

    await expect(handler(makeMsg('gotorelative:xyz'))).resolves.toBeUndefined();
  });
});

// ── createStopAllHandler ─────────────────────────────────────────────────────

describe('createStopAllHandler', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('calls motor.stop()', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'stop').mockResolvedValue(undefined);
    const handler = createStopAllHandler(motor);

    await handler(makeMsg('stop'));

    expect(spy).toHaveBeenCalledOnce();
  });

  it('ignores message data and always calls stop', async () => {
    const motor = await makeMotor();
    const spy = vi.spyOn(motor, 'stop').mockResolvedValue(undefined);
    const handler = createStopAllHandler(motor);

    await handler(makeMsg(''));

    expect(spy).toHaveBeenCalledOnce();
  });

  it('resolves without throwing', async () => {
    const motor = await makeMotor();
    vi.spyOn(motor, 'stop').mockResolvedValue(undefined);
    const handler = createStopAllHandler(motor);

    await expect(handler(makeMsg('stop'))).resolves.toBeUndefined();
  });
});
