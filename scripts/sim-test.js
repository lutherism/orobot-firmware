// Sim integration test — forks sim-firmware.js against a mock gateway WebSocket
// server and verifies that motor commands produce IPC motor-state messages.
const { WebSocketServer } = require('ws');
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

const TIMEOUT_MS = 12000;

// Ensure data.json exists with required sim fields
const dataDir = path.join(__dirname, 'openroboticsdata');
const dataPath = path.join(dataDir, 'data.json');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
fs.writeFileSync(dataPath, JSON.stringify({
  networkMode: 'client',
  deviceUuid: 'sim-test-device',
  knownNetworks: [],
  type: 'wifi-motor',
  hardware: 'raspi'
}));

const wss = new WebSocketServer({ port: 0 });

wss.on('listening', () => {
  const { port } = wss.address();
  console.log(`[sim-test] Mock gateway listening on port ${port}`);

  let passed = false;

  // ----- Test cases -----
  const tests = [
    {
      name: 'gotoangle:90 -> motor-state angle=90',
      command: { type: 'command-in', data: 'gotoangle:90', ackId: 'ack-1' },
      check: (msg) => msg.type === 'motor-state' && msg.angle === 90
    }
  ];
  let testIndex = 0;

  wss.on('connection', (ws) => {
    console.log('[sim-test] Firmware connected');

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'connect-to-user') {
        // Connection handshake complete — start sending test commands
        sendNextTest(ws);
      }
      // Ignore acks and other messages from the firmware
    });

    ws.on('error', (err) => {
      console.error('[sim-test] Gateway WS error:', err.message);
    });
  });

  function sendNextTest(ws) {
    if (testIndex >= tests.length) return;
    const test = tests[testIndex];
    console.log(`[sim-test] Sending command: ${test.command.data}`);
    setTimeout(() => ws.send(JSON.stringify(test.command)), 300);
  }

  // Fork the sim firmware
  const child = fork(path.join(__dirname, 'sim-firmware.js'), [], {
    env: {
      ...process.env,
      NODE_ENV: 'sim',
      GATEWAY_URL: `ws://localhost:${port}`,
      DEVICE_UUID: 'sim-test-device'
    },
    silent: false
  });

  // Listen for IPC motor-state messages
  child.on('message', (msg) => {
    console.log('[sim-test] IPC received:', JSON.stringify(msg));
    const test = tests[testIndex];
    if (test && test.check(msg)) {
      console.log(`[sim-test] PASS: ${test.name}`);
      testIndex++;
      if (testIndex >= tests.length) {
        passed = true;
        finish(0);
      } else {
        // Send next command to the first connected client
        const clients = [...wss.clients];
        if (clients.length) sendNextTest(clients[0]);
      }
    }
  });

  child.on('error', (err) => {
    console.error('[sim-test] Child process error:', err.message);
    finish(1);
  });

  // Hard timeout
  const timer = setTimeout(() => {
    if (!passed) {
      console.error(`[sim-test] FAIL: Timeout after ${TIMEOUT_MS}ms waiting for motor-state`);
      finish(1);
    }
  }, TIMEOUT_MS);

  function finish(code) {
    clearTimeout(timer);
    child.kill();
    wss.close(() => {
      if (code === 0) console.log('==== PASS ====');
      process.exit(code);
    });
  }
});

wss.on('error', (err) => {
  console.error('[sim-test] Server error:', err.message);
  process.exit(1);
});
