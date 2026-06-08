/**
 * Integration tests for the SO-101 BYOD bridge.
 *
 * Tests verify:
 *   1. Handshake sequence (identify-connection + connect-to-user with platform='so101').
 *   2. motor-command dispatch → FeetechMockBus servo calls.
 *   3. message-ack is sent back for every inbound message.
 *   4. First-boot claim-code flow: claim-request POST → display code → poll until claimed.
 *   5. Skips claim flow when deviceUuid already exists in state.
 */

import { describe, it, expect, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createSO101Bridge } from './so101-bridge';
import { FeetechMockBus } from './feetech-bus';
import { makeTmpStateFile } from '../../test-utils/make-state';
import type { WsFactory } from '../../network/gateway-client';

// ── WS test server helpers ───────────────────────────────────────────────────

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

/** Collect messages from a server-side WS connection, resolving when `count` arrive. */
function collectMessages(ws: WebSocket, count: number): Promise<object[]> {
  return new Promise((resolve) => {
    const received: object[] = [];
    ws.on('message', (data) => {
      received.push(JSON.parse(data.toString()));
      if (received.length >= count) resolve(received);
    });
  });
}

// ── Shared bridge factory ────────────────────────────────────────────────────

/** Create a temp directory with a pre-existing bridge config (skip claim flow). */
function makeTmpBridgeConfig(deviceUuid: string, gatewayUrl: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-so101-test-'));
  const configPath = path.join(dir, 'so101-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ deviceUuid, gatewayUrl }));
  return configPath;
}

/** Return a path that does NOT exist (triggers first-boot claim flow). */
function makeNonExistentConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-so101-test-'));
  return path.join(dir, 'so101-config.json');
}

function makeBridge(port: number, opts: { deviceUuid?: string } = {}) {
  const mockBus      = new FeetechMockBus();
  const deviceUuid   = opts.deviceUuid ?? 'so101-test-uuid';
  const dataFilePath = makeTmpStateFile({ networkMode: 'client' });
  const bridgeConfigPath = makeTmpBridgeConfig(deviceUuid, `ws://localhost:${port}`);

  const bridge = createSO101Bridge({
    bus:                 mockBus,
    gatewayUrl:          `ws://localhost:${port}`,
    dataFilePath,
    bridgeConfigPath,
    heartbeatIntervalMs: 60_000,
  });

  return { bridge, mockBus, dataFilePath };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SO101Bridge — WS handshake', () => {
  it('sends identify-connection with platform=so101 and connect-to-user', async () => {
    const { wss, port } = await startServer();

    const handshakePromise = new Promise<object[]>((resolve) => {
      wss.once('connection', (ws) => resolve(collectMessages(ws, 2)));
    });

    const { bridge } = makeBridge(port);
    try {
      await bridge.start();
      const received = await handshakePromise;

      expect(received).toContainEqual(expect.objectContaining({
        type: 'identify-connection',
        deviceUuid: 'so101-test-uuid',
        platform: 'so101',
      }));
      expect(received).toContainEqual(expect.objectContaining({
        type: 'connect-to-user',
        deviceUuid: 'so101-test-uuid',
      }));
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 5_000);
});

describe('SO101Bridge — motor-command dispatch', () => {
  it('routes motor-command to the Feetech bus and sends message-ack', async () => {
    const { wss, port } = await startServer();

    let serverWs: WebSocket;
    const connectedPromise = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => { serverWs = ws; resolve(); });
    });

    const { bridge, mockBus } = makeBridge(port);

    try {
      await bridge.start();
      await connectedPromise;

      // Collect message-ack after the handshake
      const ackPromise = new Promise<object>((resolve) => {
        serverWs!.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as { type: string };
          if (msg.type === 'message-ack') resolve(msg);
        });
      });

      // Send a motor-command from the gateway side
      serverWs!.send(JSON.stringify({
        type:       'motor-command',
        data:       JSON.stringify({ joint: 'shoulder_pan', angle: 0 }),
        ackId:      'test-ack-1',
        deviceUuid: 'so101-test-uuid',
      }));

      // Wait for the ack
      const ack = await ackPromise;
      expect(ack).toMatchObject({ type: 'message-ack', ackId: 'test-ack-1' });

      // Servo 1 (shoulder_pan) should have been commanded
      const servo1 = mockBus.servos.get(1);
      expect(servo1).toBeDefined();
      expect(servo1!.calls).toHaveLength(1);
      expect(servo1!.calls[0]!.ticks).toBe(2048); // 0 rad → midpoint
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 5_000);

  it('homes all 6 joints on stop-all command', async () => {
    const { wss, port } = await startServer();

    let serverWs: WebSocket;
    const connectedPromise = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => { serverWs = ws; resolve(); });
    });

    const { bridge, mockBus } = makeBridge(port);

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
        data:       JSON.stringify({ joint: 'all', stop: true }),
        ackId:      'home-ack',
        deviceUuid: 'so101-test-uuid',
      }));

      await ackPromise;

      // All 6 servos should have been commanded
      for (const id of [1, 2, 3, 4, 5, 6]) {
        expect(mockBus.servos.get(id), `servo ${id}`).toBeDefined();
        expect(mockBus.servos.get(id)!.calls).toHaveLength(1);
      }
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 5_000);
});

describe('SO101Bridge — first-boot claim flow', () => {
  it('calls claim-request POST when no bridge config exists, displays code, then connects', async () => {
    const { wss, port } = await startServer();

    // No bridge config file → claim flow runs
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
          json: async () => ({ claimCode: 'ABC123', deviceUuid: 'new-device-uuid' }),
          text: async () => '',
        } as unknown as Response;
      }

      if (urlStr.includes('claimed')) {
        pollCount++;
        // Confirm claim on the first poll
        return { ok: true } as Response;
      }

      // Heartbeat calls
      return { ok: true, json: async () => ({}) } as unknown as Response;
    });

    const mockBus = new FeetechMockBus();
    // No-op sleep so the test doesn't block on real timers
    const sleepFn = async (_ms: number): Promise<void> => undefined;

    const handshakePromise = new Promise<object[]>((resolve) => {
      wss.once('connection', (ws) => resolve(collectMessages(ws, 2)));
    });

    const bridge = createSO101Bridge({
      bus:                 mockBus,
      gatewayUrl:          `ws://localhost:${port}`,
      dataFilePath,
      bridgeConfigPath,
      heartbeatIntervalMs: 60_000,
      fetchFn:             mockFetch as unknown as typeof fetch,
      sleepFn,
    });

    try {
      await bridge.start();
      const received = await handshakePromise;

      expect(claimRequestCalled).toBe(true);
      expect(pollCount).toBeGreaterThanOrEqual(1);

      // Should have connected with the newly registered UUID
      expect(received).toContainEqual(expect.objectContaining({
        type:       'identify-connection',
        deviceUuid: 'new-device-uuid',
        platform:   'so101',
      }));

      // Bridge config file should now exist on disk
      expect(fs.existsSync(bridgeConfigPath)).toBe(true);
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 10_000);

  it('skips claim flow when bridge config file already exists', async () => {
    const { wss, port } = await startServer();

    const mockFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) } as unknown as Response));
    const mockBus   = new FeetechMockBus();
    const dataFilePath     = makeTmpStateFile({ networkMode: 'client' });
    // Pre-existing bridge config → no claim-request
    const bridgeConfigPath = makeTmpBridgeConfig('existing-uuid', `ws://localhost:${port}`);

    const handshakePromise = new Promise<object[]>((resolve) => {
      wss.once('connection', (ws) => resolve(collectMessages(ws, 2)));
    });

    const bridge = createSO101Bridge({
      bus:                 mockBus,
      gatewayUrl:          `ws://localhost:${port}`,
      dataFilePath,
      bridgeConfigPath,
      heartbeatIntervalMs: 60_000,
      fetchFn:             mockFetch as unknown as typeof fetch,
    });

    try {
      await bridge.start();
      const received = await handshakePromise;

      // claim-request should NOT have been called
      const claimCalls = (mockFetch.mock.calls as unknown as Array<[string]>).filter(
        ([url]) => url.includes('claim-request'),
      );
      expect(claimCalls).toHaveLength(0);

      // Should connect with the existing UUID from the config file
      expect(received).toContainEqual(expect.objectContaining({
        type:       'identify-connection',
        deviceUuid: 'existing-uuid',
      }));
    } finally {
      await bridge.stop();
      await closeServer(wss);
    }
  }, 5_000);
});
