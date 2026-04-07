# Extending orobot-firmware

This document explains how to add new functionality to the firmware. Read `docs/architecture.md` first.

---

## 1. Adding a new WebSocket message type

All inbound WebSocket messages are dispatched in `handleWebSocketMessage()` in `scripts/keep-alive.js` (around line 202). Add a new `else if` branch **before the `gotoangle` branch** (around line 277 in `keep-alive.js`) — that branch is a legacy exception with no `messageObj.type` guard. Insert your branch anywhere above it, immediately after the last `else if` that uses `messageObj.type`:

```js
} else if (messageObj.type === 'your-new-type') {
  // your handler logic here
  // optionally send a response:
  client.send(JSON.stringify({
    type: 'your-response-type',
    deviceUuid: singleton.DeviceData.deviceUuid,
    data: JSON.stringify({ /* your payload */ })
  }));
}
```

**Rules:**
- Match on `messageObj.type` for new message types. Only use `messageObj.data` matching for legacy string-based commands.
- The `message-ack` at the bottom of the function fires unconditionally — do not move it inside your branch.
- If your handler is asynchronous (returns a Promise), `message-ack` still fires immediately. That's intentional — the ACK confirms receipt, not completion.

---

## 2. Adding a new motor command

Motor commands live in the `COMMANDS` object in `scripts/commands.js`.

**Step 1:** Add your command to the `COMMANDS` object:

```js
'spin-clockwise': () => {
  return fifoActions.do(() => {
    return new Promise((resolve) => {
      const job = setInterval(() => {
        const orderMappedCoilI = orders[1][ActiveCoil];
        motorsContext.map((m, i) => {
          m.set(orderMappedCoilI === i ? 1 : 0);
        });
        ActiveCoil = (ActiveCoil + 1) % COIL_PINS.length;
      }, 50);                       // interval in ms — lower = faster
      setTimeout(() => {
        clearInterval(job);
        resolve();
        COMMANDS.stop();
        addToCurrentPos(36);        // degrees moved; use negative for counter-clockwise
      }, 2000);                     // duration in ms
    });
  });
},
```

**Rules:**
- Always wrap GPIO work in `fifoActions.do(() => new Promise(...))`. Never write to GPIO pins directly — concurrent signals stall or damage the stepper.
- Call `addToCurrentPos(degrees)` at the end so that `gotoangle` keeps working correctly.
- `orders[0]` = counter-clockwise coil sequence; `orders[1]` = clockwise.

**Step 2:** Wire it to WebSocket dispatch (if needed).

Simple named commands require no extra wiring. The existing `command-in` handler in `keep-alive.js` already does:

```js
COMMANDS.export()
  .then(() => COMMANDS[messageObj.data]())
  .then(() => COMMANDS.stop())
```

So sending `{ type: 'command-in', data: 'spin-clockwise' }` from the gateway will call your command automatically — **as long as the key exists in the `COMMANDS` object**. The dispatch branch has a guard: `COMMANDS[messageObj.data]` must be truthy. If the command isn't dispatching, verify the key name in `COMMANDS` exactly matches the `data` string being sent.

For commands with parameters (e.g., `spin-clockwise:90`), add a dedicated branch in `handleWebSocketMessage`:

```js
} else if (messageObj.type === 'command-in' &&
  messageObj.data.indexOf('spin-clockwise') === 0) {
  const degrees = Number(messageObj.data.split(':')[1]);
  COMMANDS.export()
    .then(() => COMMANDS['spin-clockwise-by'](degrees))
    .then(() => COMMANDS.stop())
    .catch(err => console.error(err));
}
```

---

## 3. Supporting a new hardware board

The `hardware` field in `device-data.json` controls which GPIO pin numbers are used for the stepper motor coils.

In `scripts/commands.js`, extend the board check at the top of the file:

```js
// Before:
if (singleton.DeviceData.hardware === 'banana') {
  COIL_PINS = [0, 1, 3, 2];
} else {
  COIL_PINS = [17, 18, 22, 27];  // raspi default
}

// After (adding a new board):
if (singleton.DeviceData.hardware === 'banana') {
  COIL_PINS = [0, 1, 3, 2];
} else if (singleton.DeviceData.hardware === 'your-board') {
  COIL_PINS = [/* GPIO pin numbers for your board's stepper coils */];
} else {
  COIL_PINS = [17, 18, 22, 27];  // raspi default
}
```

Set the `hardware` field on the device by calling `upsertDeviceData({ hardware: 'your-board' })` during provisioning, or by editing `data.json` directly on the Pi.

Apply the same `if/else if` pattern anywhere else in the codebase where you find `singleton.DeviceData.hardware` checks.

---

## 4. Adding a new device type

The `type` field in `device-data.json` describes what a robot can do. Current values: `wifi-motor`, `wifi-camera`.

**To add a new type:**

1. Choose a name (e.g., `wifi-arm`).

2. If the new type needs an extra process launched at startup, add a block to `reboot.sh`:

```bash
if jq .type $BASEDIR/scripts/openroboticsdata/data.json | grep wifi-arm > /dev/null
then
  armprocess="your-arm-script.js"
  armmakerun="sudo $NODE_BIN $BASEDIR/scripts/your-arm-script.js >> $BASEDIR/tmp/run.log 2>> $BASEDIR/tmp/run.log"
  if ps ax | grep -v grep | grep "$armprocess" > /dev/null
  then
      echo 'Already running arm process' >> $BASEDIR/tmp/run.log;
  else
      echo 'running arm process.'
      echo "$armmakerun" | bash >> $BASEDIR/tmp/run.log &
  fi
fi
```

3. The `type` value is included in every heartbeat payload (`payloadJSON.type`). The gateway and frontend use this to decide which controls to show. Update the gateway/frontend to handle the new type if needed.

Set the type on a device via `upsertDeviceData({ type: 'wifi-arm' })` or by editing `data.json` directly.

---

## 5. Local development without a Pi

You don't need a physical Raspberry Pi to develop or test firmware logic.

**`scripts/sim-firmware.js`** mocks all hardware-specific modules:
- `gpio` — motors are no-ops that call `ready()` immediately
- `node-pty` — PTY is a no-op object
- `wifi-control` — returns empty network list

It then loads `keep-alive.js` normally with `NODE_ENV=sim`. In sim mode, `keep-alive.js` skips all Wi-Fi management and connects directly to `process.env.GATEWAY_URL`.

> **`NODE_ENV=sim` vs `networkMode`:** These are two separate things. `NODE_ENV=sim` is an environment variable that activates the sim code path in `keep-alive.js`, bypassing Wi-Fi entirely. `networkMode` is a field in `data.json` used by the normal (non-sim) code path. The test fixture sets `networkMode: 'client'` as a safe default, but when `NODE_ENV=sim` is set, `networkMode` is ignored.

**`scripts/sim-test.js`** is the integration test harness. It:
1. Writes a test `data.json` with `networkMode: 'client'` and `hardware: 'raspi'`
2. Starts a real `WebSocketServer` on a random port
3. Forks `sim-firmware.js` pointed at that server
4. Waits for the firmware's `connect-to-user` handshake, then sends test commands
5. Listens for IPC `motor-state` messages from the child process
6. Exits `0` on pass, `1` on failure or 12s timeout

**To run the tests:**

```bash
cd orobot-firmware
npm install          # installs mock-require and other deps if not already installed
node scripts/sim-test.js
```

Expected output:
```
[sim-test] Mock gateway listening on port <N>
[sim-test] Firmware connected
[sim-test] Sending command: gotoangle:90
[sim-test] IPC received: {"type":"motor-state","deviceUuid":"sim-test-device","angle":90}
[sim-test] PASS: gotoangle:90 -> motor-state angle=90
==== PASS ====
```

**To add a new test case**, add an entry to the `tests` array in `sim-test.js`:

```js
{
  name: 'spin-clockwise -> motor-state angle=36',
  command: { type: 'command-in', data: 'spin-clockwise', ackId: 'ack-2' },
  check: (msg) => msg.type === 'motor-state' && msg.angle === 36
}
```

The `check` function receives the IPC message sent by `process.send()` inside `commands.js`. Motor commands emit `{ type: 'motor-state', deviceUuid, angle: currentPos }` via `addToCurrentPos`.

---

## 6. Debugging

### Log files

On the Pi, all `keep-alive.js` output goes to:
- `tmp/run.log` — stdout and stderr combined

Logs are uploaded to the gateway and then deleted once every 24 hours by `upload-logs.js`.

To watch logs live on the Pi:
```bash
tail -f /home/pi/orobot-firmware/tmp/run.log
```

### Reading the heartbeat output

After the first successful heartbeat, subsequent ones print as `.` on the same line:

```
[2026-03-29T10:00:00.000Z] heartbeat ..............................
[2026-03-29T10:05:00.000Z] heartbeat ...
```

- Each `.` = one successful heartbeat (every 8s)
- A new timestamp line = the WebSocket connection dropped and reconnected
- A long gap between lines = the device was offline or unreachable

### Common failure modes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Device stuck in AP mode after boot | Connection failed >100 times; Wi-Fi credentials wrong or network unavailable | Check `wifiSettings` in `data.json`; connect to the device hotspot and re-enter credentials |
| PTY shell resets every ~5 seconds | A command sent to the terminal produced no output; the watchdog fired | Check what was sent via `pty-in`; the 5s timer resets on any PTY output |
| Motor command appears ignored | Another command is still running in the FIFO queue | Wait for it to finish, or send a `stop` command first |
| `keep-alive.js` never starts | cron not running, or the node binary path in `reboot.sh` is wrong for the installed nvm version | SSH in, check `ps ax | grep keep-alive`, verify the path in `reboot.sh` matches `which node` |
| `gotoangle` moves to wrong position | `currentPos` has drifted from physical position | Call `COMMANDS.setzero()` to reset the tracked position to 0, then physically align the motor |
| `update` command does nothing | `git pull` failed (no network, or SSH key issue) | Check `tmp/run.log` for the git error; ensure the Pi has network access and the correct git remote |
