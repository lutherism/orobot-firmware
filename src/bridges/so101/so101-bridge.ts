/**
 * SO-101 Feetech STS3215 BYOD Bridge.
 *
 * Connects an SO-101 arm to orobot.io by reusing the firmware's existing
 * GatewayClient, MessageHandlerRegistry, EventBus, and DeviceStateService.
 *
 * Differences from the standard firmware:
 *   - No GPIO motor, PCA9685, PTY, camera, or WiFi handling.
 *   - Registers `motor-command` → SO-101 Feetech joint handler.
 *   - First-boot: if no deviceUuid is in data.json, calls
 *     POST /api/device/claim-request to get a claim code, displays it in the
 *     terminal, and polls until the user claims the device in the browser.
 *   - Platform identifier sent in the WS handshake: 'so101'.
 *
 * Mockable seams:
 *   - FeetechBus (inject FeetechMockBus in tests)
 *   - WsFactory (inject a test WS factory to avoid real network)
 *   - fetch (inject a mock for claim-request/poll in tests)
 *
 * Usage (production):
 *   const bridge = createSO101Bridge();
 *   await bridge.start();
 *
 * Usage (tests):
 *   const bus = new FeetechMockBus();
 *   const bridge = createSO101Bridge({ bus, gatewayUrl: 'ws://localhost:9999', fetchFn: mockFetch });
 *   await bridge.start();
 */

import { WebSocket } from 'ws';
import fs from 'fs';
import { DeviceStateService } from '../../core/device-state';
import { EventBus } from '../../core/event-bus';
import { MessageHandlerRegistry } from '../../handlers/registry';
import { GatewayClient, type WsFactory } from '../../network/gateway-client';
import { HeartbeatService } from '../../network/heartbeat';
import { NetworkStateMachine } from '../../network/state-machine';
import { FeetechProductionBus, type FeetechBus } from './feetech-bus';
import { createMotorCommandHandler } from './motor-command-handler';
import path from 'path';

// ── Constants ────────────────────────────────────────────────────────────────

const PROD_GATEWAY_HTTP_URL = 'https://robots-gateway-v2.wl.r.appspot.com';
const CLAIM_POLL_INTERVAL_MS = 3_000;
const CLAIM_MAX_POLLS = 100; // ~5 min
const PLATFORM_ID = 'so101';

function wsUrlToHttpBase(wsUrl: string): string {
  const u = new URL(wsUrl);
  const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
  return `${scheme}//${u.host}`;
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface SO101BridgeOptions {
  /** Feetech bus implementation — defaults to FeetechProductionBus on /dev/ttyACM0. */
  bus?: FeetechBus;
  /** Serial port for the production bus (overrides default /dev/ttyACM0). */
  serialPort?: string;
  /** Override gateway WS URL (defaults to production). */
  gatewayUrl?: string;
  /** Path to data.json — defaults to scripts/openroboticsdata/data.json. */
  dataFilePath?: string;
  /**
   * Path to the SO-101 bridge config file (so101-config.json).
   * When present and valid, the claim flow is skipped.
   * Defaults to ~/.orobot/so101-config.json.
   */
  bridgeConfigPath?: string;
  /** Heartbeat interval in ms — defaults to 8000. */
  heartbeatIntervalMs?: number;
  /** Inject a fetch implementation (for tests). */
  fetchFn?: typeof fetch;
  /** Inject a WS factory (for tests). */
  wsFactory?: WsFactory;
  /** Default servo movement speed in ticks/s (0 = max). */
  servoSpeed?: number;
  /**
   * Sleep function injected for tests — replaces setTimeout-based polling
   * so unit tests don't need to advance fake timers.
   */
  sleepFn?: (ms: number) => Promise<void>;
}

// ── Bridge interface ─────────────────────────────────────────────────────────

export interface SO101Bridge {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly bus: EventBus;
  readonly state: DeviceStateService;
}

// ── Claim-request flow ───────────────────────────────────────────────────────

interface ClaimRequestResponse {
  claimCode: string;
  deviceUuid: string;
}

interface BridgeConfig {
  /** UUID assigned during registration. */
  deviceUuid: string;
  /** Gateway WS URL the device was registered against. */
  gatewayUrl: string;
}

/** Returns the resolved bridge config path. */
function defaultBridgeConfigPath(): string {
  const home = process.env['HOME'] ?? '/root';
  return path.join(home, '.orobot', 'so101-config.json');
}

/** Read the bridge config file if it exists and is valid, otherwise return null. */
function readBridgeConfig(configPath: string): BridgeConfig | null {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as BridgeConfig;
    return parsed.deviceUuid ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist the bridge config file (creates parent dir if needed). */
function writeBridgeConfig(configPath: string, config: BridgeConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * First-boot registration: requests a claim code from the gateway and displays
 * it in the terminal.  Polls until the device is claimed, then saves the config.
 *
 * Returns the registered deviceUuid.
 * Throws if all polls are exhausted without a successful claim.
 */
async function runClaimFlow(
  gatewayHttpBase: string,
  gatewayWsUrl: string,
  bridgeConfigPath: string,
  state: DeviceStateService,
  fetchFn: typeof fetch,
  sleepFn: (ms: number) => Promise<void>,
): Promise<string> {
  console.log('\n=== SO-101 first-run setup ===');
  console.log('Requesting a claim code from orobot.io...');

  const res = await fetchFn(`${gatewayHttpBase}/api/device/claim-request`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name:         'SO-101 Arm',
      deviceType:   'byod',
      byodStyle:    'so101',
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
  console.log('│  this code to connect your arm.     │');
  console.log('└─────────────────────────────────────┘\n');

  await state.patch({ deviceUuid, pendingClaimCode: claimCode });

  // Poll until the gateway confirms the claim (device appears online).
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

export function createSO101Bridge(options: SO101BridgeOptions = {}): SO101Bridge {
  const DEFAULT_DATA_FILE = (() => {
    const dir = process.env['OROBOT_DATA_DIR']
      ?? path.join(__dirname, '../../../scripts/openroboticsdata');
    return path.join(dir, 'data.json');
  })();

  const dataFilePath     = options.dataFilePath ?? DEFAULT_DATA_FILE;
  const bridgeConfigPath = options.bridgeConfigPath ?? defaultBridgeConfigPath();
  const fetchFn          = options.fetchFn ?? globalThis.fetch;
  const sleepFn          = options.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const bus_             = new FeetechProductionBus(options.serialPort ?? '/dev/ttyACM0');
  const feetechBus       = options.bus ?? bus_;

  const state    = new DeviceStateService(dataFilePath);
  const eventBus = new EventBus();

  const networkSM = new NetworkStateMachine(state, eventBus);

  const registry = new MessageHandlerRegistry(eventBus, () => state.get().deviceUuid);
  registry.register(
    'motor-command',
    createMotorCommandHandler(feetechBus, { defaultSpeed: options.servoSpeed }),
  );

  const wsFactory: WsFactory = options.wsFactory ?? ((url, proto) => new WebSocket(url, proto));
  const gatewayClient = new GatewayClient(
    eventBus, state, registry, wsFactory, options.gatewayUrl,
    undefined, undefined, undefined, undefined,
    PLATFORM_ID,
  );
  const heartbeat = new HeartbeatService(state, eventBus, fetchFn);
  const hbMs      = options.heartbeatIntervalMs ?? 8_000;

  const unsubscribers: Array<() => void> = [];

  function getGatewayHttpBase(): string {
    return options.gatewayUrl
      ? wsUrlToHttpBase(options.gatewayUrl)
      : PROD_GATEWAY_HTTP_URL;
  }

  function getGatewayWsUrl(): string {
    return options.gatewayUrl ?? 'wss://robots-gateway-v2.wl.r.appspot.com/';
  }

  return {
    async start(): Promise<void> {
      // Ensure feetech serial is open before any WS messages arrive.
      await feetechBus.open();

      // First-boot: no bridge config file yet → run the claim-code flow.
      // We use the bridge config file (not data.json's deviceUuid) as the
      // registration marker because DeviceStateService auto-generates a UUID
      // on construction, so an empty uuid in data.json is never observable.
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
        // Patch state with the registered UUID (runClaimFlow already did this,
        // but patch again to ensure the in-memory DeviceStateService is current).
        await state.patch({ deviceUuid });
      } else {
        // Ensure DeviceStateService uses the registered UUID.
        await state.patch({ deviceUuid: existingConfig.deviceUuid });
      }

      unsubscribers.push(
        eventBus.on('network:connected', () => heartbeat.start(hbMs)),
        eventBus.on('network:disconnected', () => heartbeat.stop()),
      );

      // SO-101 uses client mode only — no WiFi state machine needed.
      // NetworkStateMachine handles reconnect backoff inside GatewayClient.
      void networkSM; // constructed to satisfy type but not wired (no WiFi)

      gatewayClient.start();
    },

    async stop(): Promise<void> {
      unsubscribers.forEach((fn) => fn());
      unsubscribers.length = 0;
      gatewayClient.stop();
      heartbeat.stop();
      await feetechBus.close();
    },

    get bus() { return eventBus; },
    get state() { return state; },
  };
}
