import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { GatewayClient, SleepFn } from './gateway-client';
import { EventBus } from '../core/event-bus';
import { DeviceStateService } from '../core/device-state';
import { MessageHandlerRegistry } from '../handlers/registry';
import { makeTmpStateFile } from '../test-utils/make-state';

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
    const state    = new DeviceStateService(makeTmpStateFile({ deviceUuid: 'test-device-uuid' }));
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);
    const client   = new GatewayClient(
      bus, state, registry,
      (url, proto) => new WebSocket(url, proto),
      `ws://localhost:${port}`,
    );

    try {
      client.start();
      const msgs = await handshakePromise;

      expect(msgs).toContainEqual({ type: 'identify-connection', deviceUuid: 'test-device-uuid', platform: 'pi' });
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
    const state    = new DeviceStateService(makeTmpStateFile({ deviceUuid: 'test-device-uuid' }));
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
    const state    = new DeviceStateService(makeTmpStateFile({ deviceUuid: 'test-device-uuid' }));
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
    const state    = new DeviceStateService(makeTmpStateFile({ deviceUuid: 'test-device-uuid' }));
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

      bus.emit('network:send', { payload: { type: 'custom-event', data: '42' } });
      await new Promise((r) => setTimeout(r, 50));

      const custom = allMsgs.find((m) => (m as { type: string }).type === 'custom-event');
      expect(custom).toMatchObject({ type: 'custom-event', data: '42' });
    } finally {
      client.stop();
      await closeServer(wss);
    }
  });

  it('forwards pty:output bus events as pty-out messages', async () => {
    const { wss, port } = await startServer();

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile({ deviceUuid: 'test-device-uuid' }));
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

  it('sends periodic ping frames to keep the connection alive', async () => {
    const { wss, port } = await startServer();
    let pingReceived = false;

    wss.once('connection', (ws) => {
      ws.on('ping', () => { pingReceived = true; });
    });

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile({ deviceUuid: 'test-device-uuid' }));
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);
    const client   = new GatewayClient(
      bus, state, registry,
      (url, proto) => new WebSocket(url, proto),
      `ws://localhost:${port}`,
      undefined,  // device prefix
      50,         // pingIntervalMs — short for test
    );

    const connectedPromise = new Promise<void>((r) => bus.once('network:connected', () => r()));
    try {
      client.start();
      await connectedPromise;
      await new Promise((r) => setTimeout(r, 200)); // wait for at least one ping cycle
      expect(pingReceived).toBe(true);
    } finally {
      client.stop();
      await closeServer(wss);
    }
  });

  it('terminates the connection and emits network:disconnected when no pong is received', async () => {
    // Use a mock wsFactory so we can control pong behavior (ws library auto-pongs real sockets)
    const { EventEmitter } = await import('node:events');
    let terminateCalled = false;
    let closeHandlers: Array<() => void> = [];

    const mockWs = Object.assign(new EventEmitter(), {
      readyState: 1, // WS_OPEN
      send: (_data: string) => {},
      ping: () => {}, // no auto-pong
      close: () => {
        mockWs.readyState = 3;
        closeHandlers.forEach((h) => h());
      },
      terminate: () => {
        terminateCalled = true;
        mockWs.readyState = 3;
        // Emit close event — simulates what ws.terminate() does
        mockWs.emit('close', 1006, Buffer.alloc(0));
      },
    });

    // Capture close listeners so we can fire them manually
    const origOn = mockWs.on.bind(mockWs);
    mockWs.on = (event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'close') closeHandlers.push(handler as () => void);
      return origOn(event, handler);
    };

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile({ deviceUuid: 'test-device-uuid' }));
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);
    const disconnected: string[] = [];
    bus.on('network:disconnected', ({ reason }) => disconnected.push(reason));

    const client = new GatewayClient(
      bus, state, registry,
      (_url, _proto) => {
        // Emit 'open' on next tick to simulate connection
        setTimeout(() => mockWs.emit('open'), 0);
        return mockWs as any;
      },
      'ws://mock',
      undefined, // device prefix
      30,        // pingIntervalMs — short for test
      50,        // pongTimeoutMs — short for test
    );

    const disconnectedPromise = new Promise<void>((r) => bus.once('network:disconnected', () => r()));
    try {
      client.start();
      // Wait for pong timeout (30ms ping + 50ms pong timeout + margin)
      await Promise.race([disconnectedPromise, new Promise<void>((r) => setTimeout(r, 400))]);
      expect(terminateCalled).toBe(true);
      expect(disconnected.length).toBeGreaterThan(0);
    } finally {
      client.stop();
    }
  }, 5000);

  it('doubles backoffMs on each failed connection attempt', async () => {
    const { EventEmitter } = await import('node:events');
    const sleepCalls: number[] = [];
    // Signal each backoff cycle so the test can wait deterministically
    // rather than racing wall-clock timers (which is flaky under slow CI).
    let onSleepCalled: (() => void) | null = null;
    const fakeSleep: SleepFn = (ms) => {
      sleepCalls.push(ms);
      onSleepCalled?.();
      return Promise.resolve();
    };

    // wsFactory that always emits an error — simulates unreachable server.
    // Emit on a microtask (queueMicrotask) so the failure cycle advances
    // without depending on macrotask scheduling under load.
    const makeFailingWs = () => {
      const ws = Object.assign(new EventEmitter(), {
        readyState: 3, // CLOSED
        send: () => {},
        ping: () => {},
        close: () => {},
        terminate: () => {},
      });
      queueMicrotask(() => ws.emit('error', new Error('ECONNREFUSED')));
      return ws;
    };

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile({ deviceUuid: 'test-device-uuid' }));
    const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);
    const client   = new GatewayClient(
      bus, state, registry,
      () => makeFailingWs() as any,
      'ws://unreachable',
      undefined,       // device prefix
      25_000,          // pingIntervalMs (default)
      10_000,          // pongTimeoutMs (default)
      fakeSleep,
    );

    // Wait until at least 3 sleep cycles have happened, with a generous cap.
    const waitForCycles = (n: number) => new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(
        `timeout waiting for ${n} sleep cycles (got ${sleepCalls.length})`,
      )), 2_000);
      onSleepCalled = () => {
        if (sleepCalls.length >= n) {
          clearTimeout(deadline);
          onSleepCalled = null;
          resolve();
        }
      };
    });

    client.start();
    try {
      await waitForCycles(3);
    } finally {
      client.stop();
    }

    // backoffMs starts at 2000, doubles: 2000 → 4000 → 8000 → ...
    expect(sleepCalls.length).toBeGreaterThanOrEqual(3);
    expect(sleepCalls[0]).toBe(2_000);
    expect(sleepCalls[1]).toBe(4_000);
    expect(sleepCalls[2]).toBe(8_000);
  });

  it('reconnects after server closes the connection', async () => {
    const { wss, port } = await startServer();
    let connectCount = 0;
    wss.on('connection', () => { connectCount++; });

    const bus      = new EventBus();
    const state    = new DeviceStateService(makeTmpStateFile({ deviceUuid: 'test-device-uuid' }));
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
