/**
 * CameraStreamService — continuous MJPEG frame capture and relay.
 *
 * On real hardware (non-sim): spawns `ffmpeg -f v4l2 -i <device> -vf fps=<N>
 * -vf scale=640:360 -f mjpeg -q:v 5 pipe:1` and emits each JPEG frame as a
 * `camera-frame` WS message on the event bus.
 *
 * In sim mode (NODE_ENV=sim) or when OROBOT_CAMERA_FRAME_PATH is set: uses a
 * static frame file (or a built-in SVG placeholder) and emits it at the
 * configured fps without spawning any subprocess. No hardware required.
 *
 * Lifecycle:
 *   service.start(deviceUuid, config)  — begin streaming
 *   service.stop()                     — stop streaming, kill subprocess
 *   service.isRunning                  — true while streaming
 *
 * Backoff: if ffmpeg exits unexpectedly, the service restarts it after an
 * exponential delay (1 s → 2 s → 4 s … capped at 60 s).
 */

import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import type { EventBus } from '../core/event-bus';
import { makeEnvelope } from '../core/wire';
import type { CameraConfig } from '../core/program-config';
import { createLogger } from '../core/logger';

const log = createLogger('camera-stream');

const DEFAULT_DEVICE  = '/dev/video0';
const DEFAULT_FPS     = 10;
const MIN_FPS         = 1;
const MAX_FPS         = 30;
const MAX_BACKOFF_MS  = 60_000;

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#101820"/><path d="M272 140h96l20 28h44v116H208V168h44z" fill="#234"/><circle cx="320" cy="226" r="52" fill="#5fd3ff"/><circle cx="320" cy="226" r="30" fill="#101820"/><text x="320" y="326" text-anchor="middle" fill="#cde" font-family="monospace" font-size="18">orobot sim</text></svg>`;

/** Dependency-injected subprocess spawner (allows mocking in tests). */
export type FfmpegSpawner = (
  device: string,
  fps: number,
) => ChildProcess;

export function defaultFfmpegSpawner(device: string, fps: number): ChildProcess {
  return spawn('ffmpeg', [
    '-f',   'v4l2',
    '-i',   device,
    '-vf',  `fps=${fps},scale=640:360`,
    '-f',   'mjpeg',
    '-q:v', '5',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Build a single CameraFrame for sim / fallback use.
 * Uses OROBOT_CAMERA_FRAME_PATH env var if set, otherwise the built-in SVG.
 */
async function buildSimFrame(): Promise<{ mimeType: string; frame: string }> {
  const framePath = process.env['OROBOT_CAMERA_FRAME_PATH'];
  if (framePath) {
    const data = await fs.promises.readFile(framePath);
    const lower = framePath.toLowerCase();
    const mimeType = lower.endsWith('.png')  ? 'image/png'
                   : lower.endsWith('.webp') ? 'image/webp'
                   : lower.endsWith('.gif')  ? 'image/gif'
                   : lower.endsWith('.svg')  ? 'image/svg+xml'
                   : 'image/jpeg';
    return { mimeType, frame: data.toString('base64') };
  }
  return {
    mimeType: 'image/svg+xml',
    frame:    Buffer.from(FALLBACK_SVG, 'utf-8').toString('base64'),
  };
}

export class CameraStreamService {
  private running      = false;
  private deviceUuid   = '';
  private ffmpegProc:  ChildProcess | null = null;
  private simTimer:    ReturnType<typeof setInterval> | null = null;
  private backoffMs    = 1_000;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly bus: EventBus,
    private readonly spawner: FfmpegSpawner = defaultFfmpegSpawner,
  ) {}

  get isRunning(): boolean { return this.running; }

  /** Start streaming. Calling start() while already running is a no-op. */
  start(deviceUuid: string, config: CameraConfig): void {
    if (this.running) return;
    this.running    = true;
    this.deviceUuid = deviceUuid;
    this.backoffMs  = 1_000;

    const fps    = Math.min(MAX_FPS, Math.max(MIN_FPS, config.fps ?? DEFAULT_FPS));
    const device = config.device ?? DEFAULT_DEVICE;

    const isSim = process.env['NODE_ENV'] === 'sim' || Boolean(process.env['OROBOT_CAMERA_FRAME_PATH']);
    if (isSim) {
      this._startSim(fps);
    } else {
      this._startFfmpeg(device, fps);
    }
    log.info({ deviceUuid, fps, device, isSim }, 'camera stream started');
  }

  /** Stop streaming and release resources. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this._cleanup();
    log.info({ deviceUuid: this.deviceUuid }, 'camera stream stopped');
  }

  // ── private ──────────────────────────────────────────────────────────────

  private _emit(mimeType: string, frameB64: string): void {
    this.bus.emit('network:send', {
      payload: makeEnvelope('camera-frame', {
        deviceUuid: this.deviceUuid,
        data: {
          mimeType,
          encoding: 'base64',
          frame: frameB64,
          capturedAt: new Date().toISOString(),
          width:  640,
          height: 360,
        },
      }),
    });
  }

  private _startSim(fps: number): void {
    const intervalMs = Math.floor(1000 / fps);
    this.simTimer = setInterval(async () => {
      if (!this.running) return;
      try {
        const { mimeType, frame } = await buildSimFrame();
        this._emit(mimeType, frame);
      } catch (err) {
        log.warn({ err }, 'sim frame build failed');
      }
    }, intervalMs);
  }

  private _startFfmpeg(device: string, fps: number): void {
    const proc = this.spawner(device, fps);
    this.ffmpegProc = proc;

    // ffmpeg outputs raw JPEG frames separated by MJPEG boundary markers.
    // Buffer incoming data and emit each complete JPEG (SOI/EOI pair).
    let buf = Buffer.alloc(0);

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (!this.running) return;
      buf = Buffer.concat([buf, chunk]);
      // Extract complete JPEG frames: SOI = 0xFFD8, EOI = 0xFFD9
      let start = 0;
      while (start < buf.length - 1) {
        if (buf[start] !== 0xFF || buf[start + 1] !== 0xD8) { start++; continue; }
        const end = buf.indexOf(Buffer.from([0xFF, 0xD9]), start + 2);
        if (end === -1) break;
        const frame = buf.slice(start, end + 2);
        this._emit('image/jpeg', frame.toString('base64'));
        buf   = buf.slice(end + 2);
        start = 0;
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      log.debug({ msg: chunk.toString() }, 'ffmpeg stderr');
    });

    proc.on('error', (err) => {
      if (!this.running) return;
      log.warn({ err }, 'ffmpeg process error');
      this._scheduleRestart(device, fps);
    });

    proc.on('close', (code) => {
      if (!this.running) return;
      log.warn({ code }, 'ffmpeg exited unexpectedly, scheduling restart');
      this._scheduleRestart(device, fps);
    });
  }

  private _scheduleRestart(device: string, fps: number): void {
    this.ffmpegProc = null;
    if (!this.running) return;
    log.info({ backoffMs: this.backoffMs }, 'camera: scheduling restart');
    this.restartTimer = setTimeout(() => {
      if (!this.running) return;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this._startFfmpeg(device, fps);
    }, this.backoffMs);
  }

  private _cleanup(): void {
    if (this.simTimer) { clearInterval(this.simTimer);   this.simTimer    = null; }
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.ffmpegProc) {
      try { this.ffmpegProc.kill('SIGTERM'); } catch { /* already dead */ }
      this.ffmpegProc = null;
    }
  }
}
