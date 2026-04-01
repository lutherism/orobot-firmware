import fs   from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createApp }             from './main';
import { MockGPIODriver }        from './hardware/mock-driver';
import { MockWifiShellAdapter }  from './wifi/mock-shell-adapter';
import { NoopPtySpawner }        from './dev/noop-pty-spawner';
import type { EventBus }         from './core/event-bus';

const LOCAL = process.argv.includes('--local');
const RESET = process.argv.includes('--reset');

const DATA_DIR       = path.join(__dirname, '../scripts/openroboticsdata');
const DEV_STATE_FILE = path.join(DATA_DIR, 'dev-state.json');
const DATA_FILE      = path.join(DATA_DIR, 'data.json');

const REG_URL = LOCAL
  ? 'http://localhost:8080/api/device'
  : 'https://robots-gateway-v2.wl.r.appspot.com/api/device';

interface DevState { deviceUuid: string }

function readDevState(): DevState | null {
  if (RESET || !fs.existsSync(DEV_STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DEV_STATE_FILE, 'utf8')) as DevState;
  } catch {
    return null;
  }
}

async function registerDevice(): Promise<string> {
  const deviceUuid = uuidv4();
  console.log(`[dev] registering new device ${deviceUuid} ...`);
  const res = await fetch(REG_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ uuid: deviceUuid, name: 'dev-machine' }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Registration failed: ${res.status} ${body}`);
  }
  console.log('[dev] registered successfully');
  return deviceUuid;
}

async function getOrRegisterDevice(): Promise<string> {
  const saved = readDevState();
  if (saved) {
    console.log(`[dev] reusing device ${saved.deviceUuid}`);
    return saved.deviceUuid;
  }
  const deviceUuid = await registerDevice();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DEV_STATE_FILE, JSON.stringify({ deviceUuid }));
  return deviceUuid;
}

function writeDataJson(deviceUuid: string): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    deviceUuid,
    networkMode:   LOCAL ? 'dev'    : 'client',
    devIP:         LOCAL ? '127.0.0.1' : null,
    wifiSettings:  { ssid: 'dev', password: '' },
    knownNetworks: [],
    ownerUuid:     null,
    type:          'wifi-motor',
    hardware:      'raspi',
    pingTime:      0,
  }));
}

function attachLogger(bus: EventBus, deviceUuid: string): void {
  const gw = LOCAL
    ? 'ws://localhost:8080'
    : 'wss://robots-gateway-v2.wl.r.appspot.com/';

  console.log('');
  console.log('┌─ orobot-firmware dev ──────────────────────────────────────────────┐');
  console.log(`│  Device UUID : ${deviceUuid.padEnd(53)}│`);
  console.log(`│  Gateway     : ${gw.padEnd(53)}│`);
  console.log('│  Tip         : claim this device at orobot.io → Devices            │');
  console.log('└────────────────────────────────────────────────────────────────────┘');
  console.log('');

  bus.on('network:connected',      ({ url })    => console.log(`[network]   connected     ${url}`));
  bus.on('network:disconnected',   ({ reason }) => console.log(`[network]   disconnected  ${reason}`));
  bus.on('network:message',        ({ type, data }) => console.log(`[cmd]       ${type}  "${data}"`));
  bus.on('hardware:motor-moved',   ({ angle })  => console.log(`[motor]     moved to ${angle}°`));
  bus.on('hardware:motor-error',   ({ error })  => console.log(`[motor]     error: ${error.message}`));
  bus.on('system:heartbeat-sent',  ({ pingTime }) => console.log(`[heartbeat] sent  pingTime=${pingTime}ms`));
  bus.on('system:reboot-requested',  () => console.log('[system]    reboot requested (suppressed in dev)'));
  bus.on('system:update-requested',  () => console.log('[system]    update requested (suppressed in dev)'));
  bus.on('wifi:state-changed',     ({ from, to }) => console.log(`[wifi]      ${from} → ${to}`));
}

async function main(): Promise<void> {
  const deviceUuid = await getOrRegisterDevice();
  writeDataJson(deviceUuid);

  const app = createApp({
    dataFilePath:     DATA_FILE,
    driver:           new MockGPIODriver(),
    ptySpawner:       new NoopPtySpawner(),
    wifiShellAdapter: new MockWifiShellAdapter(),
    execCommand:      (cmd, args) =>
      console.log(`[system]    exec suppressed: ${cmd} ${args.join(' ')}`),
    scanIntervalMs:   60_000, // suppress peer scans in dev
  });

  attachLogger(app.bus, deviceUuid);

  process.on('SIGINT',  () => { void app.stop().then(() => process.exit(0)); });
  process.on('SIGTERM', () => { void app.stop().then(() => process.exit(0)); });

  await app.start();
}

main().catch((err: unknown) => {
  console.error('[dev] fatal:', err);
  process.exit(1);
});
