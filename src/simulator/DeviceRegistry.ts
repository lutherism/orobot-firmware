/**
 * DeviceRegistry — manages a pool of in-process firmware instances.
 *
 * Persistence: device state is written to `.simulator/` at the project root.
 *   .simulator/
 *     registry.json          ← list of { id, name, uuid } + seq counter
 *     devices/<id>/
 *       data.json            ← per-device firmware state file
 *
 * On restore(), each saved device is re-created with its existing data.json
 * (no new gateway registration needed — UUIDs are already registered).
 */

import { EventEmitter } from 'events';
import { randomUUID }   from 'crypto';
import fs               from 'fs';
import path             from 'path';
import { createApp }    from '../main.js';
import type { App }     from '../main.js';
import { MockGPIODriver }       from '../hardware/mock-driver.js';
import { NoopPtySpawner }       from '../dev/noop-pty-spawner.js';
import { MockWifiShellAdapter } from '../wifi/mock-shell-adapter.js';
import type { Device, DeviceEvent, DeviceOwner, DeviceStatus, PinState } from './types.js';

// ── Config ────────────────────────────────────────────────────────────────────

const GATEWAY_API  = process.env.GATEWAY_API
  ?? 'https://robots-gateway-v2.wl.r.appspot.com/api/device';
//const GATEWAY_WS   = process.env.GATEWAY_WS
//  ?? 'wss://robots-gateway-v2.wl.r.appspot.com/';
const GATEWAY_WS   = process.env.GATEWAY_WS
  ?? 'wss://robots-gateway-779307899828.us-west2.run.app/device'
// Base URL derived from GATEWAY_API (strips /api/device suffix if present)
const GATEWAY_BASE = GATEWAY_API.replace(/\/api\/device$/, '');

const RASPI_PINS    = [17, 18, 22, 27];
const HISTORY_LEN   = 60;     // samples; at SAMPLE_MS=100 → 6s window
const SAMPLE_MS     = 25;
const MAX_EVENTS    = 50;
const OWNER_POLL_MS = 15_000; // poll gateway for ownership changes every 15s

// ── Storage paths ─────────────────────────────────────────────────────────────

// __dirname = <project-root>/src/simulator  →  ../../ = project root
const STORE_DIR   = path.resolve(__dirname, '../../.simulator');
const STATE_FILE  = path.join(STORE_DIR, 'registry.json');
const DEVICES_DIR = path.join(STORE_DIR, 'devices');

// ── Persistence types ─────────────────────────────────────────────────────────

interface PersistedDevice {
  id:   string;
  name: string;
  uuid: string;
}

interface RegistryState {
  seq:     number;
  devices: PersistedDevice[];
}

// ── Internal state ────────────────────────────────────────────────────────────

interface DeviceInstance {
  id:             string;
  name:           string;
  uuid:           string;
  dataDir:        string;
  app:            App;
  driver:         MockGPIODriver;
  status:         DeviceStatus;
  startedAt:      Date | null;
  events:         DeviceEvent[];
  pinHistory:     Map<number, (0 | 1)[]>;
  unsubs:         Array<() => void>;
  owner:          DeviceOwner | null;
  ownerPollTimer: ReturnType<typeof setInterval> | null;
}

// ── DeviceRegistry ────────────────────────────────────────────────────────────

export class DeviceRegistry extends EventEmitter {
  private instances   = new Map<string, DeviceInstance>();
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private seq         = 0;

  constructor() {
    super();
    this.sampleTimer = setInterval(() => this.sampleAllPins(), SAMPLE_MS);
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  /**
   * Reload devices saved from a previous session.
   * Call this once after constructing the registry, before starting the server.
   */
  async restore(): Promise<void> {
    if (!fs.existsSync(STATE_FILE)) return;

    let state: RegistryState;
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as RegistryState;
    } catch {
      console.warn('[simulator] registry.json unreadable — starting fresh');
      return;
    }

    this.seq = state.seq ?? 0;
    let restored = 0;

    for (const saved of state.devices) {
      const dataDir  = path.join(DEVICES_DIR, saved.id);
      const dataFile = path.join(dataDir, 'data.json');

      if (!fs.existsSync(dataFile)) {
        console.warn(`[simulator] data.json missing for ${saved.name} (${saved.id}) — skipping`);
        continue;
      }

      const driver = new MockGPIODriver();
      const app    = createApp({
        dataFilePath:     dataFile,
        driver,
        ptySpawner:       new NoopPtySpawner(),
        wifiShellAdapter: new MockWifiShellAdapter(),
        execCommand:      () => {},
        scanIntervalMs:   3_600_000,
        gatewayUrl:       GATEWAY_WS,
        devicePrefix:     saved.uuid.slice(0, 5),
      });

      const instance: DeviceInstance = {
        id:             saved.id,
        name:           saved.name,
        uuid:           saved.uuid,
        dataDir,
        app,
        driver,
        status:         'disconnected',
        startedAt:      null,
        events:         [{ time: timestamp(), type: 'connected', message: 'restored from previous session' }],
        pinHistory:     new Map(RASPI_PINS.map(p => [p, []])),
        unsubs:         [],
        owner:          null,
        ownerPollTimer: null,
      };

      this.instances.set(saved.id, instance);
      this.subscribeBus(instance);

      await app.start();
      instance.startedAt = new Date();
      restored++;
    }

    if (restored > 0) {
      console.log(`[simulator] restored ${restored} device(s) from .simulator/`);
    }
  }

  private saveState(): void {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    const state: RegistryState = {
      seq: this.seq,
      devices: Array.from(this.instances.values()).map(i => ({
        id:   i.id,
        name: i.name,
        uuid: i.uuid,
      })),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async spawn(nameSuffix?: string): Promise<Device> {
    const id   = randomUUID();
    const seq  = ++this.seq;
    const name = nameSuffix ?? `sim-${String(seq).padStart(2, '0')}`;

    const uuid = await this.registerWithGateway(name);

    // Write data.json into persistent device dir
    const dataDir  = path.join(DEVICES_DIR, id);
    const dataFile = path.join(dataDir, 'data.json');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify({
      deviceUuid:    uuid,
      networkMode:   'client',
      devIP:         null,
      wifiSettings:  { ssid: 'simulator', password: '' },
      knownNetworks: [],
      ownerUuid:     null,
      type:          'wifi-motor',
      hardware:      'raspi',
      pingTime:      0,
    }, null, 2));

    const driver = new MockGPIODriver();
    const app    = createApp({
      dataFilePath:     dataFile,
      driver,
      ptySpawner:       new NoopPtySpawner(),
      wifiShellAdapter: new MockWifiShellAdapter(),
      execCommand:      () => {},
      scanIntervalMs:   3_600_000,
      gatewayUrl:       GATEWAY_WS,
      devicePrefix:     uuid.slice(0, 5),
    });

    const instance: DeviceInstance = {
      id, name, uuid, dataDir, app, driver,
      status:         'disconnected',
      startedAt:      null,
      events:         [],
      pinHistory:     new Map(RASPI_PINS.map(p => [p, []])),
      unsubs:         [],
      owner:          null,
      ownerPollTimer: null,
    };

    this.instances.set(id, instance);
    this.subscribeBus(instance);
    this.saveState();

    await app.start();
    instance.startedAt = new Date();

    const device = this.toDevice(instance);
    this.emit('change', { type: 'device-added', device });
    return device;
  }

  async kill(id: string): Promise<void> {
    const inst = this.getOrThrow(id);
    this.stopOwnerPolling(inst);
    inst.unsubs.forEach(fn => fn());
    await inst.app.stop();

    // Remove device dir and registry entry
    fs.rmSync(inst.dataDir, { recursive: true, force: true });
    this.instances.delete(id);
    this.saveState();

    this.emit('change', { type: 'device-removed', id });
  }

  async setPower(id: string, on: boolean): Promise<void> {
    const inst = this.getOrThrow(id);
    if (on && inst.status === 'off') {
      await inst.app.start();
      inst.startedAt = new Date();
    } else if (!on && inst.status !== 'off') {
      await inst.app.stop();
      inst.status    = 'off';
      inst.startedAt = null;
    }
    this.notify(inst);
  }

  async setConnected(id: string, connected: boolean): Promise<void> {
    const inst = this.getOrThrow(id);
    if (connected && inst.status === 'disconnected') {
      await inst.app.start();
    } else if (!connected && inst.status === 'connected') {
      await inst.app.stop();
      inst.status    = 'off';
      inst.startedAt = null;
      this.notify(inst);
    }
  }

  getAll(): Device[] {
    return Array.from(this.instances.values()).map(i => this.toDevice(i));
  }

  getById(id: string): Device | undefined {
    const inst = this.instances.get(id);
    return inst ? this.toDevice(inst) : undefined;
  }

  destroy(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    for (const inst of this.instances.values()) {
      this.stopOwnerPolling(inst);
      inst.unsubs.forEach(fn => fn());
      void inst.app.stop();
    }
    this.instances.clear();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private subscribeBus(inst: DeviceInstance): void {
    const { bus } = inst.app;

    inst.unsubs.push(
      bus.on('network:connected', ({ url }) => {
        inst.status    = 'connected';
        inst.startedAt = inst.startedAt ?? new Date();
        this.pushEvent(inst, 'connected', `network connected ${url}`);
        this.startOwnerPolling(inst);
        this.notify(inst);
      }),

      bus.on('network:disconnected', ({ reason }) => {
        if (inst.status !== 'off') inst.status = 'disconnected';
        this.stopOwnerPolling(inst);
        this.pushEvent(inst, 'disconnected', `disconnected: ${reason}`);
        this.notify(inst);
      }),

      bus.on('hardware:motor-moved', ({ angle }) => {
        this.pushEvent(inst, 'motor', `motor → ${angle}°`);
        this.notify(inst);
      }),

      bus.on('network:message', ({ type, data }) => {
        this.pushEvent(inst, 'command', `cmd ${type} "${data}"`);
      }),

      bus.on('system:heartbeat-sent', ({ pingTime }) => {
        this.pushEvent(inst, 'heartbeat', `heartbeat ${pingTime}ms`);
        this.notify(inst);
      }),

      bus.on('wifi:state-changed', ({ from, to }) => {
        this.pushEvent(inst, 'wifi', `wifi ${from} → ${to}`);
        this.notify(inst);
      }),
    );
  }

  private pushEvent(inst: DeviceInstance, type: DeviceEvent['type'], message: string): void {
    inst.events.unshift({ time: timestamp(), type, message });
    if (inst.events.length > MAX_EVENTS) inst.events.length = MAX_EVENTS;
  }

  private sampleAllPins(): void {
    for (const inst of this.instances.values()) {
      if (inst.status !== 'connected') continue;
      for (const [num, mockPin] of inst.driver.pins) {
        const history = inst.pinHistory.get(num) ?? [];
        history.push(mockPin.value);
        if (history.length > HISTORY_LEN) history.shift();
        inst.pinHistory.set(num, history);
      }
      this.notify(inst);
    }
  }

  private notify(inst: DeviceInstance): void {
    this.emit('change', { type: 'device-updated', device: this.toDevice(inst) });
  }

  private toDevice(inst: DeviceInstance): Device {
    const uptimeSecs = inst.startedAt
      ? Math.floor((Date.now() - inst.startedAt.getTime()) / 1000)
      : null;

    const pins: PinState[] = RASPI_PINS.map(num => ({
      num,
      value:   inst.driver.pins.get(num)?.value ?? 0,
      history: [...(inst.pinHistory.get(num) ?? [])],
    }));

    return {
      id:     inst.id,
      name:   inst.name,
      uuid:   inst.uuid,
      status: inst.status,
      uptime: uptimeSecs === null ? 'off' : formatUptime(uptimeSecs),
      owner:  inst.owner ?? undefined,
      pins,
      events: inst.events.slice(0, 8),
    };
  }

  // ── Owner polling ────────────────────────────────────────────────────────────

  private startOwnerPolling(inst: DeviceInstance): void {
    this.stopOwnerPolling(inst);
    void this.refreshOwner(inst);
    inst.ownerPollTimer = setInterval(() => void this.refreshOwner(inst), OWNER_POLL_MS);
  }

  private stopOwnerPolling(inst: DeviceInstance): void {
    if (inst.ownerPollTimer) {
      clearInterval(inst.ownerPollTimer);
      inst.ownerPollTimer = null;
    }
  }

  private async refreshOwner(inst: DeviceInstance): Promise<void> {
    const owner = await this.fetchOwner(inst.uuid);
    if (JSON.stringify(owner) !== JSON.stringify(inst.owner)) {
      inst.owner = owner;
      this.notify(inst);
    }
  }

  private async fetchOwner(uuid: string): Promise<DeviceOwner | null> {
    try {
      const devRes = await fetch(`${GATEWAY_API}/${uuid}`);
      if (!devRes.ok) return null;
      const dev = await devRes.json() as {
        ownerId: number | null;
        owner:   { name: string; uuid: string } | null;
      };
      if (!dev.ownerId || !dev.owner) return null;

      const userRes = await fetch(`${GATEWAY_BASE}/api/user/${dev.owner.uuid}`);
      const user    = userRes.ok
        ? await userRes.json() as { email?: string }
        : {};

      return {
        name:     dev.owner.name,
        email:    user.email ?? '',
        initials: ownerInitials(dev.owner.name),
        color:    ownerColor(dev.owner.uuid),
      };
    } catch {
      return null;
    }
  }

  private getOrThrow(id: string): DeviceInstance {
    const inst = this.instances.get(id);
    if (!inst) throw Object.assign(new Error(`device ${id} not found`), { status: 404 });
    return inst;
  }

  private async registerWithGateway(name: string): Promise<string> {
    const uuid = randomUUID();
    try {
      const res = await fetch(GATEWAY_API + '/sim', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ uuid, name, sim: true }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (err) {
      console.warn(`[simulator] gateway registration failed (${err}) — device will operate offline`);
    }
    return uuid;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timestamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:`
       + `${String(d.getMinutes()).padStart(2, '0')}:`
       + `${String(d.getSeconds()).padStart(2, '0')}`;
}

function ownerInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

const OWNER_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#22c55e'];
function ownerColor(uuid: string): string {
  const n = (uuid.charCodeAt(0) ?? 0) + (uuid.charCodeAt(uuid.length - 1) ?? 0);
  return OWNER_COLORS[n % OWNER_COLORS.length]!;
}

function formatUptime(secs: number): string {
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}
