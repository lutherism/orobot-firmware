import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../core/event-bus';
import { DeviceStateService } from '../core/device-state';
import { NetworkStateMachine } from '../network/state-machine';
import type { InboundMessage } from '../core/types';
import type { StepperMotor } from '../hardware/stepper-motor';
import type { PTYManager } from '../pty/pty-manager';
import { createMotorHandler } from './motor';
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
import { MockWifiShellAdapter } from '../wifi/mock-shell-adapter';
import { WifiStateMachine } from '../wifi/wifi-state-machine';
import { WifiManager } from '../wifi/wifi-manager';
import os from 'os';
import path from 'path';
import fs from 'fs';

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { type: 'command-in', data: '', ackId: 'ack-1', deviceUuid: 'dev-123', ...overrides };
}

function makeTmpState(networkMode: string): DeviceStateService {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-sys-handler-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify({
    deviceUuid: 'dev-123', networkMode, wifiSettings: null, knownNetworks: [],
    ownerUuid: null, type: 'wifi-motor', hardware: 'raspi', pingTime: 0, devIP: null,
  }));
  return new DeviceStateService(file);
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
    const state = makeTmpState('ap');
    const sm    = new NetworkStateMachine(state, bus);
    const handler = createNetworkModeHandler(sm);
    await handler(makeMsg({ type: 'networkmode', data: 'client' }));
    expect(state.get().networkMode).toBe('client');
  });

  it('networkmode handler parses dev:192.168.1.1 and patches devIP', async () => {
    const bus   = new EventBus();
    const state = makeTmpState('client');
    const sm    = new NetworkStateMachine(state, bus);
    const handler = createNetworkModeHandler(sm);
    await handler(makeMsg({ type: 'networkmode', data: 'dev:192.168.1.1' }));
    expect(state.get().networkMode).toBe('dev');
    expect(state.get().devIP).toBe('192.168.1.1');
  });
});

// ── WiFi + Camera stubs ──────────────────────────────────────────

describe('WiFi handlers', () => {
  function makeWifiManager(): { wifiManager: WifiManager; state: DeviceStateService; bus: EventBus } {
    const bus     = new EventBus();
    const state   = makeTmpState('client');
    const adapter = new MockWifiShellAdapter();
    const wifiSM  = new WifiStateMachine(bus);
    const wifiManager = new WifiManager(adapter, state, bus, wifiSM);
    return { wifiManager, state, bus };
  }

  it('wifiList handler resolves without throwing', async () => {
    const { wifiManager, state, bus } = makeWifiManager();
    const handler = createWifiListHandler(wifiManager, state, bus);
    await expect(handler(makeMsg({ data: 'wifiList' }))).resolves.toBeUndefined();
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
