import { describe, it, expect, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { createApp } from './main';
import { MockGPIODriver } from './hardware/mock-driver';
import { MockWifiShellAdapter } from './wifi/mock-shell-adapter';
import type { PtySpawner } from './pty/pty-manager';
import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Creates a temp data.json with wifiSettings set so wifiManager.initialize()
 * transitions to CONNECTING (not SETUP_MODE), allowing gatewayClient.start()
 * to fire via the wifi:state-changed bus listener.
 */
function makeTmpDataFile(): string {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-main-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify({
    deviceUuid:    'main-test-uuid',
    networkMode:   'client',
    wifiSettings:  { ssid: 'TestNet', password: 'testpass' },
    knownNetworks: [],
    ownerUuid:     null,
    type:          'wifi-motor',
    hardware:      'raspi',
    pingTime:      0,
    devIP:         null,
  }));
  return file;
}

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

/** Options shared by all createApp() calls in these tests. */
function baseOptions(port: number) {
  return {
    driver:              new MockGPIODriver(),
    ptySpawner:          makeNullPtySpawner(),
    gatewayUrl:          `ws://localhost:${port}`,
    dataFilePath:        makeTmpDataFile(),
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
    expect(execCommand).toHaveBeenCalledWith('/home/pi/orobot-firmware/update-reboot.sh', []);
    await app.stop();
    await closeServer(wss);
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
