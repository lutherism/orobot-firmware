// Scenario: after handshake, send load-config (with JSON-stringified inner
// payload mirroring the deploy pipeline emit shape), then send a command-in
// with data="gotoangle:90". Asserts the firmware acks load-config with ok=true
// and acks command-in with ok=true ackType="command-in".
//
// To run: build firmware with OROBOT_GATEWAY_URL='ws://<host-ip>:<port>/device'
// pointing at the SCENARIO_PORT (default 8093), then flash.

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.SCENARIO_PORT ?? 8093);
const TIMEOUT_MS = Number(process.env.SCENARIO_TIMEOUT_MS ?? 30000);

const wss = new WebSocketServer({ host: '0.0.0.0', port: PORT, path: '/device' });
console.log(`[scenario:motor-gotoangle] listening on ws://0.0.0.0:${PORT}/device`);
console.log(`[scenario:motor-gotoangle] flash with OROBOT_GATEWAY_URL='ws://<host-ip>:${PORT}/device'`);

let identifiedUuid = null;
let configAcked = false;
let gotoAcked = false;
let stage = 'awaiting-handshake';

const timer = setTimeout(() => {
  console.error(`[scenario:motor-gotoangle] FAIL: timeout after ${TIMEOUT_MS}ms (stage=${stage})`);
  console.error(`  configAcked=${configAcked} gotoAcked=${gotoAcked}`);
  process.exit(1);
}, TIMEOUT_MS);

wss.on('connection', (ws) => {
  console.log('[scenario:motor-gotoangle] device connected');

  ws.on('message', (raw) => {
    let frame;
    try { frame = JSON.parse(raw.toString()); } catch { return; }

    if (frame.type === 'identify-connection') {
      identifiedUuid = frame.deviceUuid;
      console.log(`  ✓ identify-connection deviceUuid=${identifiedUuid}`);
    } else if (frame.type === 'connect-to-user') {
      console.log(`  ✓ connect-to-user, sending load-config`);
      stage = 'awaiting-load-config-ack';
      // Real deploy pipeline emits data as a JSON-stringified object.
      const innerPayload = JSON.stringify({
        config: {
          motors: [
            { name: 'motor-0', stepPin: 14, dirPin: 15,
              minAngle: 0, maxAngle: 180, homeAngle: 0, stepsPerRev: 200 },
          ],
        },
        unitId: 'scenario-unit-0',
      });
      ws.send(JSON.stringify({
        type: 'load-config',
        data: innerPayload,
        userUuid: '',
        deviceUuid: identifiedUuid,
      }));
    } else if (frame.type === 'message-ack') {
      // Firmware emits two ack frames per request that has an ackId, plus an
      // ack-with-ackType for the command itself. We don't send ackId here, so
      // we only look at the ackType-bearing acks.
      if (frame.ackType === 'load-config' && !configAcked) {
        if (!frame.ok) {
          console.error(`[scenario:motor-gotoangle] FAIL: load-config ok=false data=${frame.data}`);
          process.exit(1);
        }
        configAcked = true;
        console.log(`  ✓ load-config acked (ok=true)`);
        stage = 'awaiting-gotoangle-ack';
        ws.send(JSON.stringify({
          type: 'command-in',
          data: 'gotoangle:90',
          userUuid: '',
          deviceUuid: identifiedUuid,
        }));
      } else if (frame.ackType === 'command-in' && !gotoAcked) {
        if (!frame.ok) {
          console.error(`[scenario:motor-gotoangle] FAIL: command-in ok=false data=${frame.data}`);
          process.exit(1);
        }
        gotoAcked = true;
        console.log(`  ✓ command-in/gotoangle acked (ok=true)`);
        console.log('[scenario:motor-gotoangle] PASS');
        clearTimeout(timer);
        ws.close();
        wss.close();
        process.exit(0);
      }
    }
  });

  ws.on('error', (e) => console.error(`  ws error: ${e.message}`));
});
