# orobot-firmware · esp32

Native C++ orobot firmware for ESP32. Sibling to the Node.js Pi/Jetson
firmware in `../src/`. The two code bases do not share source — they share a
protocol (see the sub-4 spec in `robots-gateway/docs/device-protocol.md`).

> **Status:** Scaffolding plus device protocol handlers. WiFi provisioning and
> gateway WebSocket still land in follow-up PRs (#509, #510), but the ESP32
> now has the first command handlers for ping, pin control, pin readback, and
> stepper motion (#511).

## Why a separate port

ESP32 has 4–8 MB flash and 320 KB RAM. Node.js does not realistically run
there. To let makers use ESP32-class hardware with orobot we re-implement the
firmware client in C++/Arduino. The ESP32 behaves as a thin remote actuator:
programs continue to execute server-side in the cloud sandbox; the device
just toggles pins on request.

## Quickstart

You need [PlatformIO CLI](https://docs.platformio.org/en/latest/core/installation/index.html):

```bash
# Build
pio run -e esp32dev

# Flash an ESP32 DevKit connected over USB
pio run -e esp32dev -t upload

# Watch serial at 115200 baud
pio device monitor -e esp32dev
```

Expected serial output after boot:

```
orobot-esp32 boot  firmware=esp32-scaffold-0.0.1
heartbeat 1
heartbeat 2
...
```

The built-in LED on GPIO 2 will toggle at 1 Hz.

## Project layout

```
esp32/
├── platformio.ini      ; Platform, board, framework pin
├── src/
│   └── main.cpp        ; Arduino entry (setup / loop)
└── README.md           ; This file
```

Later PRs add (roughly in order):

- `src/wifi_portal.{cpp,h}` — AP-mode captive portal, NVS-backed creds (#509)
- `src/ws_client.{cpp,h}` — WebSocket client, auth handshake, heartbeat (#510)
- `src/protocol.{cpp,h}` — orobot message parser/dispatcher (#511)
- `test/` — Unity native tests for the parser (#511)

## Supported hardware

Currently: **ESP32 DevKit v1** (the classic, 38-pin, WROOM-32 modules).

Deferred:
- ESP32-S3 — different pin map, revisit after #511.
- ESP32-C3 — RISC-V core, different toolchain path.
- ESP8266 — insufficient resources for TLS + orobot protocol.

## Contributing

Before sending a PR that touches `esp32/**`, run:

```bash
pio check -e esp32dev   # static analysis
pio run   -e esp32dev   # compile
```

CI runs the same two commands on every PR (see
`.github/workflows/esp32-build.yml`).

## Not a replacement for Pi firmware

The Pi/Jetson firmware (`../src/`) stays the reference implementation and
canonical behavior. When protocol questions arise, the Pi firmware wins and
the ESP32 port adapts.

## Hardware bring-up procedure

1. Erase + flash latest firmware: `pio run -e esp32dev -t erase && pio run -e esp32dev -t upload`
2. Join `orobot-setup-XXXX` AP, submit SSID + pass + 6-digit pair code from `orobot.io → Devices → Add device`.
3. Confirm device row appears in Devices page with non-null userUuid.
4. Open or create a Robot. Attach the ESP32. Confirm persistence on reload.
5. Wire bench motor — see "Bench rig" below.
6. Open Program IDE, create program with `motor.gotoAngle(90)` in `onStart`.
7. Test-on-Robot → assign slot → Deploy. Motor turns to 90°.

If step 7 fails, switch firmware build to point at fake-gateway:
`OROBOT_GATEWAY_URL='ws://<host-ip>:8093/device' pio run -e esp32dev -t upload`
then `cd test-harness && npm run scenario:motor-gotoangle`. If scenario passes, the gap is gateway-side; if fails, firmware-side.

### Bench rig (28BYJ-48 + ULN2003)

| ULN2003 pin | ESP32 pin |
|---|---|
| IN1 | GPIO 14 |
| IN2 | GPIO 27 |
| IN3 | GPIO 26 |
| IN4 | GPIO 25 |
| V+ | external 5V |
| GND | external GND + ESP32 GND |

Common-ground the supplies. Do not power motor from USB rail.
