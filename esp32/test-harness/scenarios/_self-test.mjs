// Self-test: spawns the handshake scenario and a mock device that performs
// the §3 handshake correctly, asserts scenario exits 0. Then spawns a broken
// mock device (skips connect-to-user) and asserts scenario exits 1.
//
// This validates the *harness*, not the firmware. Run it whenever you touch
// scenario assertion logic.

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SCENARIO = fileURLToPath(new URL('./handshake.mjs', import.meta.url));

async function runWithMock(mockBehavior, expectedExitCode, label) {
  const port = 9000 + Math.floor(Math.random() * 1000);
  const proc = spawn('node', [SCENARIO], {
    env: { ...process.env, SCENARIO_PORT: String(port), SCENARIO_TIMEOUT_MS: '5000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stdout += d.toString(); });
  // Capture exit at spawn time, not after — once-listener attached late misses past events.
  const exitPromise = new Promise((res) => proc.once('exit', res));
  await delay(1500);

  let ws;
  let lastErr;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}/device`);
      await new Promise((res, rej) => {
        ws.once('open', res);
        ws.once('error', rej);
      });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await delay(100);
    }
  }
  if (lastErr) {
    console.error(`[self-test:${label}] connect failed:`, lastErr.message);
  } else {
    try { await mockBehavior(ws); } catch (e) {
      console.error(`[self-test:${label}] mock error:`, e.message);
    }
  }

  const exitCode = await Promise.race([
    exitPromise,
    delay(15000).then(() => { proc.kill('SIGKILL'); return 'TIMEOUT'; }),
  ]);
  const ok = exitCode === expectedExitCode;
  console.log(`[self-test:${label}] exit=${exitCode} (expected ${expectedExitCode}) ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) console.log('  scenario stdout/stderr:\n' + stdout.split('\n').map(l=>'    '+l).join('\n'));
  if (!ok) {
    console.log('  scenario output:');
    console.log(stdout.split('\n').map((l) => '    ' + l).join('\n'));
  }
  return ok;
}

const uuid = '00000000-0000-4000-8000-000000000001';

// Good device: identify, connect, ack any inbound with matching ackId.
const goodMock = async (ws) => {
  ws.send(JSON.stringify({ type: 'identify-connection', deviceUuid: uuid }));
  await delay(50);
  ws.send(JSON.stringify({ type: 'connect-to-user', deviceUuid: uuid }));
  ws.on('message', (raw) => {
    const f = JSON.parse(raw.toString());
    if (f.ackId) {
      ws.send(JSON.stringify({ type: 'message-ack', deviceUuid: uuid, ackId: f.ackId }));
    }
  });
  await delay(2000);
  ws.close();
};

// Broken device: identifies but never sends connect-to-user. Scenario must
// fail (timeout).
const brokenMock = async (ws) => {
  ws.send(JSON.stringify({ type: 'identify-connection', deviceUuid: uuid }));
  await delay(2500);
  ws.close();
};

const r1 = await runWithMock(goodMock, 0, 'good-device');
const r2 = await runWithMock(brokenMock, 1, 'broken-device');

if (r1 && r2) {
  console.log('[self-test] all checks PASS');
  process.exit(0);
} else {
  console.error('[self-test] FAIL');
  process.exit(1);
}
