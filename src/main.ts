import path from 'path';
import { execFile } from 'child_process';
import { WebSocket } from 'ws';
import { DeviceStateService } from './core/device-state';
import { EventBus } from './core/event-bus';
import { MessageHandlerRegistry } from './handlers/registry';
import { createMotorHandler, createGotoRelativeHandler, createStopAllHandler } from './handlers/motor';
import { createPtyHandler } from './handlers/pty';
import { createCameraHandler, captureCameraFrame } from './handlers/camera';
import { createVisionInferenceHandler } from './handlers/vision-inference';
import {
  createGetDeviceDataHandler,
  createRebootHandler,
  createUpdateHandler,
  createNetworkModeHandler,
} from './handlers/system';
import { createWifiListHandler, createShareWifiHandler } from './handlers/wifi';
import { ProgramConfigService } from './core/program-config';
import { createLoadConfigHandler } from './handlers/program-config';
import { DeviceSandboxService } from './core/device-sandbox';
import { createLoadCodeHandler } from './handlers/load-code';
import { createServoCommandHandler } from './handlers/servo-command';
import { PCA9685Driver } from './drivers/pca9685';
import { StepperMotor } from './hardware/stepper-motor';
import { selectDriver } from './hardware/driver-registry';
import { PTYManager, type PtySpawner } from './pty/pty-manager';
import { NetworkStateMachine } from './network/state-machine';
import { GatewayClient, type WsFactory } from './network/gateway-client';
import { HeartbeatService } from './network/heartbeat';
import type { GPIODriver } from './hardware/types';
import { WifiStateMachine } from './wifi/wifi-state-machine';
import { WifiManager } from './wifi/wifi-manager';
import { CaptivePortalServer } from './wifi/captive-portal';
import { WifiScanMonitor } from './wifi/wifi-scan-monitor';
import { RpiWifiShellAdapter } from './wifi/rpi-shell-adapter';
import { MockWifiShellAdapter } from './wifi/mock-shell-adapter';
import type { WifiShellAdapter } from './wifi/types';
import { createLogger } from './core/logger';

const DEFAULT_DATA_FILE       = (() => {
  const dir = process.env['OROBOT_DATA_DIR']
    ?? path.join(__dirname, '../scripts/openroboticsdata');
  return path.join(dir, 'data.json');
})();
// RPi uses BCM (Broadcom chip) GPIO numbers; Jetson driver expects physical
// 40-pin header positions. These are the same physical connector positions.
const RASPI_PINS              = [17, 18, 22, 27];  // BCM
const JETSON_PINS             = [11, 12, 15, 13];  // header pins (≡ BCM 17,18,22,27)
const BANANA_PINS             = [0, 1, 3, 2];
const DEFAULT_SCAN_INTERVAL   = 10_000;
const PROD_GATEWAY_HTTP_URL   = 'https://robots-gateway-v2.wl.r.appspot.com';

/** Derive the gateway REST base URL (scheme + host + port) from a WebSocket URL.
 *  Strips any path — WS URLs like `ws://host:8080/device` map to `http://host:8080`. */
function wsUrlToHttpBase(wsUrl: string): string {
  const u = new URL(wsUrl);
  const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
  return `${scheme}//${u.host}`;
}

export interface AppOptions {
  /** GPIO driver — defaults to whatever `selectDriver()` returns based on
   *  `OROBOT_PLATFORM` (defaults to RPi). Override in tests/simulator. */
  driver?: GPIODriver;
  /** PTY spawner — must be provided in tests; defaults to node-pty in production. */
  ptySpawner?: PtySpawner;
  /** Override WebSocket URL; production URL derived from networkMode/devIP when absent. */
  gatewayUrl?: string;
  /** Path to data.json — defaults to scripts/openroboticsdata/data.json. */
  dataFilePath?: string;
  /** Heartbeat interval in ms — defaults to 8000. */
  heartbeatIntervalMs?: number;
  /** WebSocket ping interval in ms — defaults to 25000. */
  pingIntervalMs?: number;
  /** Override command executor for testing; defaults to child_process.execFile (fire-and-forget). */
  execCommand?: (cmd: string, args: string[]) => void;
  /** WiFi shell adapter — defaults to RpiWifiShellAdapter. */
  wifiShellAdapter?: WifiShellAdapter;
  /** Peer scan interval in ms — defaults to 10_000. */
  scanIntervalMs?: number;
  /** Connection failures before falling back to AP mode — defaults to 10. */
  maxConnectFailures?: number;
  /** Reconnect retries before falling back to AP mode — defaults to 10. */
  maxReconnectRetries?: number;
  /** First N chars of device UUID to include in log output — used by the simulator. */
  devicePrefix?: string;
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly bus: EventBus;
  /** Exposed so test harnesses and the simulator can patch firmware state
   *  (e.g. portal claim-code submission) that normally would be written by
   *  the on-device captive portal. */
  readonly state: DeviceStateService;
}

export function createApp(options: AppOptions = {}): App {
  const dataFilePath = options.dataFilePath ?? DEFAULT_DATA_FILE;
  const configFilePath = dataFilePath.replace(/data\.json$/, 'program-config.json');
  const programConfig  = new ProgramConfigService(configFilePath);
  const deviceSandbox  = new DeviceSandboxService();
  const state  = new DeviceStateService(dataFilePath);
  const bus    = new EventBus();

  const pca9685  = new PCA9685Driver();

  const hw       = state.get().hardware;
  const platform = (process.env['OROBOT_PLATFORM'] ?? 'pi').trim().toLowerCase();
  const pins     = platform === 'jetson' ? JETSON_PINS
                 : hw === 'banana'       ? BANANA_PINS
                 : RASPI_PINS;
  const driver = options.driver ?? selectDriver();
  const motor  = new StepperMotor(driver, pins, bus);

  // Apply any saved motor constraints from a previous deploy
  const savedMotor = programConfig.get().motors?.[0];
  if (savedMotor !== undefined) {
    motor.setConstraints(savedMotor.minAngle, savedMotor.maxAngle);
  }

  const ptySpawner = options.ptySpawner ?? createNodePtySpawner();
  const ptyManager = new PTYManager(ptySpawner, bus);

  const device    = options.devicePrefix;
  const networkSM = new NetworkStateMachine(state, bus, device);
  const wifiSM    = new WifiStateMachine(bus, device);

  // Jetson manages its own network via the host OS — the captive-portal/AP
  // flow is Pi-only. Use the no-op adapter so iptables/hostapd are never invoked.
  const wifiAdapter    = options.wifiShellAdapter
                       ?? (platform === 'jetson' ? new MockWifiShellAdapter() : new RpiWifiShellAdapter());
  const wifiManager    = new WifiManager(
    wifiAdapter, state, bus, wifiSM,
    options.maxConnectFailures,
    options.maxReconnectRetries,
    device,
  );
  const captivePortal   = new CaptivePortalServer(wifiManager, state, bus, device);
  const wifiScanMonitor = new WifiScanMonitor(wifiAdapter, state, bus, device);
  const scanIntervalMs  = options.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL;

  const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid, device);
  registry.register('pty-in',        createPtyHandler(ptyManager));
  registry.register('getframe',      createCameraHandler(bus));
  registry.register('infer-frame',   createVisionInferenceHandler(bus, programConfig, captureCameraFrame));
  registry.register('getDeviceData', createGetDeviceDataHandler(state, bus));
  registry.register('networkmode',   createNetworkModeHandler(networkSM));
  registry.register('share-wifi',    createShareWifiHandler(wifiManager));
  registry.register('wifiList',      createWifiListHandler(wifiManager, state, bus));
  registry.register('reboot',        createRebootHandler(bus));
  registry.register('update',        createUpdateHandler(bus));
  registry.register('gotoangle',     true, createMotorHandler(motor));
  registry.register('gotorelative',  true, createGotoRelativeHandler(motor));
  registry.register('load-config', createLoadConfigHandler(programConfig, motor));
  registry.register('load-code',      createLoadCodeHandler(deviceSandbox, motor, state, bus));
  registry.register('stop',           createStopAllHandler(motor));
  registry.register('servo-command',  createServoCommandHandler(pca9685));

  // System message types must always reach the registry.
  // User action types (e.g. 'go', 'home') are not in this set and can be
  // intercepted by device code before the registry sees them.
  const SYSTEM_MSG_TYPES = new Set([
    'load-config', 'load-code', 'pty-in', 'getframe', 'infer-frame', 'getDeviceData',
    'networkmode', 'share-wifi', 'wifiList', 'reboot', 'update', 'command-in', 'stop',
    'servo-command',
  ]);

  registry.setPriorityDispatcher((msg) => {
    if (SYSTEM_MSG_TYPES.has(msg.type)) return false;
    let data: unknown;
    try { data = msg.data ? JSON.parse(msg.data) : undefined; } catch { data = msg.data; }
    return deviceSandbox.dispatch(msg.type, data);
  });

  const wsFactory: WsFactory = (url, proto) => new WebSocket(url, proto);
  const gatewayClient = new GatewayClient(bus, state, registry, wsFactory, options.gatewayUrl, device, options.pingIntervalMs, undefined, undefined, platform);
  const heartbeat     = new HeartbeatService(state, bus, fetch, device);
  const hbIntervalMs  = options.heartbeatIntervalMs ?? 8_000;

  const exec = options.execCommand ?? ((cmd: string, args: string[]) => {
    // fire-and-forget; errors are silently ignored (reboot/update kills the process anyway)
    execFile(cmd, args, () => {});
  });

  const unsubscribers: Array<() => void> = [];

  async function tryRedeemClaimCode(): Promise<void> {
    const { pendingClaimCode, deviceUuid } = state.get();
    if (!pendingClaimCode) return;
    const gatewayHttpBase = options.gatewayUrl
      ? wsUrlToHttpBase(options.gatewayUrl)
      : PROD_GATEWAY_HTTP_URL;
    try {
      const res = await fetch(`${gatewayHttpBase}/api/device/claim-code/redeem`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: pendingClaimCode, deviceUuid }),
      });
      if (res.ok) {
        await state.patch({ pendingClaimCode: null, lastSetupError: null });
      } else {
        await state.patch({
          lastSetupError: `Registration failed (${res.status}). Please double-check the claim code.`,
        });
      }
    } catch {
      /* network down — will retry on next network:connected */
    }
  }

  return {
    async start(): Promise<void> {
      unsubscribers.push(
        bus.on('system:reboot-requested',  () => exec('sudo', ['reboot'])),
        bus.on('system:update-requested',  () => exec(path.join(__dirname, '../update-reboot.sh'), [])),
        bus.on('network:connected',        () => heartbeat.start(hbIntervalMs)),
        // Attempt claim-code redeem on either event: when the network comes up
        // (pendingClaimCode was set earlier during AP provisioning) or when a
        // code is submitted after we're already connected (simulator / reclaim).
        bus.on('network:connected',        () => { void tryRedeemClaimCode(); }),
        bus.on('portal:claim-code-stored', () => { void tryRedeemClaimCode(); }),
        bus.on('network:disconnected',     () => heartbeat.stop()),
        bus.on('wifi:goto-client-requested', () => void wifiManager.gotoClient()),
        bus.on('wifi:state-changed', ({ from, to }) => {
          if (to === 'CONNECTING') {
            gatewayClient.start();
          } else if (to === 'SETUP_MODE') {
            gatewayClient.stop();
            captivePortal.start();
            wifiScanMonitor.stop();
            // Fell back from an attempted wifi join — surface the failure on
            // next portal visit so the user can correct credentials.
            if (from === 'CONNECTING' || from === 'RECONNECTING') {
              const { wifiSettings } = state.get();
              const ssid = wifiSettings?.ssid;
              void state.patch({
                lastSetupError: ssid
                  ? `Could not connect to "${ssid}". Please check the password or pick a different network.`
                  : 'Could not connect to the network. Please try again.',
              });
            }
          } else if (to === 'CONNECTED') {
            captivePortal.stop();
            wifiScanMonitor.start(scanIntervalMs);
          }
        }),
      );
      // Motor init can fail on Jetson when no hardware is attached or pin map
      // is wrong for this board. Degrade gracefully so the gateway connection
      // and claim flow still work.
      await motor.initialize().catch((err: unknown) => {
        console.warn('Motor GPIO init failed (hardware may not be attached):', err instanceof Error ? err.message : String(err));
      });
      // PCA9685 init is best-effort — degrades gracefully on devices without
      // the board wired up (common for non-quadruped robots).
      await pca9685.init().catch((err: unknown) => {
        console.warn('PCA9685 I²C init failed (board may not be connected):', err instanceof Error ? err.message : String(err));
      });
      await wifiManager.initialize();
      ptyManager.start();
    },
    async stop(): Promise<void> {
      unsubscribers.forEach((fn) => fn());
      unsubscribers.length = 0;
      wifiManager.stop();
      ptyManager.stop();
      gatewayClient.stop();
      heartbeat.stop();
      captivePortal.stop();
      wifiScanMonitor.stop();
      wifiSM.reset(); // reset state machine so start() can run the full init sequence again
      await motor.stop(); // de-energize coils before process exits
      pca9685.close();
    },
    get bus() { return bus; },
    get state() { return state; },
  };
}

/**
 * Builds a PtySpawner backed by node-pty (lazy-required to avoid import errors
 * in test environments where node-pty may not be available).
 */
function createNodePtySpawner(): PtySpawner {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pty = require('node-pty') as typeof import('node-pty');
  return {
    spawn(shell, args, opts) {
      const proc = pty.spawn(shell, args, opts);
      return {
        write: (data: string)          => proc.write(data),
        kill:  (sig: string | number)  => proc.kill(sig as string),
        on(event: 'data' | 'exit', handler: ((data: string) => void) | (() => void)): void {
          if (event === 'data') {
            proc.onData(handler as (data: string) => void);
          } else {
            proc.onExit(() => (handler as () => void)());
          }
        },
      };
    },
  };
}
