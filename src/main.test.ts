import { describe, it, expect, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsWebSocket } from 'ws';
import { createApp } from './main';
import { MockGPIODriver } from './hardware/mock-driver';
import { MockWifiShellAdapter } from './wifi/mock-shell-adapter';
import type { PtySpawner } from './pty/pty-manager';
import type { WsFactory } from './network/gateway-client';
import { makeTmpStateFile } from './test-utils/make-state';

/** PtySpawner that does nothing — lets PTYManager start without spawning a real shell. */
function makeNullPtySpawner(): PtySpawner {
  return {
    spawn: () => ({
      write: () => {},
      kill:  () => {},
      on:    () => {},
    }),
  };
}

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

/**
 * Returns a WsFactory whose every socket immediately emits 'error' on the next
 * event-loop tick.  Used to exercise the client→AP fallback path without a real
 * network connection or relying on OS-level ECONNREFUSED timing (the previous
 * approach using port 1 was a recurring source of flakiness).
 */
function makeErrorWsFactory(errorMessage = 'connect ECONNREFUSED 127.0.0.1:1'): WsFactory {
  return (_url: string, _proto: string): WsWebSocket => {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const ws = {
      readyState: 3, // CLOSED — never writable
      send:       () => {},
      close:      () => {},
      ping:       () => {},
      terminate:  () => {},
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers[event] ??= [];
        handlers[event].push(handler);
        if (event === 'error') {
          // Fire synchronously on next tick so all handlers are registered first.
          setImmediate(() => {
            const err = Object.assign(new Error(errorMessage), { code: 'ECONNREFUSED' });
            handlers['error']?.forEach((h) => h(err));
          });
        }
      },
    };
    return ws as unknown as WsWebSocket;
  };
}

/** Options shared by all createApp() calls in these tests. */
function baseOptions(port: number) {
  return {
    driver:              new MockGPIODriver(),
    ptySpawner:          makeNullPtySpawner(),
    gatewayUrl:          `ws://localhost:${port}`,
    dataFilePath:        makeTmpStateFile({ deviceUuid: 'main-test-uuid', wifiSettings: { ssid: 'TestNet', password: 'testpass' } }),
    heartbeatIntervalMs: 60_000,
    wifiShellAdapter:    new MockWifiShellAdapter(),
    scanIntervalMs:      60_000, // prevent scans during tests
  };
}

describe('createApp()', () => {
  it('connects to gateway and sends identify-connection + connect-to-user', async () => {
    const { wss, port } = await startServer();

    const received: object[] = [];
    const handshakePromise   = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => {
        ws.on('message', (data) => {
          received.push(JSON.parse(data.toString()));
          if (received.length >= 2) resolve();
        });
      });
    });

    const app = createApp(baseOptions(port));
    try {
      await app.start();
      await handshakePromise;

      expect(received).toContainEqual(expect.objectContaining({ type: 'identify-connection', deviceUuid: 'main-test-uuid' }));
      expect(received).toContainEqual(expect.objectContaining({ type: 'connect-to-user',     deviceUuid: 'main-test-uuid' }));
    } finally {
      await app.stop();
      await closeServer(wss);
    }
  }, 5000);

  it('dispatches inbound message and sends message-ack', async () => {
    const { wss, port } = await startServer();

    const received: object[] = [];
    const ackPromise = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as { type: string };
          received.push(msg);
          if (msg.type === 'connect-to-user') {
            ws.send(JSON.stringify({ type: 'getDeviceData', data: '', ackId: 'ack-42', deviceUuid: 'main-test-uuid' }));
          }
          if (msg.type === 'message-ack') resolve();
        });
      });
    });

    const app = createApp(baseOptions(port));
    try {
      await app.start();
      await ackPromise;

      const ack = received.find((m) => (m as { type: string }).type === 'message-ack');
      expect(ack).toMatchObject({ type: 'message-ack', ackId: 'ack-42' });
    } finally {
      await app.stop();
      await closeServer(wss);
    }
  }, 5000);

  it('stop() returns a Promise that resolves and deenergizes motor coils', async () => {
    const driver        = new MockGPIODriver();
    const { wss, port } = await startServer();
    const app = createApp({ ...baseOptions(port), driver });
    await app.start();
    const stopResult = app.stop();
    // stop() must return a Promise (not undefined)
    expect(stopResult).toBeInstanceOf(Promise);
    await stopResult;
    // After stop(), all motor pins must be 0 (de-energized)
    for (const pin of [17, 18, 22, 27]) {
      expect(driver.pins.get(pin)?.value).toBe(0);
    }
    await closeServer(wss);
  }, 5000);

  it('system:reboot-requested causes execCommand("sudo", ["reboot"])', async () => {
    const { wss, port } = await startServer();
    const execCommand   = vi.fn();
    const app = createApp({ ...baseOptions(port), execCommand });
    await app.start();
    app.bus.emit('system:reboot-requested', {});
    expect(execCommand).toHaveBeenCalledWith('sudo', ['reboot']);
    await app.stop();
    await closeServer(wss);
  }, 5000);

  it('system:update-requested causes execCommand with update-reboot.sh', async () => {
    const { wss, port } = await startServer();
    const execCommand   = vi.fn();
    const app = createApp({ ...baseOptions(port), execCommand });
    await app.start();
    app.bus.emit('system:update-requested', {});
    expect(execCommand).toHaveBeenCalledWith(expect.stringContaining('update-reboot.sh'), []);
    await app.stop();
    await closeServer(wss);
  }, 5000);

  // ── Integration: client → AP fallback ─────────────────────────────────────
  //
  // These tests cover the seam that NODE_ENV=sim leaves unexercised: the full
  // chain from GatewayClient WS error → WifiManager failure counter →
  // WifiStateMachine SETUP_MODE → main.ts handler → adapter.startAP().
  //
  // Under NODE_ENV=sim the RpiWifiShellAdapter is never instantiated, so a
  // regression anywhere in this chain can pass tests but fail on a real Pi.
  // By injecting MockWifiShellAdapter + an unreachable gatewayUrl we exercise
  // every link of the chain in CI regardless of platform.

  it('client→ap fallback: WS ECONNREFUSED triggers SETUP_MODE and startAP()', async () => {
    // Previous implementation pointed at ws://127.0.0.1:1 (privileged port) and
    // waited for a real ECONNREFUSED.  That introduced a timing race: the OS may
    // take variable time to refuse the connection, and the backoff sleep in
    // GatewayClient added further jitter that caused intermittent timeouts in CI.
    //
    // Fix: inject a WsFactory whose sockets immediately emit 'error' — no real
    // network I/O, no OS timer races.  The full chain under test is unchanged:
    //   wsFactory error → GatewayClient emits network:disconnected
    //   → WifiManager increments connectFailures → reaches maxConnectFailures=1
    //   → WifiStateMachine transitions CONNECTING→SETUP_MODE
    //   → adapter.startAP() called
    const wifiAdapter = new MockWifiShellAdapter();

    const app = createApp({
      driver:              new MockGPIODriver(),
      ptySpawner:          makeNullPtySpawner(),
      dataFilePath:        makeTmpStateFile({
        deviceUuid:   'fallback-test-uuid',
        wifiSettings: { ssid: 'TestNet', password: 'testpass' },
      }),
      wifiShellAdapter:    wifiAdapter,
      // One failure is enough to trigger the fallback — keeps the test fast.
      maxConnectFailures:  1,
      heartbeatIntervalMs: 60_000,
      scanIntervalMs:      60_000,
      // No real URL needed — the mock factory ignores it.
      gatewayUrl:          'ws://127.0.0.1:1',
      // Inject deterministic error-emitting WS — avoids real network timing.
      wsFactory:           makeErrorWsFactory(),
      // Skip reconnect backoff delay so the test completes immediately.
      sleepFn:             () => Promise.resolve(),
    });

    // Subscribe to wifi:state-changed BEFORE start() so we don't miss the event.
    const fallbackEvent = new Promise<{ from: string; to: string }>((resolve) => {
      app.bus.on('wifi:state-changed', (e: { from: string; to: string }) => {
        if (e.to === 'SETUP_MODE') resolve(e);
      });
    });

    await app.start();
    const event = await fallbackEvent;

    // WifiStateMachine transitioned from CONNECTING → SETUP_MODE
    expect(event.from).toBe('CONNECTING');
    expect(event.to).toBe('SETUP_MODE');
    // WifiManager called adapter.startAP() — on a real Pi this starts hostapd
    expect(wifiAdapter.startAPCalls).toBe(1);

    await app.stop();
  }, 5000);

  it('client→ap fallback: share-wifi AP SSID is OROBOT-Setup-<tagUuid>', async () => {
    // Verifies the AP SSID format (issue #113 hardening) is preserved through
    // the full integration path: inbound share-wifi message → WifiManager →
    // adapter.pushCredentials with the correct SSID.
    const { wss, port } = await startServer();
    const wifiAdapter = new MockWifiShellAdapter();

    // Use a real server so the gateway client connects — this gives us a
    // connected state where the share-wifi handler can fire.
    const app = createApp({
      ...baseOptions(port),
      wifiShellAdapter: wifiAdapter,
      dataFilePath: makeTmpStateFile({
        deviceUuid:   'ssid-test-uuid',
        wifiSettings: { ssid: 'HomeNet', password: 'secret' },
      }),
    });

    const handshakeDone = new Promise<void>((resolve) => {
      wss.once('connection', (ws) => {
        ws.once('message', () => resolve());
      });
    });

    try {
      await app.start();
      await handshakeDone;

      // Send a share-wifi message through the real WS path — the handler
      // routes it to WifiManager.shareCredentials().
      const sharePayload = JSON.stringify({
        type:       'share-wifi',
        data:       JSON.stringify({ tagUuid: 'tag-abc-123' }),
        deviceUuid: 'ssid-test-uuid',
        ackId:      'ack-share',
      });

      // Wait for the handler to execute: the message crosses a WS boundary so
      // we wait for the pushCalls array to be populated rather than using a
      // fixed timeout.
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error('pushCredentials not called within timeout')), 2000);
        const poll = setInterval(() => {
          if (wifiAdapter.pushCalls.length > 0) {
            clearInterval(poll);
            clearTimeout(deadline);
            resolve();
          }
        }, 10);
        wss.clients.forEach((client) => client.send(sharePayload));
      });

      expect(wifiAdapter.pushCalls).toContainEqual(
        expect.objectContaining({ targetSsid: 'OROBOT-Setup-tag-abc-123' }),
      );
    } finally {
      await app.stop();
      await closeServer(wss);
    }
  }, 5000);

  it('inbound gotoangle:90 message causes hardware:motor-moved with angle 90', async () => {
    const { wss, port } = await startServer();

    const motorMovedPromise = new Promise<{ angle: number }>((resolve) => {
      wss.once('connection', (ws) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString()) as { type: string };
          if (msg.type === 'connect-to-user') {
            ws.send(JSON.stringify({ type: 'command-in', data: 'gotoangle:90', ackId: 'ack-motor', deviceUuid: 'main-test-uuid' }));
          }
        });
      });
    });

    const app = createApp(baseOptions(port));
    const motorMoved = new Promise<{ angle: number }>((resolve) => {
      app.bus.on('hardware:motor-moved', resolve);
    });

    try {
      await app.start();
      const result = await motorMoved;
      expect(result.angle).toBe(90);
    } finally {
      await app.stop();
      await closeServer(wss);
    }
  }, 8000);
});
