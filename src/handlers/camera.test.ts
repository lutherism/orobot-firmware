/**
 * Tests for camera.ts — captureCameraFrame and createCameraHandler.
 *
 * createCameraHandler is also exercised in handlers.test.ts; these tests
 * focus on captureCameraFrame (file-path branch vs SVG fallback) and the
 * inferMimeType helper (all 5 branches), which are not covered elsewhere.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../core/event-bus.js';
import { captureCameraFrame, createCameraHandler } from './camera.js';
import fs from 'fs';

// ── inferMimeType (tested indirectly via captureCameraFrame with a spy) ──────
// Direct access: since inferMimeType is not exported we exercise it via
// captureCameraFrame with a controlled OROBOT_CAMERA_FRAME_PATH.

const ORIG_FRAME_PATH = process.env.OROBOT_CAMERA_FRAME_PATH;

afterEach(() => {
  if (ORIG_FRAME_PATH === undefined) {
    delete process.env.OROBOT_CAMERA_FRAME_PATH;
  } else {
    process.env.OROBOT_CAMERA_FRAME_PATH = ORIG_FRAME_PATH;
  }
  vi.restoreAllMocks();
});

// Stub fs.promises.readFile so we don't hit the actual filesystem
function stubReadFile(content: Buffer) {
  vi.spyOn(fs.promises, 'readFile').mockResolvedValue(content as any);
}

describe('captureCameraFrame — SVG fallback (no env var)', () => {
  beforeEach(() => { delete process.env.OROBOT_CAMERA_FRAME_PATH; });

  it('returns image/svg+xml mimeType', async () => {
    const f = await captureCameraFrame();
    expect(f.mimeType).toBe('image/svg+xml');
  });

  it('returns base64 encoding', async () => {
    const f = await captureCameraFrame();
    expect(f.encoding).toBe('base64');
  });

  it('returns a non-empty frame string', async () => {
    const f = await captureCameraFrame();
    expect(f.frame.length).toBeGreaterThan(0);
  });

  it('includes width=640 and height=360', async () => {
    const f = await captureCameraFrame();
    expect(f.width).toBe(640);
    expect(f.height).toBe(360);
  });

  it('includes a capturedAt ISO timestamp', async () => {
    const f = await captureCameraFrame();
    expect(() => new Date(f.capturedAt)).not.toThrow();
    expect(new Date(f.capturedAt).toISOString()).toBe(f.capturedAt);
  });
});

describe('captureCameraFrame — OROBOT_CAMERA_FRAME_PATH set', () => {
  it('reads the file and returns base64-encoded content', async () => {
    process.env.OROBOT_CAMERA_FRAME_PATH = '/fake/shot.jpg';
    const fakeData = Buffer.from('fake-jpeg-bytes');
    stubReadFile(fakeData);
    const f = await captureCameraFrame();
    expect(f.mimeType).toBe('image/jpeg');
    expect(f.frame).toBe(fakeData.toString('base64'));
  });

  it('infers image/png for .png extension', async () => {
    process.env.OROBOT_CAMERA_FRAME_PATH = '/tmp/snap.PNG';
    stubReadFile(Buffer.from('png-data'));
    const f = await captureCameraFrame();
    expect(f.mimeType).toBe('image/png');
  });

  it('infers image/webp for .webp extension', async () => {
    process.env.OROBOT_CAMERA_FRAME_PATH = '/tmp/snap.webp';
    stubReadFile(Buffer.from('webp-data'));
    const f = await captureCameraFrame();
    expect(f.mimeType).toBe('image/webp');
  });

  it('infers image/gif for .gif extension', async () => {
    process.env.OROBOT_CAMERA_FRAME_PATH = '/tmp/anim.gif';
    stubReadFile(Buffer.from('gif-data'));
    const f = await captureCameraFrame();
    expect(f.mimeType).toBe('image/gif');
  });

  it('infers image/svg+xml for .svg extension', async () => {
    process.env.OROBOT_CAMERA_FRAME_PATH = '/tmp/icon.svg';
    stubReadFile(Buffer.from('<svg/>'));
    const f = await captureCameraFrame();
    expect(f.mimeType).toBe('image/svg+xml');
  });

  it('defaults to image/jpeg for unknown extension', async () => {
    process.env.OROBOT_CAMERA_FRAME_PATH = '/tmp/raw.bmp';
    stubReadFile(Buffer.from('bmp-data'));
    const f = await captureCameraFrame();
    expect(f.mimeType).toBe('image/jpeg');
  });

  it('does not include width/height fields on file-read path', async () => {
    process.env.OROBOT_CAMERA_FRAME_PATH = '/tmp/snap.jpg';
    stubReadFile(Buffer.from('data'));
    const f = await captureCameraFrame();
    expect(f.width).toBeUndefined();
    expect(f.height).toBeUndefined();
  });
});

describe('createCameraHandler', () => {
  it('emits network:send with camera-frame type and frame data', async () => {
    const bus = new EventBus();
    const emitted: any[] = [];
    bus.on('network:send', (e) => emitted.push(e));

    const fakeCapture = vi.fn().mockResolvedValue({
      mimeType: 'image/jpeg',
      encoding: 'base64' as const,
      frame: 'abc123',
      capturedAt: new Date().toISOString(),
    });

    const handler = createCameraHandler(bus, fakeCapture);
    await handler({ type: 'camera', deviceUuid: 'd1', userUuid: 'u1', data: '' });

    expect(emitted).toHaveLength(1);
    const payload = emitted[0].payload;
    expect(payload.type).toBe('camera-frame');
    // makeEnvelope JSON.stringifies non-string data; parse it back to inspect
    const dataObj = JSON.parse(payload.data as string);
    expect(dataObj.frame).toBe('abc123');
  });
});
