/**
 * Generic PCA9685 Multi-Servo ARM Bridge.
 *
 * Connects any PCA9685-wired servo arm to orobot.io by reusing the firmware's
 * existing GatewayClient, MessageHandlerRegistry, EventBus, and DeviceStateService.
 *
 * Compared to the SO-101 Feetech bridge this bridge:
 *   - Uses the PCA9685 I²C driver (hobby PWM servos) instead of the Feetech STS3215 bus.
 *   - Accepts a data-driven ArmServoConfig so any arm topology can be described
 *     without code changes — swap the config for InMoov, a custom hand rig, etc.
 *   - Registers `motor-command` using the same joint-command envelope the orobot
 *     JointDriveControl UI already sends.
 *   - Shares the SO-101 claim-code first-boot flow (POST /api/device/claim-request).
 *
 * Usage (production):
 *   import { GENERIC_ARM_6DOF } from './arm-servo-map';
 *   const bridge = createPCA9685ArmBridge({ config: GENERIC_ARM_6DOF });
 *   await bridge.start();
 *
 * Usage (tests):
 *   const mockBus = new MockI2CBus();
 *   const driver  = new PCA9685Driver({ mockBus });
 *   await driver.init();
 *   const bridge = createPCA9685ArmBridge({
 *     config:     GENERIC_ARM_6DOF,
 *     driver,
 *     gatewayUrl: 'ws://localhost:9999',
 *     fetchFn:    mockFetch,
 *   });
 *   await bridge.start();
 *
 * Mockable seams:
 *   - PCA9685Driver (inject a driver built on MockI2CBus)
 *   - WsFactory (inject a test WS factory)
 *   - fetch (mock for claim-request/poll)
 *   - sleepFn (replace setTimeout-based polling in tests)
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
import { PCA9685Driver } from '../../drivers/pca9685';
import { ArmServoMap, GENERIC_ARM_6DOF, type ArmServoConfig } from './arm-servo-map';
import { createJointCommandHandler } from './joint-command-handler';

// ── Constants ────────────────────────────────────────────────────────────────

const PROD_GATEWAY_HTTP_URL = 'https://robots-gateway-v2.wl.r.appspot.com';
const CLAIM_POLL_INTERVAL_MS = 3_000;
const CLAIM_MAX_POLLS = 100; // ~5 min
const PLATFORM_ID = 'pca9685-arm';

function wsUrlToHttpBase(wsUrl: string): string {
  const u = new URL(wsUrl);
  const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
  return `${scheme}//${u.host}`;
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface PCA9685ArmBridgeOptions {
  /**
   * Arm joint→channel config.  Defaults to GENERIC_ARM_6DOF.
   * Pass a custom config for InMoov, a hand rig, or any other topology.
   */
  config?: ArmServoConfig;
  /**
   * Pre-initialised PCA9685 driver.  When omitted the bridge creates a
   * production driver on I²C bus 1 address 0x40.
   */
  driver?: PCA9685Driver;
  /** Override gateway WS URL (defaults to production). */
  gatewayUrl?: string;
  /** Path to data.json (defaults to scripts/openroboticsdata/data.json). */
  dataFilePath?: string;
  /**
   * Path to the bridge config file (pca9685-arm-config.json).
   * When present the claim flow is skipped.
   * Defaults to ~/.orobot/pca9685-arm-config.json.
   */
  bridgeConfigPath?: string;
  /** Heartbeat interval in ms — defaults to 8000. */
  heartbeatIntervalMs?: number;
  /** Inject a fetch implementation (for tests). */
  fetchFn?: typeof fetch;
  /** Inject a WS factory (for tests). */
  wsFactory?: WsFactory;
  /** Sleep function for tests — replaces setTimeout-based polling. */
  sleepFn?: (ms: number) => Promise<void>;
}

// ── Bridge interface ─────────────────────────────────────────────────────────

export interface PCA9685ArmBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly bus: EventBus;
  readonly state: DeviceStateService;
}

// ── Claim-request flow (mirrors so101-bridge) ────────────────────────────────

interface ClaimRequestResponse {
  claimCode: string;
  deviceUuid: string;
}

interface BridgeConfig {
  deviceUuid: string;
  gatewayUrl: string;
}

function defaultBridgeConfigPath(): string {
  const home = process.env['HOME'] ?? '/root';
  return path.join(home, '.orobot', 'pca9685-arm-config.json');
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
  gatewayWsUrl: string,
  bridgeConfigPath: string,
  state: DeviceStateService,
  fetchFn: typeof fetch,
  sleepFn: (ms: number) => Promise<void>,
): Promise<string> {
  console.log('\n=== PCA9685 Arm — first-run setup ===');
  console.log('Requesting a claim code from orobot.io...');

  const res = await fetchFn(`${gatewayHttpBase}/api/device/claim-request`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      name:       'PCA9685 Arm',
      deviceType: 'byod',
      byodStyle:  'pca9685-arm',
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

export function createPCA9685ArmBridge(options: PCA9685ArmBridgeOptions = {}): PCA9685ArmBridge {
  const DEFAULT_DATA_FILE = (() => {
    const dir = process.env['OROBOT_DATA_DIR']
      ?? path.join(__dirname, '../../../scripts/openroboticsdata');
    return path.join(dir, 'data.json');
  })();

  const dataFilePath     = options.dataFilePath     ?? DEFAULT_DATA_FILE;
  const bridgeConfigPath = options.bridgeConfigPath ?? defaultBridgeConfigPath();
  const fetchFn          = options.fetchFn          ?? globalThis.fetch;
  const sleepFn          = options.sleepFn          ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const config   = options.config ?? GENERIC_ARM_6DOF;
  const servoMap = new ArmServoMap(config);
  const driver   = options.driver ?? new PCA9685Driver();

  const state    = new DeviceStateService(dataFilePath);
  const eventBus = new EventBus();

  const networkSM = new NetworkStateMachine(state, eventBus);

  const registry = new MessageHandlerRegistry(eventBus, () => state.get().deviceUuid);
  registry.register('motor-command', createJointCommandHandler(driver, servoMap));

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
      // Init the I²C driver before any WS messages arrive.
      await driver.init();

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

      void networkSM; // constructed for type consistency; no WiFi state machine needed

      gatewayClient.start();
    },

    async stop(): Promise<void> {
      unsubscribers.forEach((fn) => fn());
      unsubscribers.length = 0;
      gatewayClient.stop();
      heartbeat.stop();
      driver.close();
    },

    get bus()   { return eventBus; },
    get state() { return state; },
  };
}
