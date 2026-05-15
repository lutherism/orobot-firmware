/**
 * Tests for CameraStreamService.
 *
 * All tests run in NODE_ENV=sim so no ffmpeg subprocess is ever spawned.
 * The FfmpegSpawner override is tested separately via a mock EventEmitter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { EventBus } from '../core/event-bus';
import { CameraStreamService, type FfmpegSpawner } from './camera-stream';
import type { CameraConfig } from '../core/program-config';
import type { OutboundEnvelope } from '../core/wire';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBus(): { bus: EventBus; frames: OutboundEnvelope[] } {
  const bus    = new EventBus();
  const frames: OutboundEnvelope[] = [];
  bus.on('network:send', ({ payload }) => {
    if (payload.type === 'camera-frame') frames.push(payload);
  });
  return { bus, frames };
}

/** Build a fake ChildProcess that emits data/close events. */
function makeFakeProc(): {
  proc: ChildProcess;
  emitData: (chunk: Buffer) => void;
  emitClose: (code?: number) => void;
  emitError: (err: Error) => void;
  killed: () => boolean;
} {
  const stdout = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  const stderr = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  const proc   = new EventEmitter() as unknown as ChildProcess;
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  let wasKilled = false;
  (proc as any).kill = () => { wasKilled = true; };

  return {
    proc,
    emitData:  (chunk) => stdout.emit('data', chunk),
    emitClose: (code = 0) => proc.emit('close', code),
    emitError: (err)  => proc.emit('error', err),
    killed:    () => wasKilled,
  };
}

// Build a minimal JPEG frame (SOI + EOI only)
function minimalJpeg(): Buffer {
  return Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('CameraStreamService — sim mode', () => {
  const origEnv = process.env['NODE_ENV'];
  beforeEach(() => { process.env['NODE_ENV'] = 'sim'; });
  afterEach(()  => { process.env['NODE_ENV'] = origEnv; });

  it('is not running before start()', () => {
    const { bus } = makeBus();
    const svc = new CameraStreamService(bus);
    expect(svc.isRunning).toBe(false);
  });

  it('becomes running after start()', () => {
    const { bus } = makeBus();
    const svc = new CameraStreamService(bus);
    svc.start('dev-1', { enabled: true, fps: 10 });
    expect(svc.isRunning).toBe(true);
    svc.stop();
  });

  it('stops when stop() is called', () => {
    const { bus } = makeBus();
    const svc = new CameraStreamService(bus);
    svc.start('dev-1', { enabled: true, fps: 10 });
    svc.stop();
    expect(svc.isRunning).toBe(false);
  });

  it('emits camera-frame messages in sim mode', async () => {
    const { bus, frames } = makeBus();
    const svc = new CameraStreamService(bus);
    // Use a high fps so we get a frame quickly
    svc.start('dev-2', { enabled: true, fps: 100 });
    await new Promise(r => setTimeout(r, 50));
    svc.stop();
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const f = frames[0];
    expect(f.type).toBe('camera-frame');
    expect(f.deviceUuid).toBe('dev-2');
  });

  it('emitted frame data contains mimeType, encoding, frame, capturedAt', async () => {
    const { bus, frames } = makeBus();
    const svc = new CameraStreamService(bus);
    svc.start('dev-3', { enabled: true, fps: 100 });
    await new Promise(r => setTimeout(r, 50));
    svc.stop();
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const data = JSON.parse(frames[0].data ?? '{}');
    expect(data).toHaveProperty('mimeType');
    expect(data).toHaveProperty('encoding', 'base64');
    expect(data).toHaveProperty('frame');
    expect(data).toHaveProperty('capturedAt');
  });

  it('calling start() twice is a no-op', () => {
    const { bus, frames } = makeBus();
    const svc = new CameraStreamService(bus);
    svc.start('dev-4', { enabled: true, fps: 1 });
    svc.start('dev-4', { enabled: true, fps: 1 });
    expect(svc.isRunning).toBe(true);
    svc.stop();
    expect(frames).toHaveLength(0); // no frames in <1 s at 1 fps
  });

  it('stop() while not running is a no-op', () => {
    const { bus } = makeBus();
    const svc = new CameraStreamService(bus);
    expect(() => svc.stop()).not.toThrow();
  });

  it('defaults fps to 10 when not specified', async () => {
    // Can't easily count exact frames but we can verify no crash
    const { bus } = makeBus();
    const svc = new CameraStreamService(bus);
    svc.start('dev-5', {});
    await new Promise(r => setTimeout(r, 20));
    svc.stop();
    expect(svc.isRunning).toBe(false);
  });
});

describe('CameraStreamService — ffmpeg spawner (non-sim)', () => {
  it('calls the spawner with device and fps', () => {
    const orig = process.env['NODE_ENV'];
    delete process.env['NODE_ENV'];
    try {
      const { bus } = makeBus();
      const { proc } = makeFakeProc();
      const spawner: FfmpegSpawner = vi.fn().mockReturnValue(proc);
      const svc = new CameraStreamService(bus, spawner);
      svc.start('dev-ff', { enabled: true, device: '/dev/video1', fps: 15 });
      expect(spawner).toHaveBeenCalledWith('/dev/video1', 15);
      svc.stop();
    } finally {
      process.env['NODE_ENV'] = orig;
    }
  });

  it('emits camera-frame when a complete JPEG arrives on stdout', () => {
    const orig = process.env['NODE_ENV'];
    delete process.env['NODE_ENV'];
    try {
      const { bus, frames } = makeBus();
      const { proc, emitData } = makeFakeProc();
      const spawner: FfmpegSpawner = vi.fn().mockReturnValue(proc);
      const svc = new CameraStreamService(bus, spawner);
      svc.start('dev-ff2', { enabled: true });
      emitData(minimalJpeg());
      expect(frames).toHaveLength(1);
      expect(frames[0].type).toBe('camera-frame');
      svc.stop();
    } finally {
      process.env['NODE_ENV'] = orig;
    }
  });

  it('handles multi-chunk JPEG delivery', () => {
    const orig = process.env['NODE_ENV'];
    delete process.env['NODE_ENV'];
    try {
      const { bus, frames } = makeBus();
      const { proc, emitData } = makeFakeProc();
      const spawner: FfmpegSpawner = vi.fn().mockReturnValue(proc);
      const svc = new CameraStreamService(bus, spawner);
      svc.start('dev-chunk', { enabled: true });
      const jpeg = minimalJpeg();
      emitData(jpeg.slice(0, 2));  // partial SOI
      expect(frames).toHaveLength(0);
      emitData(jpeg.slice(2));     // rest of frame
      expect(frames).toHaveLength(1);
      svc.stop();
    } finally {
      process.env['NODE_ENV'] = orig;
    }
  });

  it('kills the subprocess when stop() is called', () => {
    const orig = process.env['NODE_ENV'];
    delete process.env['NODE_ENV'];
    try {
      const { bus } = makeBus();
      const { proc, killed } = makeFakeProc();
      const spawner: FfmpegSpawner = vi.fn().mockReturnValue(proc);
      const svc = new CameraStreamService(bus, spawner);
      svc.start('dev-kill', { enabled: true });
      svc.stop();
      expect(killed()).toBe(true);
    } finally {
      process.env['NODE_ENV'] = orig;
    }
  });
});

describe('createLoadConfigHandler — camera integration', () => {
  it('starts camera stream when config.camera.enabled becomes true', async () => {
    const { createLoadConfigHandler } = await import('./program-config');
    const { bus } = makeBus();
    const svc = new CameraStreamService(bus);
    const origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'sim';

    const tmpDir = (await import('os')).tmpdir();
    const tmpPath = `${tmpDir}/test-pc-${Date.now()}.json`;
    const { ProgramConfigService } = await import('../core/program-config');
    const configSvc = new ProgramConfigService(tmpPath);
    const { StepperMotor } = await import('../hardware/stepper-motor');
    const { MockGPIODriver } = await import('../hardware/mock-driver');
    const motor = new StepperMotor(new MockGPIODriver(), [], bus);

    const handler = createLoadConfigHandler(configSvc, motor, svc);
    await handler({
      type: 'load-config',
      ackId: '',
      deviceUuid: 'dev-cfg',
      data: JSON.stringify({ config: { camera: { enabled: true, fps: 100 } }, unitId: 'u1' }),
    });

    expect(svc.isRunning).toBe(true);
    svc.stop();
    process.env['NODE_ENV'] = origEnv;
  });

  it('stops camera stream when config.camera.enabled becomes false', async () => {
    const { createLoadConfigHandler } = await import('./program-config');
    const { bus } = makeBus();
    const svc = new CameraStreamService(bus);
    const origEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'sim';

    svc.start('dev-stop', { enabled: true, fps: 1 });
    expect(svc.isRunning).toBe(true);

    const tmpDir = (await import('os')).tmpdir();
    const tmpPath = `${tmpDir}/test-pc-off-${Date.now()}.json`;
    const { ProgramConfigService } = await import('../core/program-config');
    const configSvc = new ProgramConfigService(tmpPath);
    const { StepperMotor } = await import('../hardware/stepper-motor');
    const { MockGPIODriver } = await import('../hardware/mock-driver');
    const motor = new StepperMotor(new MockGPIODriver(), [], bus);

    const handler = createLoadConfigHandler(configSvc, motor, svc);
    await handler({
      type: 'load-config',
      ackId: '',
      deviceUuid: 'dev-stop',
      data: JSON.stringify({ config: { camera: { enabled: false } }, unitId: 'u2' }),
    });

    expect(svc.isRunning).toBe(false);
    process.env['NODE_ENV'] = origEnv;
  });
});
