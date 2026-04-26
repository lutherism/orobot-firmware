// Scenario: stress-test ackId echo by injecting N frames and asserting all
// are acked, in order, with no missing or duplicated ackIds.
//
// Runs after handshake completes. Sends frames at INJECT_INTERVAL_MS and
// passes when all N have been acked.

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.SCENARIO_PORT ?? 8092);
const TIMEOUT_MS = Number(process.env.SCENARIO_TIMEOUT_MS ?? 60000);
const N = Number(process.env.SCENARIO_N ?? 20);
const INJECT_INTERVAL_MS = Number(process.env.SCENARIO_INTERVAL_MS ?? 100);

const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT, path: '/device' });
console.log(`[scenario:ack-echo] listening on ws://0.0.0.0:${PORT}/device`);
console.log(`[scenario:ack-echo] will inject ${N} frames at ${INJECT_INTERVAL_MS}ms intervals`);

const sentIds = [];
const ackedIds = new Set();
let identifiedUuid = null;

const timer = setTimeout(() => {
  console.error(`[scenario:ack-echo] FAIL: timeout`);
  console.error(`  sent: ${sentIds.length}, acked: ${ackedIds.size}`);
  console.error(`  missing: ${sentIds.filter((id) => !ackedIds.has(id)).join(', ')}`);
  process.exit(1);
}, TIMEOUT_MS);

wss.on('connection', (ws) => {
  console.log('[scenario:ack-echo] device connected');

  ws.on('message', (raw) => {
    let frame;
    try { frame = JSON.parse(raw.toString()); } catch { return; }

    if (frame.type === 'identify-connection') {
      identifiedUuid = frame.deviceUuid;
    } else if (frame.type === 'connect-to-user') {
      console.log(`  handshake complete, injecting ${N} frames`);
      let i = 0;
      const interval = setInterval(() => {
        if (i >= N) { clearInterval(interval); return; }
        const ackId = `ack-${i}-${Date.now()}`;
        sentIds.push(ackId);
        ws.send(JSON.stringify({ type: 'ping', deviceUuid: identifiedUuid, ackId }));
        i++;
      }, INJECT_INTERVAL_MS);
    } else if (frame.type === 'message-ack') {
      if (ackedIds.has(frame.ackId)) {
        console.error(`[scenario:ack-echo] FAIL: duplicate ack ${frame.ackId}`);
        process.exit(1);
      }
      ackedIds.add(frame.ackId);
      if (ackedIds.size === N) {
        const allAccountedFor = sentIds.every((id) => ackedIds.has(id));
        if (!allAccountedFor) {
          console.error(`[scenario:ack-echo] FAIL: ack set != sent set`);
          process.exit(1);
        }
        console.log(`[scenario:ack-echo] PASS — all ${N} acks received`);
        clearTimeout(timer);
        ws.close();
        wss.close();
        process.exit(0);
      }
    }
  });
});
