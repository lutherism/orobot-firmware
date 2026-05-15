/**
 * CameraStreamService — Continuous MJPEG frame push to the gateway relay.
 *
 * Architecture:
 *   - Activated when `config.camera === true` AND `deviceState.deviceSecret` is set.
 *   - On start, exchanges the device secret for a session token via
 *     POST /api/device/:uuid/session.
 *   - Loops: capture a JPEG frame → POST raw bytes to
 *     POST /api/device/:uuid/stream/push (Authorization: Bearer <token>).
 *   - Proactively refreshes the session token when it nears expiry (within 5 min).
 *   - Restarts the push loop with exponential backoff (2 s → 60 s) on any
 *     unrecoverable error (network failure, 4xx auth, process crash).
 *   - In `NODE_ENV=sim` uses a static 1×1 white JPEG so no hardware is needed.
 *   - Calling stop() halts the loop cleanly on the next iteration.
 */

import { createLogger } from '../core/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Raw JPEG bytes to push to the gateway. */
export type FrameSource = () => Promise<Buffer>;

/** Minimal fetch-like interface for DI in tests. */
export type FetchFn = typeof fetch;

/** Injected sleep function for testing backoff without real delays. */
export type SleepFn = (ms: number) => Promise<void>;

export interface CameraStreamOptions {
  deviceUuid:      string;
  /** Device secret used to obtain session tokens. */
  deviceSecret:    string;
  /** HTTP base URL of the gateway, e.g. "http://localhost:8080". */
  gatewayHttpBase: string;
  /** Frame source — defaults to a 1×1 white JPEG in sim mode, or raspivid in prod. */
  frameSource?:    FrameSource;
  /** Milliseconds between frame pushes. Defaults to 100 ms (≈10 fps). */
  frameIntervalMs?: number;
  /** Injected fetch for tests. Defaults to the global `fetch`. */
  fetchFn?:        FetchFn;
  /** Injected sleep for tests. */
  sleepFn?:        SleepFn;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_FRAME_INTERVAL_MS = 100; // 10 fps
const MIN_BACKOFF_MS            = 2_000;
const MAX_BACKOFF_MS            = 60_000;
/** Re-fetch a token when fewer than this many ms remain until expiry. */
const TOKEN_REFRESH_BEFORE_MS   = 5 * 60 * 1_000; // 5 minutes

// ── Sim-mode frame source ─────────────────────────────────────────────────────

/**
 * Minimal 1×1 white JPEG for use in NODE_ENV=sim.
 * Produced with: `convert -size 1x1 xc:white x.jpg | xxd -i`
 */
const SIM_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
  0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03,
  0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d,
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
  0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72,
  0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
  0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75,
  0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4,
  0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7,
  0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
  0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3,
  0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5,
  0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00,
  0x00, 0x3f, 0x00, 0xfb, 0xd5, 0xff, 0xd9,
]);

export function simFrameSource(): Promise<Buffer> {
  return Promise.resolve(SIM_JPEG);
}

// ── Session token management ──────────────────────────────────────────────────

interface SessionToken {
  token:     string;
  expiresAt: number; // unix ms
}

async function fetchSessionToken(
  gatewayHttpBase: string,
  deviceUuid:      string,
  deviceSecret:    string,
  fetchFn:         FetchFn,
): Promise<SessionToken> {
  const res = await fetchFn(`${gatewayHttpBase}/api/device/${deviceUuid}/session`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ secret: deviceSecret }),
  });
  if (!res.ok) {
    throw new Error(`Session request failed: ${res.status}`);
  }
  const json = await res.json() as { sessionToken: string; expiresAt: number };
  return { token: json.sessionToken, expiresAt: json.expiresAt };
}

// ── CameraStreamService ───────────────────────────────────────────────────────

export class CameraStreamService {
  private readonly log = createLogger('camera-stream');
  private running = false;

  private readonly fetchFn:         FetchFn;
  private readonly sleepFn:         SleepFn;
  private readonly frameSource:     FrameSource;
  private readonly frameIntervalMs: number;

  constructor(private readonly opts: CameraStreamOptions) {
    this.fetchFn         = opts.fetchFn         ?? globalThis.fetch.bind(globalThis);
    this.sleepFn         = opts.sleepFn         ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.frameIntervalMs = opts.frameIntervalMs ?? DEFAULT_FRAME_INTERVAL_MS;

    if (opts.frameSource) {
      this.frameSource = opts.frameSource;
    } else if (process.env['NODE_ENV'] === 'sim') {
      this.frameSource = simFrameSource;
    } else {
      this.frameSource = this.raspividFrameSource.bind(this);
    }
  }

  /**
   * Production frame source: reads from raspivid → ffmpeg pipeline.
   * In practice this is overridden in tests via opts.frameSource.
   */
  private async raspividFrameSource(): Promise<Buffer> {
    const { execFile } = await import('child_process');
    return new Promise<Buffer>((resolve, reject) => {
      // Capture a single JPEG frame via raspistill (simpler than a streaming pipeline
      // for single-frame-per-POST architecture).
      // Width/height are kept small to stay under the 2 MiB gateway limit.
      execFile('raspistill', ['-w', '640', '-h', '360', '-t', '1', '-o', '-', '-e', 'jpg'], {
        encoding: 'buffer',
        maxBuffer: 2 * 1024 * 1024,
      }, (err, stdout) => {
        if (err) { reject(err); return; }
        resolve(stdout as unknown as Buffer);
      });
    });
  }

  /**
   * Start the streaming loop.
   *
   * Returns a Promise that resolves only when stop() is called.
   * Errors inside the loop are caught and retried with exponential backoff —
   * this method itself never throws.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.log.info({ deviceUuid: this.opts.deviceUuid }, 'Camera stream starting');

    let backoffMs = MIN_BACKOFF_MS;
    let session: SessionToken | null = null;

    while (this.running) {
      try {
        // (Re-)acquire session token if absent or nearing expiry.
        const now = Date.now();
        if (!session || session.expiresAt - now < TOKEN_REFRESH_BEFORE_MS) {
          session = await fetchSessionToken(
            this.opts.gatewayHttpBase,
            this.opts.deviceUuid,
            this.opts.deviceSecret,
            this.fetchFn,
          );
          this.log.debug({ expiresAt: session.expiresAt }, 'Session token acquired');
        }

        // Capture and push one frame.
        const frame = await this.frameSource();

        const res = await this.fetchFn(
          `${this.opts.gatewayHttpBase}/api/device/${this.opts.deviceUuid}/stream/push`,
          {
            method:  'POST',
            headers: {
              'Authorization':  `Bearer ${session.token}`,
              'Content-Type':   'image/jpeg',
              'Content-Length': String(frame.length),
            },
            body: frame,
          },
        );

        if (res.status === 401 || res.status === 403) {
          // Token rejected — force re-acquisition on next iteration.
          this.log.warn({ status: res.status }, 'Session token rejected, will re-acquire');
          session = null;
        } else if (!res.ok) {
          throw new Error(`Stream push failed: ${res.status}`);
        } else {
          // Success — reset backoff.
          backoffMs = MIN_BACKOFF_MS;
        }

        await this.sleepFn(this.frameIntervalMs);

      } catch (err) {
        this.log.warn({ err, backoffMs }, 'Camera stream error, backing off');
        session = null;
        await this.sleepFn(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    }

    this.log.info({ deviceUuid: this.opts.deviceUuid }, 'Camera stream stopped');
  }

  /** Signal the streaming loop to stop after the current iteration. */
  stop(): void {
    this.running = false;
  }
}
