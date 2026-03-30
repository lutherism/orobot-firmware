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
  it('wifiList handler resolves without throwing', async () => {
    const bus = new EventBus();
    const handler = createWifiListHandler(bus);
    await expect(handler(makeMsg({ data: 'wifiList' }))).resolves.toBeUndefined();
  });

  it('share-wifi handler resolves without throwing', async () => {
    const bus = new EventBus();
    const handler = createShareWifiHandler(bus);
    await expect(handler(makeMsg({ type: 'share-wifi' }))).resolves.toBeUndefined();
  });
});

describe('Camera handler', () => {
  it('camera handler resolves without throwing', async () => {
    const bus = new EventBus();
    const handler = createCameraHandler(bus);
    await expect(handler(makeMsg({ type: 'getframe' }))).resolves.toBeUndefined();
  });
});
