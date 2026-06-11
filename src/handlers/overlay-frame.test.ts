/**
 * Tests for OverlayPublisher.
 *
 * All tests run in NODE_ENV=sim so no real vision model is needed.
 * The WS envelope contract is validated against the spec from orobotio PR #3615.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../core/event-bus';
import { OverlayPublisher } from './overlay-frame';
import type { OutboundEnvelope } from '../core/wire';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBus(): { bus: EventBus; frames: OutboundEnvelope[] } {
  const bus    = new EventBus();
  const frames: OutboundEnvelope[] = [];
  bus.on('network:send', ({ payload }) => {
    if (payload.type === 'overlay-frame') frames.push(payload);
  });
  return { bus, frames };
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('OverlayPublisher — sim mode', () => {
  const origEnv = process.env['NODE_ENV'];
  beforeEach(() => { process.env['NODE_ENV'] = 'sim'; });
  afterEach(()  => { process.env['NODE_ENV'] = origEnv; });

  it('emits an overlay-frame envelope when called without an imageBuffer in sim', async () => {
    const { bus, frames } = makeBus();
    const pub = new OverlayPublisher(bus, 'dev-1');
    await pub.publishOverlay('depth');
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe('overlay-frame');
    expect(frames[0].deviceUuid).toBe('dev-1');
  });

  it('data is a JSON string containing overlayId, mimeType, frame, ts', async () => {
    const { bus, frames } = makeBus();
    const pub = new OverlayPublisher(bus, 'dev-2');
    await pub.publishOverlay('segmentation');
    expect(frames).toHaveLength(1);
    const inner = JSON.parse(frames[0].data ?? '{}');
    expect(inner).toHaveProperty('overlayId', 'segmentation');
    expect(inner).toHaveProperty('mimeType', 'image/png');
    expect(inner).toHaveProperty('frame');
    expect(typeof inner.frame).toBe('string');
    expect(inner.frame.length).toBeGreaterThan(0);
    expect(inner).toHaveProperty('ts');
    expect(typeof inner.ts).toBe('number');
  });

  it('frame is a valid base64-encoded PNG (starts with \\x89PNG after decode)', async () => {
    const { bus, frames } = makeBus();
    const pub = new OverlayPublisher(bus, 'dev-3');
    await pub.publishOverlay('depth-map');
    const inner = JSON.parse(frames[0].data ?? '{}');
    const decoded = Buffer.from(inner.frame, 'base64');
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50); // 'P'
    expect(decoded[2]).toBe(0x4E); // 'N'
    expect(decoded[3]).toBe(0x47); // 'G'
  });

  it('supports multiple concurrent overlay IDs', async () => {
    const { bus, frames } = makeBus();
    const pub = new OverlayPublisher(bus, 'dev-multi');
    await pub.publishOverlay('depth');
    await pub.publishOverlay('segmentation');
    expect(frames).toHaveLength(2);
    const ids = frames.map(f => JSON.parse(f.data ?? '{}').overlayId);
    expect(ids).toContain('depth');
    expect(ids).toContain('segmentation');
  });

  it('uses provided imageBuffer when supplied instead of generating checkerboard', async () => {
    const { bus, frames } = makeBus();
    const pub = new OverlayPublisher(bus, 'dev-buf');
    // Supply a synthetic buffer (not a real PNG — we just check the bytes round-trip)
    const fakeBuffer = Buffer.from([1, 2, 3, 4, 5]);
    await pub.publishOverlay('edges', fakeBuffer);
    expect(frames).toHaveLength(1);
    const inner = JSON.parse(frames[0].data ?? '{}');
    const decoded = Buffer.from(inner.frame, 'base64');
    expect(decoded).toEqual(fakeBuffer);
  });

  it('truncates overlayId to 64 chars', async () => {
    const { bus, frames } = makeBus();
    const pub = new OverlayPublisher(bus, 'dev-trunc');
    const longId = 'x'.repeat(100);
    await pub.publishOverlay(longId);
    const inner = JSON.parse(frames[0].data ?? '{}');
    expect(inner.overlayId).toHaveLength(64);
  });

  it('setDeviceUuid updates the deviceUuid on subsequent frames', async () => {
    const { bus, frames } = makeBus();
    const pub = new OverlayPublisher(bus, 'old-uuid');
    pub.setDeviceUuid('new-uuid');
    await pub.publishOverlay('depth');
    expect(frames[0].deviceUuid).toBe('new-uuid');
  });
});

describe('OverlayPublisher — non-sim mode', () => {
  it('does not emit a frame when imageBuffer is absent and not in sim', async () => {
    const orig = process.env['NODE_ENV'];
    delete process.env['NODE_ENV'];
    try {
      const { bus, frames } = makeBus();
      const pub = new OverlayPublisher(bus, 'dev-nosim');
      await pub.publishOverlay('depth');
      expect(frames).toHaveLength(0);
    } finally {
      process.env['NODE_ENV'] = orig;
    }
  });

  it('emits a frame when an explicit imageBuffer is provided outside sim', async () => {
    const orig = process.env['NODE_ENV'];
    delete process.env['NODE_ENV'];
    try {
      const { bus, frames } = makeBus();
      const pub = new OverlayPublisher(bus, 'dev-nosim2');
      const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // fake PNG header
      await pub.publishOverlay('depth', buf);
      expect(frames).toHaveLength(1);
    } finally {
      process.env['NODE_ENV'] = orig;
    }
  });
});

describe('DeviceSandboxService — orobot.publishOverlay integration', () => {
  const origEnv = process.env['NODE_ENV'];
  beforeEach(() => { process.env['NODE_ENV'] = 'sim'; });
  afterEach(()  => { process.env['NODE_ENV'] = origEnv; });

  it('exposes orobot.publishOverlay in the vm context and emits overlay-frame', async () => {
    const { DeviceSandboxService } = await import('../core/device-sandbox');
    const { StepperMotor } = await import('../hardware/stepper-motor');
    const { MockGPIODriver } = await import('../hardware/mock-driver');
    const { bus, frames } = makeBus();

    const sandbox = new DeviceSandboxService();
    const { DeviceStateService } = await import('../core/device-state');
    const os = await import('os');
    const tmpPath = `${os.tmpdir()}/overlay-test-state-${Date.now()}.json`;
    const state = new DeviceStateService(tmpPath);
    const motor = new StepperMotor(new MockGPIODriver(), [], bus);

    const code = `orobot.publishOverlay('seg-mask');`;
    sandbox.load(code, motor, state, bus);

    // publishOverlay is async — wait a tick for the promise to resolve
    await new Promise(r => setTimeout(r, 50));
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const inner = JSON.parse(frames[0].data ?? '{}');
    expect(inner.overlayId).toBe('seg-mask');
  });

  it('orobot.publishOverlay is a no-op when no bus is provided (no-bus safety)', async () => {
    // When load() is called without a bus, orobot.publishOverlay should not throw
    const { DeviceSandboxService } = await import('../core/device-sandbox');
    const { StepperMotor } = await import('../hardware/stepper-motor');
    const { MockGPIODriver } = await import('../hardware/mock-driver');
    const { DeviceStateService } = await import('../core/device-state');
    const os = await import('os');
    const tmpPath = `${os.tmpdir()}/overlay-test-nobus-${Date.now()}.json`;
    const state = new DeviceStateService(tmpPath);
    const busLocal = new EventBus();
    const motor = new StepperMotor(new MockGPIODriver(), [], busLocal);

    const sandbox = new DeviceSandboxService();
    expect(() => {
      sandbox.load(`orobot.publishOverlay('test');`, motor, state /*, no bus */);
    }).not.toThrow();
  });
});
