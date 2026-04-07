import { describe, it, expect, vi } from 'vitest';
import { DeviceSandboxService } from './device-sandbox';
import type { StepperMotor } from '../hardware/stepper-motor';
import type { DeviceStateService } from './device-state';

const mockMotor = {
  gotoAngle: vi.fn().mockResolvedValue(undefined),
} as unknown as StepperMotor;

const mockState = {} as unknown as DeviceStateService;

describe('DeviceSandboxService', () => {
  it('returns false from dispatch when no code has been loaded', () => {
    const svc = new DeviceSandboxService();
    expect(svc.dispatch('go', {})).toBe(false);
  });

  it('returns false when loaded code registers no handler', () => {
    const svc = new DeviceSandboxService();
    svc.load(`const x = 1;`, mockMotor, mockState);
    expect(svc.dispatch('go', {})).toBe(false);
  });

  it('returns true and calls handler via motor side-effect', () => {
    const motor = {
      gotoAngle: vi.fn().mockResolvedValue(undefined),
    } as unknown as StepperMotor;
    const svc = new DeviceSandboxService();
    svc.load(
      `onMessage(({msg, motor}) => { if (msg === 'go') motor.gotoAngle(99); });`,
      motor,
      mockState,
    );
    const handled = svc.dispatch('go', {});
    expect(handled).toBe(true);
    expect(motor.gotoAngle).toHaveBeenCalledWith(99);
  });

  it('returns true for any type when handler is registered (handler decides what to act on)', () => {
    const svc = new DeviceSandboxService();
    svc.load(`onMessage(({msg, data}) => {});`, mockMotor, mockState);
    expect(svc.dispatch('stop', {})).toBe(true);
  });

  it('clears previous handler when new code is loaded', () => {
    const motor = {
      gotoAngle: vi.fn().mockResolvedValue(undefined),
    } as unknown as StepperMotor;
    const svc = new DeviceSandboxService();
    svc.load(
      `onMessage(({motor}) => { motor.gotoAngle(1); });`,
      motor,
      mockState,
    );
    svc.load(
      `onMessage(({motor}) => { motor.gotoAngle(2); });`,
      motor,
      mockState,
    );
    svc.dispatch('go', {});
    expect(motor.gotoAngle).toHaveBeenCalledTimes(1);
    expect(motor.gotoAngle).toHaveBeenCalledWith(2);
  });

  it('does not throw when sandbox code throws on load', () => {
    const svc = new DeviceSandboxService();
    expect(() => svc.load(`throw new Error('boom');`, mockMotor, mockState)).not.toThrow();
  });

  it('does not throw when message handler throws', () => {
    const svc = new DeviceSandboxService();
    svc.load(`onMessage(() => { throw new Error('handler boom'); });`, mockMotor, mockState);
    expect(() => svc.dispatch('go', {})).not.toThrow();
    expect(svc.dispatch('go', {})).toBe(true);
  });

  it('motors[0].gotoAngle calls the same motor as motor.gotoAngle', () => {
    const motor = {
      gotoAngle: vi.fn().mockResolvedValue(undefined),
    } as unknown as StepperMotor;
    const svc = new DeviceSandboxService();
    svc.load(
      `onMessage(({msg}) => { if (msg === 'test') motors[0].gotoAngle(77); });`,
      motor,
      mockState,
    );
    svc.dispatch('test', {});
    expect(motor.gotoAngle).toHaveBeenCalledWith(77);
  });
});
