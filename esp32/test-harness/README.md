# test-harness — local fake gateway + scenario runner

A Node tool that mirrors the production `/device` WebSocket endpoint just
enough to drive ESP32 firmware integration tests without flashing through a
cloud build cycle.

## What this is for

Native PlatformIO unit tests (`pio test -e native`) cover the pure helpers —
URL parsing, UUID v4 formatting, AP SSID derivation. They don't touch the
WebSocket layer because that requires a real socket and a real firmware
state machine.

This harness fills the gap: a Node WS server that speaks the §3 device
protocol, plus scenario scripts that assert correct device behavior. You
flash a firmware build pointed at the harness, the harness watches what the
device does, and CI/dev fail loudly when the protocol breaks.

## Setup

```bash
cd test-harness
npm install
```

## Manual dev: fake-gateway REPL

```bash
npm run fake-gateway
# defaults: ws://0.0.0.0:8090/device
# override: FAKE_GATEWAY_PORT=8091 FAKE_GATEWAY_HOST=127.0.0.1 npm run fake-gateway
```

Then in another shell:

```bash
cd ..
OROBOT_GATEWAY_URL='ws://<your-host-ip>:8090/device' pio run -e esp32dev -t upload
pio device monitor
```

Watch the harness log every inbound frame. From the harness REPL:

- `list` — show connected device UUIDs
- `ping <uuid>` — inject a frame with a fresh `ackId`, expect `message-ack`
- `cmd <uuid> {"type":"...","data":"..."}` — inject any frame
- `quit` — close

Use this when iterating on protocol code: tweak the C++, reflash, watch the
harness for the new behavior. Beats waiting on CI or hitting the prod
gateway.

## Automated scenarios

Each scenario binds its own port, waits for a device connection, drives the
device through a specific protocol path, and exits 0 on PASS / 1 on FAIL.

### `scenarios/handshake.mjs`

Asserts `identify-connection` → `connect-to-user` → `message-ack` echo for a
single injected frame.

```bash
SCENARIO_PORT=8091 npm run scenario:handshake &
# in another shell, build + flash firmware pointed at port 8091:
OROBOT_GATEWAY_URL='ws://<host-ip>:8091/device' pio run -e esp32dev -t upload
```

### `scenarios/ack-echo.mjs`

Stress-tests ackId echo by injecting N=20 frames at 100ms intervals and
asserting every one is acked exactly once.

```bash
SCENARIO_PORT=8092 npm run scenario:ack-echo &
OROBOT_GATEWAY_URL='ws://<host-ip>:8092/device' pio run -e esp32dev -t upload
```

## Limitations

- **Manual flash step.** This harness exercises a *running* device. CI
  automation needs an ESP32 attached to a runner with `esptool` permissions;
  not in scope for this PR.
- **No TLS.** Scenarios run over `ws://` only. Production gateway uses
  `wss://`. Path-level differences (host header, TLS handshake) aren't
  covered here. Test those against staging.
- **Single-device.** Each scenario assumes exactly one device connects.
  Multi-device fan-out tests would need a different rig.

## Adding scenarios

Pattern:
1. Bind a `WebSocketServer` on a configurable port.
2. On `connection`, watch for the protocol step you care about.
3. Inject any prerequisite frames, wait for the response.
4. `process.exit(0)` on PASS, `process.exit(1)` with diagnostics on FAIL.
5. Add an `npm run scenario:<name>` script and document the flash invocation.

Keep scenarios narrow — one per protocol property. A 200-line scenario that
tries to test "everything" hides which property regressed when it fails.
