import path from 'path';
import { execFile } from 'child_process';
import { WebSocket } from 'ws';
import { DeviceStateService } from './core/device-state';
import { EventBus } from './core/event-bus';
import { MessageHandlerRegistry } from './handlers/registry';
import { createMotorHandler } from './handlers/motor';
import { createPtyHandler } from './handlers/pty';
import { createCameraHandler } from './handlers/camera';
import {
  createGetDeviceDataHandler,
  createRebootHandler,
  createUpdateHandler,
  createNetworkModeHandler,
} from './handlers/system';
import { createWifiListHandler, createShareWifiHandler } from './handlers/wifi';
import { StepperMotor } from './hardware/stepper-motor';
import { RPiGPIODriver } from './hardware/gpio-driver';
import { PTYManager, type PtySpawner } from './pty/pty-manager';
import { NetworkStateMachine } from './network/state-machine';
import { GatewayClient, type WsFactory } from './network/gateway-client';
import { HeartbeatService } from './network/heartbeat';
import type { GPIODriver } from './hardware/types';

const DEFAULT_DATA_FILE = path.join(__dirname, '../scripts/openroboticsdata/data.json');
const RASPI_PINS        = [17, 18, 22, 27];
const BANANA_PINS       = [0, 1, 3, 2];

export interface AppOptions {
  /** GPIO driver — defaults to RPiGPIODriver (real hardware). */
  driver?: GPIODriver;
  /** PTY spawner — must be provided in tests; defaults to node-pty in production. */
  ptySpawner?: PtySpawner;
  /** Override WebSocket URL; production URL derived from networkMode/devIP when absent. */
  gatewayUrl?: string;
  /** Path to data.json — defaults to scripts/openroboticsdata/data.json. */
  dataFilePath?: string;
  /** Heartbeat interval in ms — defaults to 8000. */
  heartbeatIntervalMs?: number;
  /** Override command executor for testing; defaults to child_process.execFile (fire-and-forget). */
  execCommand?: (cmd: string, args: string[]) => void;
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly bus: EventBus;
}

export function createApp(options: AppOptions = {}): App {
  const dataFilePath = options.dataFilePath ?? DEFAULT_DATA_FILE;
  const state  = new DeviceStateService(dataFilePath);
  const bus    = new EventBus();

  const hw     = state.get().hardware;
  const pins   = hw === 'banana' ? BANANA_PINS : RASPI_PINS;
  const driver = options.driver ?? new RPiGPIODriver();
  const motor  = new StepperMotor(driver, pins, bus);

  const ptySpawner = options.ptySpawner ?? createNodePtySpawner();
  const ptyManager = new PTYManager(ptySpawner, bus);

  const networkSM = new NetworkStateMachine(state, bus);

  const registry = new MessageHandlerRegistry(bus, () => state.get().deviceUuid);

  registry.register('pty-in',        createPtyHandler(ptyManager));
  registry.register('getframe',      createCameraHandler(bus));
  registry.register('getDeviceData', createGetDeviceDataHandler(state, bus));
  registry.register('networkmode',   createNetworkModeHandler(networkSM));
  registry.register('share-wifi',    createShareWifiHandler(bus));
  registry.register('wifiList',      createWifiListHandler(bus));
  registry.register('reboot',        createRebootHandler(bus));
  registry.register('update',        createUpdateHandler(bus));
  registry.register('gotoangle',     true, createMotorHandler(motor));

  const wsFactory: WsFactory = (url, proto) => new WebSocket(url, proto);

  const gatewayClient = new GatewayClient(bus, state, registry, wsFactory, options.gatewayUrl);
  const heartbeat     = new HeartbeatService(state, bus);
  const hbIntervalMs  = options.heartbeatIntervalMs ?? 8_000;
  const exec = options.execCommand ?? ((cmd: string, args: string[]) => {
    // fire-and-forget; errors are silently ignored (reboot/update kills the process anyway)
    execFile(cmd, args, () => {});
  });
  bus.on('system:reboot-requested',  () => exec('sudo', ['reboot']));
  bus.on('system:update-requested',  () => exec('/home/pi/orobot-firmware/update-reboot.sh', []));

  bus.on('network:connected',    () => heartbeat.start(hbIntervalMs));
  bus.on('network:disconnected', () => heartbeat.stop());

  return {
    async start(): Promise<void> {
      await motor.initialize();
      ptyManager.start();
      gatewayClient.start();
    },
    async stop(): Promise<void> {
      ptyManager.stop();
      gatewayClient.stop();
      heartbeat.stop();
      await motor.stop(); // de-energize coils before process exits
    },
    get bus() { return bus; },
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
