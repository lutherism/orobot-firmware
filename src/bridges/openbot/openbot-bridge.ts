/**
 * OpenBot DIY Differential-Drive Serial Bridge.
 *
 * Connects an OpenBot DIY mobile robot to orobot.io by translating incoming
 * `motor-command` WebSocket messages into `c:<left>,<right>\n` USB-serial
 * commands sent to the on-board Arduino Nano (running openbot.ino).
 *
 * Architecture:
 *   Browser → orobot gateway → WS `/device` → GatewayClient →
 *   MessageHandlerRegistry → OpenBot motor-command handler →
 *   USB serial `/dev/ttyUSB0` → Arduino Nano (L298N) → TT motors
 *
 * Serial protocol (Arduino Nano running openbot.ino):
 *   Sent:  "c:<left>,<right>\n"   — PWM -255..255 (negative = reverse)
 *          "h:<interval_ms>\n"    — Arduino heartbeat keep-alive
 *   Received (not consumed): odometry, sonar, voltage readings
 *
 * Differences from the standard firmware / SO-101 bridge:
 *   - No GPIO motor, PCA9685, PTY, camera, or WiFi handling.
 *   - No Feetech bus — uses USB serial (SerialPort) instead.
 *   - Registers `motor-command` → OpenBot differential-drive serial handler.
 *   - Sends periodic Arduino heartbeat over serial to prevent motor cut-off.
 *   - Platform identifier sent in the WS handshake: 'openbot'.
 *
 * Mockable seams (for tests):
 *   - OpenBotSerialPort (inject OpenBotMockSerialPort)
 *   - WsFactory (inject a test WS factory)
 *   - fetch (inject a mock for claim-request / heartbeat)
 *   - sleepFn (inject a no-op to bypass timer delays in tests)
 *
 * Usage (production):
 *   const bridge = createOpenBotBridge();
 *   await bridge.start();
 *
 * Usage (tests):
 *   const serialPort = new OpenBotMockSerialPort();
 *   const bridge = createOpenBotBridge({ serialPort, gatewayUrl: 'ws://localhost:9999', fetchFn: mockFetch });
 *   await bridge.start();
 */

import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { DeviceStateService } from '../../core/device-state';
import { EventBus } from '../../core/event-bus';
import { MessageHandlerRegistry } from '../../handlers/registry';
import { GatewayClient, type WsFactory } from '../../network/gateway-client';
import { HeartbeatService } from '../../network/heartbeat';
import { NetworkStateMachine } from '../../network/state-machine';
import { OpenBotProductionSerialPort, type OpenBotSerialPort } from './serial-port';
import { createOpenBotMotorCommandHandler } from './motor-command-handler';

// ── Constants ────────────────────────────────────────────────────────────────

const PROD_GATEWAY_HTTP_URL   = 'https://robots-gateway-v2.wl.r.appspot.com';
const CLAIM_POLL_INTERVAL_MS  = 3_000;
const CLAIM_MAX_POLLS         = 100;   // ~5 min
const PLATFORM_ID             = 'openbot';
/** Interval at which we send "h:<ms>\n" to keep Arduino motors alive. */
const ARDUINO_HEARTBEAT_MS    = 500;   // Arduino expects < ~1s

function wsUrlToHttpBase(wsUrl: string): string {
  const u      = new URL(wsUrl);
  const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
  return `${scheme}//${u.host}`;
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface OpenBotBridgeOptions {
  /** USB serial port to the Arduino Nano — defaults to /dev/ttyUSB0. */
  serialPort?: OpenBotSerialPort;
  /** Override the USB device path (when not injecting a full mock). */
  serialPortPath?: string;
  /** Override gateway WS URL (defaults to production). */
  gatewayUrl?: string;
  /** Path to data.json — defaults to scripts/openroboticsdata/data.json. */
  dataFilePath?: string;
  /**
   * Path to the OpenBot bridge config file (openbot-config.json).
   * When present and valid, the claim flow is skipped.
   * Defaults to ~/.orobot/openbot-config.json.
   */
  bridgeConfigPath?: string;
  /** Heartbeat interval in ms for the orobot gateway ping — defaults to 8000. */
  heartbeatIntervalMs?: number;
  /** Inject a fetch implementation (for tests). */
  fetchFn?: typeof fetch;
  /** Inject a WS factory (for tests). */
  wsFactory?: WsFactory;
  /**
   * Sleep function injected for tests — replaces setTimeout-based polling
   * so unit tests don't need to advance fake timers.
   */
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Whether to send the Arduino heartbeat ("h:<ms>\n") on a timer.
   * Defaults to true in production; disable in tests to avoid timer leaks.
   */
  enableArduinoHeartbeat?: boolean;
}

// ── Bridge interface ─────────────────────────────────────────────────────────

export interface OpenBotBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly bus: EventBus;
  readonly state: DeviceStateService;
}

// ── Claim-request flow ────────────────────────────────────────────────────────

interface ClaimRequestResponse {
  claimCode:  string;
  deviceUuid: string;
}

interface BridgeConfig {
  deviceUuid: string;
  gatewayUrl: string;
}

function defaultBridgeConfigPath(): string {
  const home = process.env['HOME'] ?? '/root';
  return path.join(home, '.orobot', 'openbot-config.json');
}

function readBridgeConfig(configPath: string): BridgeConfig | null {
  try {
    const raw    = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as BridgeConfig;
    return parsed.deviceUuid ? parsed : null;
  } catch {
    return null;
  }
}

function writeBridgeConfig(configPath: string, config: BridgeConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

async function runClaimFlow(
  gatewayHttpBase: string,
  gatewayWsUrl:    string,
  bridgeConfigPath: string,
  state:           DeviceStateService,
  fetchFn:         typeof fetch,
  sleepFn:         (ms: number) => Promise<void>,
): Promise<string> {
  console.log('\n=== OpenBot first-run setup ===');
  console.log('Requesting a claim code from orobot.io...');

  const res = await fetchFn(`${gatewayHttpBase}/api/device/claim-request`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name:       'OpenBot DIY',
      deviceType: 'byod',
      byodStyle:  'openbot',
    }),
  });

  if (!res.ok) {
    throw new Error(`claim-request failed: ${res.status} ${await res.text()}`);
  }

  const { claimCode, deviceUuid } = (await res.json()) as ClaimRequestResponse;

  console.log('\n┌─────────────────────────────────────┐');
  console.log(`│  Your claim code is:  ${claimCode.toUpperCase().padEnd(14)}│`);
  console.log('│                                     │');
  console.log('│  Go to orobot.io/devices and enter  │');
  console.log('│  this code to connect your robot.   │');
  console.log('└─────────────────────────────────────┘\n');

  await state.patch({ deviceUuid, pendingClaimCode: claimCode });

  for (let i = 0; i < CLAIM_MAX_POLLS; i++) {
    await sleepFn(CLAIM_POLL_INTERVAL_MS);
    try {
      const poll = await fetchFn(`${gatewayHttpBase}/api/device/${deviceUuid}/claimed`);
      if (poll.ok) {
        await state.patch({ pendingClaimCode: null });
        writeBridgeConfig(bridgeConfigPath, { deviceUuid, gatewayUrl: gatewayWsUrl });
        console.log('Device claimed successfully — connecting to gateway...\n');
        return deviceUuid;
      }
    } catch { /* network hiccup — keep polling */ }
  }

  throw new Error('Claim not confirmed after maximum polls — re-run the bridge to try again');
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createOpenBotBridge(options: OpenBotBridgeOptions = {}): OpenBotBridge {
  const DEFAULT_DATA_FILE = (() => {
    const dir = process.env['OROBOT_DATA_DIR']
      ?? path.join(__dirname, '../../../scripts/openroboticsdata');
    return path.join(dir, 'data.json');
  })();

  const dataFilePath     = options.dataFilePath     ?? DEFAULT_DATA_FILE;
  const bridgeConfigPath = options.bridgeConfigPath ?? defaultBridgeConfigPath();
  const fetchFn          = options.fetchFn          ?? globalThis.fetch;
  const sleepFn          = options.sleepFn          ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const enableArduinoHeartbeat = options.enableArduinoHeartbeat ?? true;

  const serialPort_: OpenBotSerialPort = new OpenBotProductionSerialPort(
    options.serialPortPath ?? '/dev/ttyUSB0',
  );
  const serial = options.serialPort ?? serialPort_;

  const state    = new DeviceStateService(dataFilePath);
  const eventBus = new EventBus();

  const networkSM = new NetworkStateMachine(state, eventBus);

  const registry = new MessageHandlerRegistry(eventBus, () => state.get().deviceUuid);
  registry.register('motor-command', createOpenBotMotorCommandHandler(serial));

  const wsFactory: WsFactory = options.wsFactory ?? ((url, proto) => new WebSocket(url, proto));
  const gatewayClient = new GatewayClient(
    eventBus, state, registry, wsFactory, options.gatewayUrl,
    undefined, undefined, undefined, undefined,
    PLATFORM_ID,
  );
  const heartbeat = new HeartbeatService(state, eventBus, fetchFn);
  const hbMs      = options.heartbeatIntervalMs ?? 8_000;

  const unsubscribers: Array<() => void> = [];
  let arduinoHbTimer: ReturnType<typeof setInterval> | null = null;

  function getGatewayHttpBase(): string {
    return options.gatewayUrl
      ? wsUrlToHttpBase(options.gatewayUrl)
      : PROD_GATEWAY_HTTP_URL;
  }

  function getGatewayWsUrl(): string {
    return options.gatewayUrl ?? 'wss://robots-gateway-v2.wl.r.appspot.com/';
  }

  /** Send Arduino heartbeat to prevent motor cut-off on inactivity. */
  function startArduinoHeartbeat(): void {
    if (!enableArduinoHeartbeat || arduinoHbTimer) return;
    arduinoHbTimer = setInterval(() => {
      serial.writeLine(`h:${ARDUINO_HEARTBEAT_MS}`).catch((err: unknown) => {
        console.warn('[openbot] Arduino heartbeat write failed:', err);
      });
    }, ARDUINO_HEARTBEAT_MS);
  }

  function stopArduinoHeartbeat(): void {
    if (arduinoHbTimer) {
      clearInterval(arduinoHbTimer);
      arduinoHbTimer = null;
    }
  }

  return {
    async start(): Promise<void> {
      // Open serial connection to Arduino before any WS messages arrive.
      await serial.open();

      // First-boot: no bridge config → run claim-code flow.
      const existingConfig = readBridgeConfig(bridgeConfigPath);
      if (!existingConfig) {
        const deviceUuid = await runClaimFlow(
          getGatewayHttpBase(),
          getGatewayWsUrl(),
          bridgeConfigPath,
          state,
          fetchFn,
          sleepFn,
        );
        await state.patch({ deviceUuid });
      } else {
        await state.patch({ deviceUuid: existingConfig.deviceUuid });
      }

      unsubscribers.push(
        eventBus.on('network:connected',    () => heartbeat.start(hbMs)),
        eventBus.on('network:disconnected', () => heartbeat.stop()),
      );

      // OpenBot uses client mode only — no WiFi state machine needed.
      void networkSM;

      // Start the Arduino heartbeat so motors don't cut out on the first connection.
      startArduinoHeartbeat();

      gatewayClient.start();
    },

    async stop(): Promise<void> {
      stopArduinoHeartbeat();
      unsubscribers.forEach((fn) => fn());
      unsubscribers.length = 0;
      gatewayClient.stop();
      heartbeat.stop();
      // Safety: stop motors before closing the serial port.
      try { await serial.writeLine('c:0,0'); } catch { /* best-effort */ }
      await serial.close();
    },

    get bus()   { return eventBus; },
    get state() { return state; },
  };
}
