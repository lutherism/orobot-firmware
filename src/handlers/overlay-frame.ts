/**
 * OverlayPublisher — firmware-side overlay frame emission.
 *
 * Exposes `publishOverlay(overlayId, imageBuffer)` to device `script.js` code
 * (injected into the vm sandbox by DeviceSandboxService). Emits an
 * `overlay-frame` WS message on the event bus which the gateway relays via
 * PubSub to the browser's `/control` subscriber.
 *
 * Wire format (matches orobotio PR #3615 contract):
 *
 *   Outer envelope: { type: 'overlay-frame', deviceUuid, data: '<JSON string>' }
 *
 *   Inner payload (JSON-serialized into data):
 *   {
 *     overlayId: string,        // e.g. 'depth', 'segmentation'
 *     mimeType:  'image/png',   // always PNG for overlay frames
 *     frame:     string,        // raw bytes as base64 (no data: prefix)
 *     ts:        number,        // ms since session start (Date.now() used here)
 *   }
 *
 * Sim mode: when NODE_ENV=sim and no imageBuffer is provided (or
 * `publishOverlay` is called with null/undefined), a synthetic 8×8
 * checkerboard PNG is generated so the full pipeline can be exercised
 * without a real vision model.
 *
 * Trust model: `overlayId` is a user-supplied string from device script.js.
 * We do NOT execute it, load modules from it, or use it as a filename. It is
 * only embedded as a JSON field value in the WS data payload. Callers must
 * ensure the string is reasonable length — we truncate at 64 chars.
 */

import zlib from 'zlib';
import { promisify } from 'util';
import type { EventBus } from '../core/event-bus';
import { makeEnvelope } from '../core/wire';
import { createLogger } from '../core/logger';

const log = createLogger('overlay-publisher');

const deflate = promisify(zlib.deflate);

const MAX_OVERLAY_ID_LEN = 64;
const SESSION_START_MS   = Date.now();

// ── Minimal PNG encoder ───────────────────────────────────────────────────────
// Produces a valid 8×8 checkerboard PNG (grayscale, 2 colours) without
// any third-party library.  This is only used in sim mode.

function uint32BE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function crc32(data: Buffer): number {
  // Standard CRC-32 table (poly 0xEDB88320 reflected)
  const table = CRC32_TABLE;
  let c = 0xFFFF_FFFF;
  for (let i = 0; i < data.length; i++) c = (c >>> 8) ^ table[(c ^ data[i]) & 0xFF];
  return (c ^ 0xFFFF_FFFF) >>> 0;
}

const CRC32_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t.push(c >>> 0);
  }
  return t;
})();

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcData   = Buffer.concat([typeBytes, data]);
  const crc       = crc32(crcData);
  return Buffer.concat([uint32BE(data.length), typeBytes, data, uint32BE(crc)]);
}

/**
 * Generate a minimal valid PNG: 8×8 checkerboard (black/white squares of 2px).
 * Uses zlib DEFLATE for the IDAT chunk.
 */
async function buildCheckerboardPng(): Promise<Buffer> {
  const W = 8, H = 8;
  // Build raw image rows: each row = filter byte (0 = None) + pixel bytes (grayscale)
  const rawRows = Buffer.alloc(H * (1 + W), 0);
  for (let y = 0; y < H; y++) {
    rawRows[y * (1 + W)] = 0; // filter type: None
    for (let x = 0; x < W; x++) {
      const isLight = ((x >> 1) + (y >> 1)) % 2 === 0;
      rawRows[y * (1 + W) + 1 + x] = isLight ? 255 : 0;
    }
  }

  const idat = await deflate(rawRows, { level: 1 });

  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  // IHDR: width, height, bit-depth=8, colour-type=0 (greyscale), compress=0, filter=0, interlace=0
  const ihdrData = Buffer.concat([
    uint32BE(W), uint32BE(H),
    Buffer.from([8, 0, 0, 0, 0]),
  ]);

  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── OverlayPublisher ──────────────────────────────────────────────────────────

export class OverlayPublisher {
  constructor(
    private readonly bus: EventBus,
    private deviceUuid = '',
  ) {}

  /** Update the device UUID (set when device state resolves). */
  setDeviceUuid(uuid: string): void {
    this.deviceUuid = uuid;
  }

  /**
   * Publish an overlay frame.
   *
   * @param overlayId  Caller-supplied string key (e.g. 'depth', 'segmentation').
   *                   Truncated to 64 chars; never used as a path or exec arg.
   * @param imageBuffer  Raw PNG bytes. If null/undefined AND NODE_ENV=sim, a
   *                     synthetic checkerboard is generated.
   */
  async publishOverlay(overlayId: string, imageBuffer?: Buffer | null): Promise<void> {
    const safeId = String(overlayId).slice(0, MAX_OVERLAY_ID_LEN);

    let frameBuffer: Buffer;
    const isSim = process.env['NODE_ENV'] === 'sim';

    if (imageBuffer && imageBuffer.length > 0) {
      frameBuffer = imageBuffer;
    } else if (isSim) {
      try {
        frameBuffer = await buildCheckerboardPng();
      } catch (err) {
        log.warn({ err }, 'overlay: failed to build sim checkerboard, skipping');
        return;
      }
    } else {
      log.warn({ overlayId: safeId }, 'overlay: no imageBuffer provided and not in sim mode, skipping');
      return;
    }

    const payload = {
      overlayId: safeId,
      mimeType:  'image/png' as const,
      frame:     frameBuffer.toString('base64'),
      ts:        Date.now() - SESSION_START_MS,
    };

    this.bus.emit('network:send', {
      payload: makeEnvelope('overlay-frame', {
        deviceUuid: this.deviceUuid,
        data:       payload,
      }),
    });

    log.debug({ overlayId: safeId, bytes: frameBuffer.length }, 'overlay frame emitted');
  }
}
