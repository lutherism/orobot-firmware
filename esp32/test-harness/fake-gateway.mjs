// Fake gateway for ESP32 firmware integration testing.
//
// Mirrors the device-protocol §3 handshake and ackId echo behavior of the
// real /device endpoint without any of the cloud surface (no auth, no
// Firestore, no PubSub). Point firmware at it by building with:
//
//   OROBOT_GATEWAY_URL='ws://<host-ip>:8090/device' pio run -e esp32dev -t upload
//
// Then `npm run fake-gateway` here. Every inbound frame is logged; outbound
// frames can be injected via REPL or driven from a scenario script that
// imports `connect()`.

import { WebSocketServer } from 'ws';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const PORT = Number(process.env.FAKE_GATEWAY_PORT ?? 8090);
const HOST = process.env.FAKE_GATEWAY_HOST ?? '0.0.0.0';

const wss = new WebSocketServer({ host: HOST, port: PORT, path: '/device' });
const conns = new Map(); // deviceUuid -> ws

let nextAckId = 1;

function log(...args) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}]`, ...args);
}

function send(ws, frame) {
  const json = JSON.stringify(frame);
  log('OUT →', json);
  ws.send(json);
}

wss.on('listening', () => {
  log(`fake-gateway listening on ws://${HOST}:${PORT}/device`);
  log(`override host with FAKE_GATEWAY_HOST, port with FAKE_GATEWAY_PORT`);
});

wss.on('connection', (ws, req) => {
  log(`connection from ${req.socket.remoteAddress}`);
  let deviceUuid = null;

  ws.on('message', (raw) => {
    const text = raw.toString();
    log('IN  ←', text);
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      log('  (not JSON, ignoring)');
      return;
    }

    switch (frame.type) {
      case 'identify-connection':
        deviceUuid = frame.deviceUuid;
        log(`  identified as ${deviceUuid}`);
        break;
      case 'connect-to-user':
        log(`  ${deviceUuid ?? '(unknown)'} subscribing to inbound topic`);
        if (deviceUuid) conns.set(deviceUuid, ws);
        break;
      case 'message-ack':
        log(`  ack ${frame.ackId} from ${frame.deviceUuid}`);
        break;
      case 'device-log':
        log(`  device-log [${frame.level ?? '?'}] ${frame.text ?? ''}`);
        break;
      default:
        log(`  (unhandled type: ${frame.type})`);
    }
  });

  ws.on('close', (code, reason) => {
    log(`disconnect code=${code} reason=${reason || '(none)'}`);
    if (deviceUuid && conns.get(deviceUuid) === ws) conns.delete(deviceUuid);
  });

  ws.on('error', (e) => log('ws error:', e.message));
});

// Simple REPL: type `ping <uuid>` or `cmd <uuid> <json>` to inject frames.
const rl = createInterface({ input: stdin, output: stdout, terminal: false });
log('REPL: `list`, `ping <uuid>`, `cmd <uuid> <json>`, `quit`');
for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const [cmd, ...rest] = trimmed.split(/\s+/);

  if (cmd === 'quit') break;
  if (cmd === 'list') {
    log(`connected: ${[...conns.keys()].join(', ') || '(none)'}`);
    continue;
  }
  if (cmd === 'ping') {
    const uuid = rest[0];
    const ws = conns.get(uuid);
    if (!ws) { log(`no connection for ${uuid}`); continue; }
    send(ws, { type: 'ping', deviceUuid: uuid, ackId: `ack-${nextAckId++}` });
    continue;
  }
  if (cmd === 'cmd') {
    const uuid = rest[0];
    const json = rest.slice(1).join(' ');
    const ws = conns.get(uuid);
    if (!ws) { log(`no connection for ${uuid}`); continue; }
    let payload;
    try { payload = JSON.parse(json); } catch (e) { log('bad json:', e.message); continue; }
    payload.ackId = payload.ackId ?? `ack-${nextAckId++}`;
    send(ws, payload);
    continue;
  }
  log(`unknown command: ${cmd}`);
}

wss.close();
process.exit(0);
