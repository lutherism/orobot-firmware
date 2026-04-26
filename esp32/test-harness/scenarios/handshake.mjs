// Scenario: assert that a device performs the §3 handshake correctly.
//
// Spins up an ephemeral fake gateway on a random port, waits for a device
// connection, and asserts:
//   1. The first frame is `identify-connection` with a `deviceUuid`.
//   2. The second frame is `connect-to-user` with the same `deviceUuid`.
//   3. After we send a frame with an `ackId`, the device responds with
//      `message-ack` carrying the same `ackId`.
//
// To run: build firmware with OROBOT_GATEWAY_URL='ws://<host-ip>:<port>/device'
// pointing at the port this scenario binds (printed at start), then flash.
// Test passes when all three assertions hold within TIMEOUT_MS.

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.SCENARIO_PORT ?? 8091);
const TIMEOUT_MS = Number(process.env.SCENARIO_TIMEOUT_MS ?? 30000);

const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT, path: '/device' });
console.log(`[scenario:handshake] listening on ws://0.0.0.0:${PORT}/device`);
console.log(`[scenario:handshake] flash ESP32 with OROBOT_GATEWAY_URL='ws://<this-host-ip>:${PORT}/device'`);

const expected = ['identify-connection', 'connect-to-user'];
let received = [];
let identifiedUuid = null;
let ackIdSent = null;
let ackEchoed = false;

const timer = setTimeout(() => {
  console.error(`[scenario:handshake] FAIL: timeout after ${TIMEOUT_MS}ms`);
  console.error(`  received frames: ${JSON.stringify(received)}`);
  console.error(`  identifiedUuid: ${identifiedUuid}`);
  console.error(`  ackEchoed: ${ackEchoed}`);
  process.exit(1);
}, TIMEOUT_MS);

wss.on('connection', (ws) => {
  console.log('[scenario:handshake] device connected');

  ws.on('message', (raw) => {
    const text = raw.toString();
    let frame;
    try { frame = JSON.parse(text); } catch { return; }
    received.push(frame.type);

    if (frame.type === 'identify-connection') {
      if (!frame.deviceUuid) fail(`identify-connection missing deviceUuid: ${text}`);
      identifiedUuid = frame.deviceUuid;
      console.log(`  ✓ identify-connection deviceUuid=${identifiedUuid}`);
    } else if (frame.type === 'connect-to-user') {
      if (frame.deviceUuid !== identifiedUuid) {
        fail(`connect-to-user uuid mismatch: ${frame.deviceUuid} != ${identifiedUuid}`);
      }
      console.log(`  ✓ connect-to-user deviceUuid=${frame.deviceUuid}`);

      ackIdSent = `ack-test-${Date.now()}`;
      const probe = { type: 'ping', deviceUuid: identifiedUuid, ackId: ackIdSent };
      console.log(`  → sending probe with ackId=${ackIdSent}`);
      ws.send(JSON.stringify(probe));
    } else if (frame.type === 'message-ack') {
      if (frame.ackId !== ackIdSent) {
        fail(`message-ack ackId mismatch: got ${frame.ackId}, expected ${ackIdSent}`);
      }
      ackEchoed = true;
      console.log(`  ✓ message-ack ackId=${frame.ackId}`);
      console.log('[scenario:handshake] PASS');
      clearTimeout(timer);
      ws.close();
      wss.close();
      process.exit(0);
    }
  });

  ws.on('error', (e) => fail(`ws error: ${e.message}`));
});

function fail(msg) {
  console.error(`[scenario:handshake] FAIL: ${msg}`);
  clearTimeout(timer);
  process.exit(1);
}
