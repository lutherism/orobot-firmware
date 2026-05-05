import { describe, it, expect, vi } from 'vitest';
import { DeviceSandboxService } from './device-sandbox';
import { EventBus } from './event-bus';
import type { StepperMotor } from '../hardware/stepper-motor';
import type { DeviceStateService } from './device-state';

const mockMotor = {
  gotoAngle: vi.fn().mockResolvedValue(undefined),
} as unknown as StepperMotor;

const mockState = {
  get: () => ({ deviceUuid: 'dev-test' }),
} as unknown as DeviceStateService;

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

  // ── EventBus log() emission — IDE console contract ────────────────────────
  //
  // When device code calls log(), the sandbox must emit network:send on the
  // bus with a device-log envelope so the IDE real-time console can display
  // it. Without these tests the emit path in load() has zero coverage.

  describe('bus log() emission', () => {
    it('emits network:send with device-log envelope when device code calls log()', () => {
      const bus = new EventBus();
      const emitted: unknown[] = [];
      bus.on('network:send', (payload) => emitted.push(payload));

      const svc = new DeviceSandboxService();
      // Run code that calls log() at load time (not inside a handler)
      svc.load(`log('hello from device');`, mockMotor, mockState, bus);

      expect(emitted).toHaveLength(1);
      const event = emitted[0] as { payload: Record<string, unknown> };
      expect(event.payload.type).toBe('device-log');
      expect(event.payload.level).toBe('log');
      expect(event.payload.text).toBe('hello from device');
      expect(event.payload.deviceUuid).toBe('dev-test');
    });

    it('includes all log() args joined by space in the emitted text', () => {
      const bus = new EventBus();
      const emitted: unknown[] = [];
      bus.on('network:send', (payload) => emitted.push(payload));

      const svc = new DeviceSandboxService();
      svc.load(`log('angle', 45, 'deg');`, mockMotor, mockState, bus);

      expect(emitted).toHaveLength(1);
      const event = emitted[0] as { payload: Record<string, unknown> };
      expect(event.payload.text).toBe('angle 45 deg');
    });

    it('serializes object args to JSON in the emitted text', () => {
      const bus = new EventBus();
      const emitted: unknown[] = [];
      bus.on('network:send', (payload) => emitted.push(payload));

      const svc = new DeviceSandboxService();
      svc.load(`log({ speed: 3 });`, mockMotor, mockState, bus);

      expect(emitted).toHaveLength(1);
      const event = emitted[0] as { payload: Record<string, unknown> };
      expect(event.payload.text).toBe('{"speed":3}');
    });

    it('does not emit on the bus when no bus is provided', () => {
      // load() without bus arg — log() should still not throw
      const svc = new DeviceSandboxService();
      expect(() => svc.load(`log('quiet');`, mockMotor, mockState)).not.toThrow();
    });

    it('emits from inside a message handler when dispatch is called', () => {
      const bus = new EventBus();
      const emitted: unknown[] = [];
      bus.on('network:send', (payload) => emitted.push(payload));

      const svc = new DeviceSandboxService();
      svc.load(
        `onMessage(({msg}) => { log('msg received', msg); });`,
        mockMotor,
        mockState,
        bus,
      );

      expect(emitted).toHaveLength(0); // no emission at load time
      svc.dispatch('go', {});
      expect(emitted).toHaveLength(1);
      const event = emitted[0] as { payload: Record<string, unknown> };
      expect(event.payload.type).toBe('device-log');
      expect(event.payload.text).toBe('msg received go');
    });
  });
});
