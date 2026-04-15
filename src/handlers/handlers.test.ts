import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/event-bus';
import { DeviceStateService } from '../core/device-state';
import { NetworkStateMachine } from '../network/state-machine';
import type { InboundMessage } from '../core/types';
import type { StepperMotor } from '../hardware/stepper-motor';
import type { PTYManager } from '../pty/pty-manager';
import { createMotorHandler, createGotoRelativeHandler, createStopAllHandler } from './motor';
import { createPtyHandler } from './pty';
import {
  createGetDeviceDataHandler,
  createRebootHandler,
  createUpdateHandler,
  createNetworkModeHandler,
} from './system';
import { createWifiListHandler, createShareWifiHandler } from './wifi';
import { createCameraHandler } from './camera';
import { ProgramConfigService } from '../core/program-config';
import { createLoadConfigHandler } from './program-config';
import { DeviceSandboxService } from '../core/device-sandbox';
import { createLoadCodeHandler } from './load-code';
import { MockWifiShellAdapter } from '../wifi/mock-shell-adapter';
import { WifiStateMachine } from '../wifi/wifi-state-machine';
import { WifiManager } from '../wifi/wifi-manager';
import { makeTmpState } from '../test-utils/make-state';
import os from 'os';
import path from 'path';
import fs from 'fs';

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { type: 'command-in', data: '', ackId: 'ack-1', deviceUuid: 'dev-123', ...overrides };
}

// ── Motor handler ────────────────────────────────────────────────

describe('Motor handler', () => {
  it('parses gotoangle:90 and calls motor.gotoAngle(90)', async () => {
    const gotoAngle = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoAngle } as unknown as StepperMotor;
    const handler = createMotorHandler(motor);
    await handler(makeMsg({ data: 'gotoangle:90' }));
    expect(gotoAngle).toHaveBeenCalledWith(90);
  });

  it('parses gotoangle:270 and calls motor.gotoAngle(270)', async () => {
    const gotoAngle = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoAngle } as unknown as StepperMotor;
    const handler = createMotorHandler(motor);
    await handler(makeMsg({ data: 'gotoangle:270' }));
    expect(gotoAngle).toHaveBeenCalledWith(270);
  });

  it('treats gotoangle: (empty after colon) as 0', async () => {
    const gotoAngle = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoAngle } as unknown as StepperMotor;
    const handler = createMotorHandler(motor);
    await handler(makeMsg({ data: 'gotoangle:' }));
    expect(gotoAngle).toHaveBeenCalledWith(0);
  });

  it('ignores gotoangle with NaN (malformed payload)', async () => {
    const gotoAngle = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoAngle } as unknown as StepperMotor;
    const handler = createMotorHandler(motor);
    await handler(makeMsg({ data: 'gotoangle:abc' }));
    expect(gotoAngle).not.toHaveBeenCalled();
  });

  it('ignores gotoangle with NaN (no colon separator)', async () => {
    const gotoAngle = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoAngle } as unknown as StepperMotor;
    const handler = createMotorHandler(motor);
    await handler(makeMsg({ data: 'gotoangle' }));
    expect(gotoAngle).not.toHaveBeenCalled();
  });

  it('parses gotoangle:0 correctly (edge case)', async () => {
    const gotoAngle = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoAngle } as unknown as StepperMotor;
    const handler = createMotorHandler(motor);
    await handler(makeMsg({ data: 'gotoangle:0' }));
    expect(gotoAngle).toHaveBeenCalledWith(0);
  });

  it('parses negative gotoangle:-45 correctly', async () => {
    const gotoAngle = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoAngle } as unknown as StepperMotor;
    const handler = createMotorHandler(motor);
    await handler(makeMsg({ data: 'gotoangle:-45' }));
    expect(gotoAngle).toHaveBeenCalledWith(-45);
  });
});

// ── GotoRelative handler ────────────────────────────────────────

describe('GotoRelative handler', () => {
  it('parses gotorelative:45 and calls motor.gotoRelative(45)', async () => {
    const gotoRelative = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoRelative } as unknown as StepperMotor;
    const handler = createGotoRelativeHandler(motor);
    await handler(makeMsg({ data: 'gotorelative:45' }));
    expect(gotoRelative).toHaveBeenCalledWith(45);
  });

  it('parses negative gotorelative:-30', async () => {
    const gotoRelative = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoRelative } as unknown as StepperMotor;
    const handler = createGotoRelativeHandler(motor);
    await handler(makeMsg({ data: 'gotorelative:-30' }));
    expect(gotoRelative).toHaveBeenCalledWith(-30);
  });

  it('ignores gotorelative with NaN (malformed payload)', async () => {
    const gotoRelative = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoRelative } as unknown as StepperMotor;
    const handler = createGotoRelativeHandler(motor);
    await handler(makeMsg({ data: 'gotorelative:abc' }));
    expect(gotoRelative).not.toHaveBeenCalled();
  });

  it('treats gotorelative: (empty after colon) as 0', async () => {
    const gotoRelative = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoRelative } as unknown as StepperMotor;
    const handler = createGotoRelativeHandler(motor);
    await handler(makeMsg({ data: 'gotorelative:' }));
    expect(gotoRelative).toHaveBeenCalledWith(0);
  });

  it('ignores gotorelative with NaN (no colon separator)', async () => {
    const gotoRelative = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoRelative } as unknown as StepperMotor;
    const handler = createGotoRelativeHandler(motor);
    await handler(makeMsg({ data: 'gotorelative' }));
    expect(gotoRelative).not.toHaveBeenCalled();
  });

  it('parses gotorelative:0 correctly (edge case)', async () => {
    const gotoRelative = vi.fn().mockResolvedValue(undefined);
    const motor = { gotoRelative } as unknown as StepperMotor;
    const handler = createGotoRelativeHandler(motor);
    await handler(makeMsg({ data: 'gotorelative:0' }));
    expect(gotoRelative).toHaveBeenCalledWith(0);
  });
});

// ── Stop handler ─────────────────────────────────────────────────

describe('Stop handler', () => {
  it('calls motor.stop() when stop message received', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const motor = { stop } as unknown as StepperMotor;
    const handler = createStopAllHandler(motor);
    await handler(makeMsg({ type: 'stop', data: '' }));
    expect(stop).toHaveBeenCalledOnce();
  });

  it('resolves even when motor.stop() rejects', async () => {
    const stop = vi.fn().mockRejectedValue(new Error('motor fault'));
    const motor = { stop } as unknown as StepperMotor;
    const handler = createStopAllHandler(motor);
    await expect(handler(makeMsg({ type: 'stop', data: '' }))).rejects.toThrow('motor fault');
    expect(stop).toHaveBeenCalledOnce();
  });
});

// ── PTY handler ──────────────────────────────────────────────────

describe('PTY handler', () => {
  it('writes msg.data to PTYManager', async () => {
    const write = vi.fn();
    const manager = { write } as unknown as PTYManager;
    const handler = createPtyHandler(manager);
    await handler(makeMsg({ type: 'pty-in', data: 'ls -la\r' }));
    expect(write).toHaveBeenCalledWith('ls -la\r');
  });
});

// ── System handlers ──────────────────────────────────────────────

describe('System handlers', () => {
  it('getDeviceData handler emits network:send with device-data-read type', async () => {
    const bus = new EventBus();
    const sentPayloads: unknown[] = [];
    bus.on('network:send', (p) => sentPayloads.push(p.payload));
    const deviceData = { deviceUuid: 'dev-123', ownerUuid: 'owner-456', networkMode: 'client' };
    const state = { get: () => deviceData } as unknown as DeviceStateService;
    const handler = createGetDeviceDataHandler(state, bus);
    await handler(makeMsg({ type: 'getDeviceData', deviceUuid: 'dev-123' }));
    expect(sentPayloads).toHaveLength(1);
    expect((sentPayloads[0] as Record<string, unknown>).type).toBe('device-data-read');
    expect((sentPayloads[0] as Record<string, unknown>).data).toEqual(deviceData);
  });

  it('reboot handler emits system:reboot-requested', async () => {
    const bus = new EventBus();
    const rebootHandler = vi.fn();
    bus.on('system:reboot-requested', rebootHandler);
    await createRebootHandler(bus)(makeMsg({ data: 'reboot' }));
    expect(rebootHandler).toHaveBeenCalledOnce();
  });

  it('update handler emits system:update-requested', async () => {
    const bus = new EventBus();
    const updateHandler = vi.fn();
    bus.on('system:update-requested', updateHandler);
    await createUpdateHandler(bus)(makeMsg({ data: 'update' }));
    expect(updateHandler).toHaveBeenCalledOnce();
  });

  it('networkmode handler patches state.networkMode to client', async () => {
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'dev-123', networkMode: 'ap' });
    const sm    = new NetworkStateMachine(state, bus);
    const handler = createNetworkModeHandler(sm);
    await handler(makeMsg({ type: 'networkmode', data: 'client' }));
    expect(state.get().networkMode).toBe('client');
  });

  it('networkmode handler parses dev:192.168.1.1 and patches devIP', async () => {
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'dev-123', networkMode: 'client' });
    const sm    = new NetworkStateMachine(state, bus);
    const handler = createNetworkModeHandler(sm);
    await handler(makeMsg({ type: 'networkmode', data: 'dev:192.168.1.1' }));
    expect(state.get().networkMode).toBe('dev');
    expect(state.get().devIP).toBe('192.168.1.1');
  });
});

// ── WiFi + Camera stubs ──────────────────────────────────────────

describe('WiFi handlers', () => {
  function makeWifiManager(): { wifiManager: WifiManager; state: DeviceStateService; bus: EventBus; adapter: MockWifiShellAdapter } {
    const bus     = new EventBus();
    const state   = makeTmpState({ deviceUuid: 'dev-123', networkMode: 'client' });
    const adapter = new MockWifiShellAdapter();
    const wifiSM  = new WifiStateMachine(bus);
    const wifiManager = new WifiManager(adapter, state, bus, wifiSM);
    return { wifiManager, state, bus, adapter };
  }

  it('wifiList handler resolves without throwing', async () => {
    const { wifiManager, state, bus } = makeWifiManager();
    const handler = createWifiListHandler(wifiManager, state, bus);
    await expect(handler(makeMsg({ data: 'wifiList' }))).resolves.toBeUndefined();
  });

  it('wifiList handler emits network:send with correct payload structure', async () => {
    const { wifiManager, state, bus, adapter } = makeWifiManager();
    adapter.setScanResults([{ ssid: 'HomeWifi', mac: 'aa:bb:cc', signal: -50 }]);
    const sent: unknown[] = [];
    bus.on('network:send', (p) => sent.push(p));
    const handler = createWifiListHandler(wifiManager, state, bus);
    await handler(makeMsg({ data: 'wifiList' }));
    expect(sent).toHaveLength(1);
    const payload = (sent[0] as any).payload;
    expect(payload.type).toBe('wifiList');
    expect(payload.deviceUuid).toBe('dev-123');
    const data = JSON.parse(payload.data);
    expect(data.uniqueNetworks).toHaveLength(1);
    expect(data.uniqueNetworks[0].ssid).toBe('HomeWifi');
    expect(data.rawNetworks).toHaveLength(1);
    expect(data.knownNetworks).toBeInstanceOf(Array);
  });

  it('share-wifi handler resolves without throwing', async () => {
    const { wifiManager } = makeWifiManager();
    const handler = createShareWifiHandler(wifiManager);
    await expect(handler(makeMsg({ type: 'share-wifi', data: JSON.stringify({ tagUuid: 'test' }) }))).resolves.toBeUndefined();
  });
});

describe('Camera handler', () => {
  it('camera handler resolves without throwing', async () => {
    const bus = new EventBus();
    const handler = createCameraHandler(bus);
    await expect(handler(makeMsg({ type: 'getframe' }))).resolves.toBeUndefined();
  });
});

// ── load-config handler ──────────────────────────────────────────

describe('load-config handler', () => {
  function makeTmpProgramConfig(): ProgramConfigService {
    const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-cfg-handler-'));
    const file = path.join(dir, 'program-config.json');
    return new ProgramConfigService(file);
  }

  it('saves config to ProgramConfigService', async () => {
    const configSvc = makeTmpProgramConfig();
    const motor     = { setConstraints: vi.fn() } as unknown as StepperMotor;
    const handler   = createLoadConfigHandler(configSvc, motor);
    const payload   = { config: { motors: [{ name: 'shoulder', resource: 0, minAngle: -90, maxAngle: 90 }] }, unitId: 'unit-1' };

    await handler(makeMsg({ type: 'load-config', data: JSON.stringify(payload) }));

    expect(configSvc.get().motors?.[0]?.name).toBe('shoulder');
    expect(configSvc.get().unitId).toBe('unit-1');
  });

  it('calls motor.setConstraints from motors[0]', async () => {
    const configSvc = makeTmpProgramConfig();
    const setConstraints = vi.fn();
    const motor = { setConstraints } as unknown as StepperMotor;
    const handler = createLoadConfigHandler(configSvc, motor);
    const payload = { config: { motors: [{ name: 'shoulder', resource: 0, minAngle: -45, maxAngle: 45 }] }, unitId: 'u1' };

    await handler(makeMsg({ type: 'load-config', data: JSON.stringify(payload) }));

    expect(setConstraints).toHaveBeenCalledWith(-45, 45);
  });

  it('does not call setConstraints when motors array is empty', async () => {
    const configSvc = makeTmpProgramConfig();
    const setConstraints = vi.fn();
    const motor = { setConstraints } as unknown as StepperMotor;
    const handler = createLoadConfigHandler(configSvc, motor);
    const payload = { config: {}, unitId: 'u1' };

    await handler(makeMsg({ type: 'load-config', data: JSON.stringify(payload) }));

    expect(setConstraints).not.toHaveBeenCalled();
  });

  it('handles malformed JSON in data without throwing', async () => {
    const configSvc = makeTmpProgramConfig();
    const motor = { setConstraints: vi.fn() } as unknown as StepperMotor;
    const handler = createLoadConfigHandler(configSvc, motor);

    await expect(
      handler(makeMsg({ type: 'load-config', data: 'not json' }))
    ).resolves.toBeUndefined();
  });
});

// ── load-code handler ────────────────────────────────────────────

describe('load-code handler', () => {
  function makeTmpConfig(): { motor: StepperMotor; state: DeviceStateService; sandbox: DeviceSandboxService; bus: EventBus } {
    const state   = makeTmpState({ deviceUuid: 'dev-1' });
    const motor   = { gotoAngle: vi.fn() } as unknown as StepperMotor;
    const sandbox = new DeviceSandboxService();
    const bus     = new EventBus();
    return { motor, state, sandbox, bus };
  }

  it('loads device code into sandbox when data is valid', async () => {
    const { motor, state, sandbox, bus } = makeTmpConfig();
    const handler = createLoadCodeHandler(sandbox, motor, state, bus);
    const code = `onMessage((type) => { motor.gotoAngle(50); });`;
    await handler(makeMsg({
      type: 'load-code',
      data: JSON.stringify({ code, unitId: 'unit-1' }),
    }));
    sandbox.dispatch('go', {});
    expect(vi.mocked(motor.gotoAngle)).toHaveBeenCalledWith(50);
  });

  it('does not throw when data is malformed JSON', async () => {
    const { motor, state, sandbox, bus } = makeTmpConfig();
    const handler = createLoadCodeHandler(sandbox, motor, state, bus);
    await expect(
      handler(makeMsg({ type: 'load-code', data: 'not-json' }))
    ).resolves.not.toThrow();
  });
});
