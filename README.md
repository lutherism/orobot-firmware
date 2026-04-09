# orobot-firmware

> **Note:** This document may lag behind the code. Always read the source before making changes.

Node.js firmware for Raspberry Pi devices on the [Open Robots](https://orobot.io) platform. Maintains a persistent WebSocket connection to the cloud gateway, translates inbound messages into motor and PTY actions, and manages WiFi connectivity with an automatic hotspot fallback.

## Stack

- **Node.js 22** with **TypeScript** (`tsx` for dev, `tsc` for production builds)
- **ws** for WebSocket client connection to `robots-gateway`
- **Express** for the captive-portal WiFi onboarding server (port 3006)
- **node-pty** for persistent PTY shell sessions
- **Vitest** for unit and integration tests
- **PM2** (`ecosystem.config.js`) for process management on-device

## Architecture

```
         Raspberry Pi
┌──────────────────────────────┐
│                              │
│  ┌────────────────────────┐  │
│  │  orobot-firmware       │  │
│  │  (dist/index.js / PM2) │  │
│  │                        │  │         robots-gateway
│  │  ┌──────────────────┐  │  │  WS /   ┌─────────────┐
│  │  │NetworkStateMachine│◄─┼──┼────────►│             │
│  │  └──────────────────┘  │  │         │  gateway    │
│  │         │               │  │  HTTP   │  (GCP)      │
│  │  ┌──────┴──────────┐   │  │◄────────►             │
│  │  │  GatewayClient  │   │  │         └─────────────┘
│  │  │  (heartbeat)    │   │  │
│  │  └─────────────────┘   │  │
│  │                        │  │
│  │  ┌─────────────────┐   │  │
│  │  │ CaptivePortal   │   │  │  HTTP :3006
│  │  │ (WiFi onboarding│◄──┼──┼──────── Browser (AP mode)
│  │  └─────────────────┘   │  │
│  └────────────────────────┘  │
│                              │
│  GPIO / stepper motors       │
│  PTY / bash shell            │
└──────────────────────────────┘
```

## Network Modes

The device runs in one of three modes, stored in `scripts/openroboticsdata/data.json`:

| Mode | Behaviour |
|------|-----------|
| `client` | Connects to the production gateway WebSocket |
| `ap` | Device acts as a WiFi hotspot; captive portal (port 3006) lets a user enter WiFi credentials |
| `dev` | Connects to a local gateway at a configurable IP — set via gateway message or `--local` flag |

After repeated connection failures in `client` mode, the device automatically falls back to `ap` mode.

## Local Development

```bash
npm run dev           # Run against production gateway (mock GPIO/WiFi)
npm run dev:local     # Run against local gateway (localhost:8080)
npm run simulator     # Run the browser-accessible simulator UI
npm run test          # Run all tests once
```

No hardware required — `dev` mode uses `MockGPIODriver` and `MockWifiShellAdapter` in place of real GPIO and `wpa_cli`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run firmware locally against production gateway |
| `npm run dev:local` | Run firmware locally against `localhost:8080` |
| `npm run simulator` | Start the simulator server (`src/simulator/`) |
| `npm run test` | Run Vitest once |
| `npm run build` | Compile TypeScript to `dist/` via `tsc` |
| `npm run build:firmware` | Alias for `build` |

## Testing

```bash
npx vitest run             # run all tests once
npx vitest run --coverage  # with coverage report
npx vitest                 # watch mode
```

Tests live alongside source files (`*.test.ts`). Hardware dependencies (`gpio`, `wpa_cli`) are replaced with mock implementations in `src/hardware/mock-driver.ts` and `src/wifi/mock-shell-adapter.ts`.

## Deployment

Build locally, copy to the Pi, run with PM2:

```bash
npm run build
# copy dist/, public/, package.json, ecosystem.config.js to Pi
pm2 start ecosystem.config.js
```

On the Pi, `pm2 startup` registers PM2 to restart on reboot. `build.sh` at the repo root is a shorthand for `npm run build`.

## Key Directories

```
src/
  core/
    event-bus.ts          # Typed pub/sub event bus — connects all modules
    device-state.ts       # Persistent device state (data.json read/write)
    device-sandbox.ts     # vm.runInContext sandbox for user program code
    program-config.ts     # Read/write program config (motors, poses, sequences)
    logger.ts             # Structured logging (pino)
    types.ts              # Shared TypeScript types
  handlers/
    registry.ts           # Maps incoming WebSocket message types to handlers
    motor.ts              # Motor command handlers (gotoAngle, stop, etc.)
    load-code.ts          # Receive and load user program code into sandbox
    load-config.ts        # Receive and apply program config from gateway
    pty.ts                # PTY (terminal) input/output handlers
    wifi.ts               # WiFi scan, credential, and mode-change handlers
    system.ts             # System commands (reboot, update)
    camera.ts             # Camera frame capture handler
  hardware/
    stepper-motor.ts      # Stepper motor abstraction (gotoAngle, step, sweep)
    gpio-driver.ts        # Real GPIO driver (raspi-gpio)
    mock-driver.ts        # Mock GPIO driver for local dev and tests
  network/
    gateway-client.ts     # WebSocket client — connect, reconnect, send/receive
    heartbeat.ts          # HTTP heartbeat to gateway every 8s
    state-machine.ts      # Connection state machine (connecting/connected/reconnecting)
  wifi/
    wifi-state-machine.ts # WiFi mode transitions (client → ap → dev)
    wifi-manager.ts       # wpa_cli wrapper — connect, scan, AP mode
    captive-portal.ts     # Express server for WiFi onboarding (port 3006)
    mock-shell-adapter.ts # Mock wpa_cli for local dev and tests
  simulator/              # Browser-accessible simulator UI (npm run simulator)
  pty/                    # PTY spawner and session management
  dev/                    # Dev-mode helpers (noop PTY spawner, etc.)
  main.ts                 # App factory — wires all modules together
  index.ts                # Production entry point (start + graceful shutdown)
  dev.ts                  # Dev entry point (mock hardware, local gateway)

portal/
  index.js                # React source for captive portal UI (built → public/index.js)

public/
  index.js                # Built captive portal bundle (served at port 3006)
  index.html              # Captive portal HTML shell

scripts/
  openroboticsdata/
    data.json             # Persistent device state (deviceUuid, networkMode, WiFi creds)
```

## WebSocket Protocol

**Device → gateway handshake:**
1. `identify-connection` — device sends `{ deviceUuid }`
2. `connect-to-user` — gateway associates device with a user session
3. `pty-out` — terminal output streamed to browser
4. `message-ack` — every inbound message is acknowledged
5. HTTP heartbeat every 8s (`POST /device/state` with `{ deviceUuid, payloadJSON }`)

**Inbound message types (gateway → device):**

| Type | Handler | Action |
|------|---------|--------|
| `pty-in` | `pty.ts` | Write to PTY shell |
| `command-in` | `motor.ts` / `system.ts` | Motor command or system action |
| `load-config` | `load-config.ts` | Apply program config (motors, poses, sequences) |
| `load-code` | `load-code.ts` | Load user JS into device sandbox |
| `networkmode` | `wifi.ts` | Switch network mode |
| `getDeviceData` | `wifi.ts` | Return device state |

---

## Pull Request Standards

Every PR merged to `master` must include the following in its description:

### Required PR Fields

**Long-form description**
A clear explanation of what the changes do, why they were made, and any non-obvious implementation decisions. Include relevant module names, WebSocket message types, or hardware interactions affected.

**Short-form digest entry**
A one or two sentence summary suitable for a "What's New" digest. Written for a non-technical audience where possible.

Example:
> Devices now load program code directly on-device and execute motor sequences locally, reducing round-trip latency for multi-motor moves.

**Semver increment**

| Label | When to use |
|-------|-------------|
| `patch` | Bug fixes, log changes, internal refactors — no change to gateway protocol or device behaviour |
| `minor` | New WebSocket message types, new hardware support, new device behaviours — backwards compatible |
| `major` | Breaking changes to the gateway↔device WebSocket protocol requiring coordinated gateway deploy |

**Rollback requirements**

Document whether rolling back this PR requires action beyond re-deploying the previous firmware build. Common cases:

- *None* — previous firmware can be redeployed with no side effects
- *robots-gateway* — list any new WebSocket message types or protocol changes; rolling back firmware while gateway continues sending new message types may cause unhandled-message errors
- *data.json* — note if the new version writes fields to `data.json` that the previous version cannot read; rolling back firmware may leave the device in a mode it cannot exit

### Example PR Description

```
## What changed
Added load-config handler. Gateway can now push program config (motors,
poses, sequences) to the device at deploy time. StepperMotor.setConstraints
applies minAngle/maxAngle from config immediately on receipt. Config is
persisted to program-config.json so it survives reconnects.

## Digest entry
Robot motor limits and movement sequences can now be updated remotely
without restarting the device.

## Semver
minor

## Rollback requirements
Requires robots-gateway >= the version that sends load-config messages.
Rolling back firmware to a version that lacks the load-config handler
while gateway sends load-config is safe — unrecognised message types are
acked and ignored. No data.json changes.
```
