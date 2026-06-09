/**
 * Integration tests for the OpenBot serial bridge.
 *
 * Tests verify:
 *   1. Handshake sequence (identify-connection with platform='openbot' + connect-to-user).
 *   2. motor-command dispatch → correct serial string written to mock serial port.
 *   3. message-ack is sent back for every inbound motor-command.
 *   4. First-boot claim-code flow: claim-request POST → display code → poll until claimed.
 *   5. Skips claim flow when bridge config already exists.
 *   6. stop() writes c:0,0 safety stop before closing serial.
 *   7. connect/disconnect cycle — serial port opens on start, closes on stop.
 */

import { describe, it, expect, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createOpenBotBridge } from './openbot-bridge';
import { OpenBotMockSerialPort } from './serial-port';
import { makeTmpStateFile } from '../../test-utils/make-state';
import type { WsFactory } from '../../network/gateway-client';

// ── WS test server helpers ────────────────────────────────────────────────────

async function startServer(): Promise<{ wss: WebSocketServer; port: number }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.once('listening', () => {
      resolve({ wss, port: (wss.address() as { port: number }).port });
    });
  });
}

function closeServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => wss.close(() => resolve()));
}

function collectMessages(ws: WebSocket, count: number): Promise<object[]> {
  return new Promise((resolve) => {
    const received: object[] = [];
    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
      if (received.length >= count) resolve(received);
    });
  });
}

// ── Bridge factory helpers ────────────────────────────────────────────────────

function makeTmpBridgeConfig(deviceUuid: string, gatewayUrl: string): string {
  const dir        = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-ob-test-'));
  const configPath = path.join(dir, 'openbot-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ deviceUuid, gatewayUrl }));
  return configPath;
}

function makeNonExistentConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-ob-test-'));
  return path.join(dir, 'openbot-config.json');
}

function makeBridge(port: number, opts: { deviceUuid?: string } = {}) {
  const serialPort     = new OpenBotMockSerialPort();
  const deviceUuid     = opts.deviceUuid ?? 'openbot-test-uuid';
  const dataFilePath   = makeTmpStateFile({ networkMode: 'client' });
  const bridgeConfigPath = makeTmpBridgeConfig(deviceUuid, `ws://localhost:${port}`);

  const bridge = createOpenBotBridge({
    serialPort,
    gatewayUrl:              `ws://localhost:${port}`,
    dataFilePath,
    bridgeConfigPath,
    heartbeatIntervalMs:     60_000,
    enableArduinoHeartbeat:  false,  // prevent timer leaks in tests
  });

  return { bridge, serialPort, dataFilePath };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OpenBotBridge — WS handshake', () => {
  it('sends identify-connection with platform=openbot and connect-to-user', async () => {
    const { wss, port } = await startServer();

    const handshakePromise = new Promise<object[]>((resolve) => {
      wss.once('connection', (ws) => resolve(collectMessages(ws, 2)));
    });

    const { bridge } = makeBridge(port);
    try {
      await bridge.start();
      const received = await handshakePromise;

      expect(received).toContainEqual(expect.objectContaining({
        type:       'identify-connection',
        deviceUuid: 'openbot-test-uuid',
        platform:   'openbot',
      }));
      expect(received).toContainEqual(expect.objectContaining({
        type:       'connect-to-user',
        deviceUuid: 'openbot-test-uuid',
      }));
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 5_000);
});

describe('OpenBotBridge — motor-command dispatch', () => {
  it('writes c:150,100 to serial and sends message-ack', async () => {
    const { wss, port } = await startServer();

    let serverWs: WebSocket;
    const connectedPromise = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => { serverWs = ws; resolve(); });
    });

    const { bridge, serialPort } = makeBridge(port);
    try {
      await bridge.start();
      await connectedPromise;

      const ackPromise = new Promise<object>((resolve) => {
        serverWs!.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as { type: string };
          if (msg.type === 'message-ack') resolve(msg);
        });
      });

      serverWs!.send(JSON.stringify({
        type:       'motor-command',
        data:       JSON.stringify({ left: 150, right: 100 }),
        ackId:      'drive-ack-1',
        deviceUuid: 'openbot-test-uuid',
      }));

      const ack = await ackPromise;
      expect(ack).toMatchObject({ type: 'message-ack', ackId: 'drive-ack-1' });

      // Serial should have received the drive command
      expect(serialPort.written).toContain('c:150,100');
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 5_000);

  it('clamps out-of-range values to [-255..255] in serial output', async () => {
    const { wss, port } = await startServer();

    let serverWs: WebSocket;
    const connectedPromise = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => { serverWs = ws; resolve(); });
    });

    const { bridge, serialPort } = makeBridge(port);
    try {
      await bridge.start();
      await connectedPromise;

      const ackPromise = new Promise<void>((resolve) => {
        serverWs!.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as { type: string };
          if (msg.type === 'message-ack') resolve();
        });
      });

      serverWs!.send(JSON.stringify({
        type:       'motor-command',
        data:       JSON.stringify({ left: 999, right: -999 }),
        ackId:      'clamp-ack',
        deviceUuid: 'openbot-test-uuid',
      }));

      await ackPromise;

      expect(serialPort.written).toContain('c:255,-255');
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 5_000);

  it('translates "forward" named action to c:200,200', async () => {
    const { wss, port } = await startServer();

    let serverWs: WebSocket;
    const connectedPromise = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => { serverWs = ws; resolve(); });
    });

    const { bridge, serialPort } = makeBridge(port);
    try {
      await bridge.start();
      await connectedPromise;

      const ackPromise = new Promise<void>((resolve) => {
        serverWs!.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as { type: string };
          if (msg.type === 'message-ack') resolve();
        });
      });

      serverWs!.send(JSON.stringify({
        type:       'motor-command',
        data:       JSON.stringify({ action: 'forward' }),
        ackId:      'fwd-ack',
        deviceUuid: 'openbot-test-uuid',
      }));

      await ackPromise;

      expect(serialPort.written).toContain('c:200,200');
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 5_000);
});

describe('OpenBotBridge — connect/disconnect lifecycle', () => {
  it('opens serial port on start() and closes it on stop()', async () => {
    const { wss, port } = await startServer();
    const { bridge, serialPort } = makeBridge(port);

    try {
      expect(serialPort.isOpen).toBe(false);
      await bridge.start();
      expect(serialPort.isOpen).toBe(true);
    } finally {
      await bridge.stop();
      expect(serialPort.isOpen).toBe(false);
      await closeServer(wss);
    }
  }, 5_000);

  it('writes c:0,0 safety stop before closing serial port on stop()', async () => {
    const { wss, port } = await startServer();
    const { bridge, serialPort } = makeBridge(port);

    try {
      await bridge.start();
      serialPort.reset(); // clear handshake writes
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }

    expect(serialPort.written).toContain('c:0,0');
  }, 5_000);
});

describe('OpenBotBridge — first-boot claim flow', () => {
  it('calls claim-request POST when no bridge config exists, then connects', async () => {
    const { wss, port } = await startServer();

    const bridgeConfigPath = makeNonExistentConfigPath();
    const dataFilePath     = makeTmpStateFile({ networkMode: 'client' });

    let claimRequestCalled = false;
    let pollCount = 0;

    const mockFetch = vi.fn(async (url: string) => {
      const urlStr = url.toString();

      if (urlStr.includes('claim-request')) {
        claimRequestCalled = true;
        return {
          ok:   true,
          json: async () => ({ claimCode: 'OB1234', deviceUuid: 'new-ob-uuid' }),
          text: async () => '',
        } as unknown as Response;
      }

      if (urlStr.includes('claimed')) {
        pollCount++;
        return { ok: true } as Response;
      }

      return { ok: true, json: async () => ({}) } as unknown as Response;
    });

    const serialPort = new OpenBotMockSerialPort();
    const sleepFn    = async (_ms: number): Promise<void> => undefined;

    const handshakePromise = new Promise<object[]>((resolve) => {
      wss.once('connection', (ws) => resolve(collectMessages(ws, 2)));
    });

    const bridge = createOpenBotBridge({
      serialPort,
      gatewayUrl:             `ws://localhost:${port}`,
      dataFilePath,
      bridgeConfigPath,
      heartbeatIntervalMs:    60_000,
      enableArduinoHeartbeat: false,
      fetchFn:                mockFetch as unknown as typeof fetch,
      sleepFn,
    });

    try {
      await bridge.start();
      const received = await handshakePromise;

      expect(claimRequestCalled).toBe(true);
      expect(pollCount).toBeGreaterThanOrEqual(1);

      expect(received).toContainEqual(expect.objectContaining({
        type:       'identify-connection',
        deviceUuid: 'new-ob-uuid',
        platform:   'openbot',
      }));

      expect(fs.existsSync(bridgeConfigPath)).toBe(true);
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 10_000);

  it('skips claim flow when bridge config file already exists', async () => {
    const { wss, port } = await startServer();

    const mockFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) } as unknown as Response));
    const serialPort      = new OpenBotMockSerialPort();
    const dataFilePath    = makeTmpStateFile({ networkMode: 'client' });
    const bridgeConfigPath = makeTmpBridgeConfig('existing-ob-uuid', `ws://localhost:${port}`);

    const handshakePromise = new Promise<object[]>((resolve) => {
      wss.once('connection', (ws) => resolve(collectMessages(ws, 2)));
    });

    const bridge = createOpenBotBridge({
      serialPort,
      gatewayUrl:             `ws://localhost:${port}`,
      dataFilePath,
      bridgeConfigPath,
      heartbeatIntervalMs:    60_000,
      enableArduinoHeartbeat: false,
      fetchFn:                mockFetch as unknown as typeof fetch,
    });

    try {
      await bridge.start();
      const received = await handshakePromise;

      const claimCalls = (mockFetch.mock.calls as unknown as Array<[string]>).filter(
        ([url]) => url.includes('claim-request'),
      );
      expect(claimCalls).toHaveLength(0);

      expect(received).toContainEqual(expect.objectContaining({
        type:       'identify-connection',
        deviceUuid: 'existing-ob-uuid',
        platform:   'openbot',
      }));
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 5_000);
});
