import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { GatewayClient } from './gateway-client';
import { EventBus } from '../core/event-bus';
import { DeviceStateService } from '../core/device-state';
import { MessageHandlerRegistry } from '../handlers/registry';
import os from 'os';
import path from 'path';
import fs from 'fs';

function makeTmpStateFile(): string {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-gw-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify({
    deviceUuid:    'test-device-uuid',
    networkMode:   'client',
    wifiSettings:  null,
    knownNetworks: [],
    ownerUuid:     null,
    type:          'wifi-motor',
    hardware:      'raspi',
    pingTime:       0,
    devIP:          null,
  }));
  return file;
}

/** Starts a WebSocketServer on a random port and returns { wss, port }. */
async function startServer(): Promise<{ wss: WebSocketServer; port: number }> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.once('listening', () => {
      const port = (wss.address() as { port: number }).port;
      resolve({ wss, port });
    });
  });
}

/** Resolves with array of messages once `count` messages arrive from the first connection. */
function waitForMessages(wss: WebSocketServer, count: number): Promise<object[]> {
  return new Promise((resolve) => {
    const msgs: object[] = [];
    wss.once('connection', (ws) => {
      ws.on('message', (data) => {
        msgs.push(JSON.parse(data.toString()));
        if (msgs.length >= count) resolve(msgs);
      });
    });
  });
}

/** Closes a WebSocketServer. */
function closeServer(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => wss.close(() => resolve()));
}

describe('GatewayClient', () => {
  it('connects to the given URL and sends identify-connection + connect-to-user', async () => {
    const { wss, port } = await startServer();
    const handshakePromise = waitForMessages(wss, 2);

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile());
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);
    const client   = new GatewayClient(
      bus, state, registry,
      (url, proto) => new WebSocket(url, proto),
      `ws://localhost:${port}`,
    );

    try {
      client.start();
      const msgs = await handshakePromise;

      expect(msgs).toContainEqual({ type: 'identify-connection', deviceUuid: 'test-device-uuid' });
      expect(msgs).toContainEqual({ type: 'connect-to-user',     deviceUuid: 'test-device-uuid' });
    } finally {
      client.stop();
      await closeServer(wss);
    }
  });

  it('emits network:connected on successful open', async () => {
    const { wss, port } = await startServer();
    const connectedUrls: string[] = [];
    const bus      = new EventBus();
    bus.on('network:connected', ({ url }) => connectedUrls.push(url));
    const state    = new DeviceStateService(makeTmpStateFile());
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);
    const client   = new GatewayClient(
      bus, state, registry,
      (url, proto) => new WebSocket(url, proto),
      `ws://localhost:${port}`,
    );

    try {
      const handshakePromise = waitForMessages(wss, 2);
      client.start();
      await handshakePromise;

      expect(connectedUrls).toHaveLength(1);
      expect(connectedUrls[0]).toBe(`ws://localhost:${port}`);
    } finally {
      client.stop();
      await closeServer(wss);
    }
  });

  it('dispatches inbound messages to the registry', async () => {
    const { wss, port } = await startServer();
    const dispatched: object[] = [];

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile());
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);
    registry.register('test-type', async (msg) => { dispatched.push(msg); });

    const client = new GatewayClient(
      bus, state, registry,
      (url, proto) => new WebSocket(url, proto),
      `ws://localhost:${port}`,
    );

    // Wait for connection, then send a message from the server side
    const serverSentPromise = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => {
        ws.once('message', () => {   // wait for first client message (identify-connection)
          ws.send(JSON.stringify({ type: 'test-type', data: 'hello', ackId: 'a1', deviceUuid: 'test-device-uuid' }));
          resolve();
        });
      });
    });

    try {
      client.start();
      await serverSentPromise;
      // Give registry.dispatch() a tick to run
      await new Promise((r) => setTimeout(r, 50));

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]).toMatchObject({ type: 'test-type', data: 'hello' });
    } finally {
      client.stop();
      await closeServer(wss);
    }
  });

  it('forwards network:send bus events to the gateway', async () => {
    const { wss, port } = await startServer();

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile());
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);

    // Collect messages after the handshake (first 2)
    const allMsgs: object[] = [];
    wss.once('connection', (ws) => {
      ws.on('message', (data) => allMsgs.push(JSON.parse(data.toString())));
    });

    const client = new GatewayClient(
      bus, state, registry,
      (url, proto) => new WebSocket(url, proto),
      `ws://localhost:${port}`,
    );

    // Wait for connection before emitting
    const connectedPromise = new Promise<void>((r) => bus.once('network:connected', () => r()));
    try {
      client.start();
      await connectedPromise;

      bus.emit('network:send', { payload: { type: 'custom-event', value: 42 } });
      await new Promise((r) => setTimeout(r, 50));

      const custom = allMsgs.find((m) => (m as { type: string }).type === 'custom-event');
      expect(custom).toMatchObject({ type: 'custom-event', value: 42 });
    } finally {
      client.stop();
      await closeServer(wss);
    }
  });

  it('forwards pty:output bus events as pty-out messages', async () => {
    const { wss, port } = await startServer();

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile());
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);

    const allMsgs: object[] = [];
    wss.once('connection', (ws) => {
      ws.on('message', (data) => allMsgs.push(JSON.parse(data.toString())));
    });

    const client = new GatewayClient(
      bus, state, registry,
      (url, proto) => new WebSocket(url, proto),
      `ws://localhost:${port}`,
    );

    const connectedPromise = new Promise<void>((r) => bus.once('network:connected', () => r()));
    try {
      client.start();
      await connectedPromise;

      bus.emit('pty:output', { data: 'hello terminal' });
      await new Promise((r) => setTimeout(r, 50));

      const ptyOut = allMsgs.find((m) => (m as { type: string }).type === 'pty-out');
      expect(ptyOut).toMatchObject({ type: 'pty-out', data: 'hello terminal', deviceUuid: 'test-device-uuid' });
    } finally {
      client.stop();
      await closeServer(wss);
    }
  });

  it('reconnects after server closes the connection', async () => {
    const { wss, port } = await startServer();
    let connectCount = 0;
    wss.on('connection', () => { connectCount++; });

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile());
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);
    const client   = new GatewayClient(
      bus, state, registry,
      (url, proto) => new WebSocket(url, proto),
      `ws://localhost:${port}`,
    );

    // First connection
    const firstConnected = new Promise<void>((r) => bus.once('network:connected', () => r()));
    try {
      client.start();
      await firstConnected;
      expect(connectCount).toBe(1);

      // Close all server-side connections to trigger reconnect
      wss.clients.forEach((ws) => ws.close());

      // Wait for reconnect
      const secondConnected = new Promise<void>((r) => bus.once('network:connected', () => r()));
      await secondConnected;
      expect(connectCount).toBe(2);
    } finally {
      client.stop();
      await closeServer(wss);
    }
  }, 5000);
});
