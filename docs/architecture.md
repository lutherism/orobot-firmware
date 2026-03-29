# orobot-firmware Architecture

This document explains how orobot-firmware works. Read this first before making any changes.

---

## Purpose

orobot-firmware is a Node.js process that runs permanently on a Raspberry Pi (or Banana Pi). It does three things:

1. Maintains a persistent WebSocket connection to the cloud gateway (`robots-gateway`)
2. Translates inbound WebSocket messages into hardware actions (motor control, PTY terminal, camera)
3. Manages Wi-Fi connectivity and falls back to a setup hotspot when it can't reach the internet

---

## Boot and process lifecycle

`reboot.sh` is the entry point for the live device. It is:
- Run by cron every minute (`reboot.cron`)
- Run once at system boot

It checks whether `keep-alive.js` is already running with `ps ax | grep`. If not, it launches it:

```bash
sudo node /home/pi/orobot-firmware/scripts/keep-alive.js >> tmp/run.log 2>> tmp/run.log
```

For devices of type `wifi-camera`, it also conditionally launches the Python camera surveillance script (`scripts/python/rpi_camera_surveillance_system.py`).

**Remote update flow:**
When the gateway sends a `command-in: update` message, the firmware runs `update-reboot.sh`:
1. `git pull` — fetch latest code
2. `kill-keep-alive.sh` — stop the running process
3. `reboot.sh` — restart with the new code

All stdout and stderr from `keep-alive.js` goes to `tmp/run.log`.

---

## Network modes

The device operates in one of four modes, stored in `scripts/openroboticsdata/data.json` under the `networkMode` key:

| Mode | Behaviour |
|------|-----------|
| `client` | Connects to the production gateway WebSocket at `wss://robots-gateway.uc.r.appspot.com/` |
| `ap` | Device acts as a Wi-Fi hotspot; a captive portal (Express, port 3006) lets a user enter Wi-Fi credentials |
| `dev` | Connects to a local gateway at a configurable IP — set via a `networkmode:dev:<ip>` WebSocket message |
| `sim` | For testing without a Pi; skips all hardware and Wi-Fi, connects to the `GATEWAY_URL` environment variable |

The mode can be changed at runtime via a WebSocket message from the gateway (`networkmode` message type).

---

## Module map

| File | Responsibility |
|------|---------------|
| `scripts/keep-alive.js` | Main process: WebSocket connection lifecycle, PTY shell management, heartbeat, message dispatch, reconnect loop |
| `scripts/commands.js` | GPIO stepper motor controller; `COMMANDS` dispatch table; serializes operations via FIFOActions |
| `scripts/ap-server.js` | Express server for captive-portal Wi-Fi onboarding (port 3006) |
| `scripts/device-data.js` | Persistent device state; singleton backed by `openroboticsdata/data.json` |
| `scripts/fifo-actions.js` | Promise-based FIFO queue; ensures motor commands run one at a time |
| `scripts/api.js` | HTTP client wrapper (`authRequest`) for calling the gateway REST API |
| `scripts/upload-logs.js` | Uploads `run.log` / `run-err.log` to the gateway once every 24 hours |
| `scripts/parseWifiScanOutput.js` | Parses raw `iwlist wlan0 scan` output into structured `{ssid, mac, security}` objects |
| `scripts/sim-firmware.js` | Mocks `gpio`, `node-pty`, `wifi-control` so `keep-alive.js` runs on non-Pi machines |
| `scripts/sim-test.js` | Integration test harness: forks `sim-firmware.js`, runs a mock gateway, asserts motor-state IPC messages |

---

## Key data flows

### Boot → connect or AP

```
cron / boot
  └─ reboot.sh
       └─ keep-alive.js (if not already running)
            └─ run()         (called after 5s startup delay)
                 ├─ networkMode === 'ap'
                 │    └─ exec switch-to-wifi-ap.sh
                 │         └─ apServerListen()   (start captive portal)
                 │
                 └─ networkMode === 'client'
                      └─ authRequest('/test')    (check internet connectivity)
                           ├─ success → recursiveConnect()
                           │               └─ keepOpenGatewayConnection()
                           │                    └─ WebSocket connect
                           │                         ├─ send: identify-connection {deviceUuid}
                           │                         └─ send: connect-to-user {deviceUuid}
                           │
                           └─ failure → retry wifiCmd, fall back to AP after 3 failures
```

### Inbound WebSocket message

Every inbound message goes through `handleWebSocketMessage()`. Every message gets a `message-ack` response regardless of type.

```
gateway sends message
  └─ handleWebSocketMessage(e)
       ├─ dispatch on messageObj.type / messageObj.data
       │    ├─ 'pty-in'        → ptyProcess.write(data)
       │    ├─ 'command-in'    → COMMANDS.export()
       │    │    (named cmd)        → COMMANDS[data]()
       │    │                       → COMMANDS.stop()
       │    ├─ 'command-in'    → (reboot) exec('reboot')
       │    ├─ 'command-in'    → (update) exec update-reboot.sh
       │    ├─ 'command-in'    → (varyspeed:N) COMMANDS.varySpeed(N)
       │    ├─ 'command-in'    → (wifiList) iwlist scan → client.send(wifiList)
       │    ├─ 'getframe'      → HTTP POST camera snapshot to gateway
       │    ├─ 'networkmode'   → upsertDeviceData() → client.close() → run()
       │    ├─ 'getDeviceData' → client.send(device-data-read)
       │    ├─ 'share-wifi'    → switch to target network → POST creds → switch back
       │    └─ gotoangle:N     → COMMANDS.gotoangle(N)
       │
       └─ client.send({ type: 'message-ack', ackId, deviceUuid })
```

### Heartbeat loop

```
keepOpenGatewayConnection (on WebSocket open)
  └─ intervalHeartbeat()       (runs immediately, then every 8s)
       └─ HTTP POST /device/state
            body: { deviceUuid, payloadJSON: { version, type, pingTime } }
            └─ upsertDeviceData({ lastHeartbeatResponse: Date.now() })
```

A separate ping interval (`setInterval` every 20s) measures round-trip time and stores it in `device-data.json` as `pingTime`.

---

## Core patterns

### FIFOActions (`scripts/fifo-actions.js`)

A Promise queue that ensures motor commands run strictly one at a time.

```js
const fifoActions = new FIFOActions();

// Each command wraps its GPIO work in fifoActions.do():
fifoActions.do(() => new Promise((resolve) => {
  const job = setInterval(() => { /* drive coils */ }, 25);
  setTimeout(() => { clearInterval(job); resolve(); }, 2000);
}));
```

If a second command arrives while the first is running, it waits in the queue. This matters because overlapping GPIO signals to a stepper motor will stall or damage it.

### PTYContainer (`scripts/keep-alive.js`)

Wraps `node-pty` to provide a persistent bash shell. On every `write()` call it:
1. Resets a 5-second watchdog timer
2. If no PTY output arrives before the timer fires, kills and restarts the PTY process

This prevents a hung terminal from silently blocking remote access to the device. The PTY also auto-restarts on `exit` events.

### device-data singleton (`scripts/device-data.js`)

All persistent device state lives in `scripts/openroboticsdata/data.json`. Key fields:

| Field | Type | Meaning |
|-------|------|---------|
| `deviceUuid` | string | Unique device identifier |
| `networkMode` | `'client'`\|`'ap'`\|`'dev'`\|`'sim'` | Current network mode |
| `wifiSettings` | `{ssid, password}` | Active Wi-Fi credentials |
| `knownNetworks` | `[{ssid, mac, password}]` | Previously used networks |
| `ownerUuid` | string | UUID of the registered owner user |
| `type` | string | Device capability type (`wifi-motor`, `wifi-camera`) |
| `hardware` | `'raspi'`\|`'banana'` | Board type; controls GPIO pin assignments |
| `pingTime` | number | Last measured round-trip time to gateway (ms) |
| `devIP` | string | Gateway IP used in `dev` mode |

`upsertDeviceData(patch)` does a synchronous read → merge → write cycle. All modules share the same `singleton` object and read from `singleton.DeviceData` which is refreshed after every upsert.

### Recursive reconnect with backoff (`scripts/keep-alive.js`)

Connection failures are tracked with an `iterations` counter:

| `iterations` | Behaviour |
|-------------|-----------|
| 0–40 | Retry with 2s backoff |
| 40–100 | Re-run `switch-to-wifi-client.sh`, increase backoff to 5s |
| >100 | Set `networkMode: 'ap'`, start captive portal, stop retrying |

A separate `monitor` interval checks `lastHeartbeatResponse` every 200ms and triggers a reconnect if the heartbeat goes stale (no response for >16s).
