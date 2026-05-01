/**
 * WebSerial transport — flashes ESP32 family chips via esptool-js.
 *
 * Browser-only (Chromium WebSerial). Designed to be Vitest-mockable at the
 * `esptool-js` module boundary; the constructor takes an optional
 * `loaderFactory` for tests to inject a fake ESPLoader without touching the
 * real serial subsystem.
 */

import type {
  Distribution,
  DeviceMetadata,
  InstallCallbacks,
  Transport,
  ErrorCatalogEntry,
} from './types';
import { ERR_INSTALL_CANCELLED } from './types';

// Type-only imports from esptool-js — the real module is loaded lazily so
// tests that mock it never trigger a browser-only import path at import time.
type ESPLoaderType = import('esptool-js').ESPLoader;
type TransportType = import('esptool-js').Transport;
type FlashOptions = import('esptool-js').FlashOptions;

export interface LoaderFactoryArgs {
  port: SerialPort;
  baudrate: number;
  terminal?: {
    clean(): void;
    writeLine(data: string): void;
    write(data: string): void;
  };
}

export interface ESPLoaderHandle {
  loader: ESPLoaderType;
  transport: TransportType;
}

export type LoaderFactory = (args: LoaderFactoryArgs) => Promise<ESPLoaderHandle>;

/** Default factory — constructs the real ESPLoader. */
const defaultLoaderFactory: LoaderFactory = async ({ port, baudrate, terminal }) => {
  const mod = await import('esptool-js');
  const transport = new mod.Transport(port, false);
  const loader = new mod.ESPLoader({
    transport,
    baudrate,
    terminal: terminal as ConstructorParameters<typeof mod.ESPLoader>[0]['terminal'],
  });
  return { loader, transport };
};

/** Pick the user-readable display name from an opened port + chip name. */
export function buildDisplayName(chipName: string, portInfo: SerialPortInfo | undefined): string {
  if (!portInfo) return chipName;
  const vidPid = [portInfo.usbVendorId, portInfo.usbProductId]
    .filter(v => typeof v === 'number')
    .map(v => (v as number).toString(16).padStart(4, '0'))
    .join(':');
  return vidPid ? `${chipName} (USB ${vidPid})` : chipName;
}

/** Verify the detected chip matches one of the distribution's declared boardIds. */
export function chipMatchesDistribution(chipName: string, distribution: Distribution): boolean {
  const norm = chipName.toLowerCase().replace(/\s+/g, '-');
  return distribution.boardIds.some(id => {
    const n = id.toLowerCase();
    return norm === n || norm.startsWith(n);
  });
}

export interface WebSerialTransportOptions {
  baudrate?: number;
  loaderFactory?: LoaderFactory;
  /** Browser SerialPort registry (defaults to `navigator.serial`). */
  serial?: { requestPort(options?: SerialPortRequestOptions): Promise<SerialPort> };
  /** Fetcher for binary blobs (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BAUD = 921600;

export class WebSerialTransport implements Transport {
  readonly kind = 'serial-port' as const;
  readonly errorCatalog: Record<string, ErrorCatalogEntry> = ERROR_CATALOG;

  private readonly baudrate: number;
  private readonly loaderFactory: LoaderFactory;
  private readonly serial: { requestPort(options?: SerialPortRequestOptions): Promise<SerialPort> };
  private readonly fetchImpl: typeof fetch;

  /** Set during `findDevice`, consumed during `install`. Cleared on disconnect. */
  private handle: ESPLoaderHandle | undefined;

  constructor(opts: WebSerialTransportOptions = {}) {
    this.baudrate = opts.baudrate ?? DEFAULT_BAUD;
    this.loaderFactory = opts.loaderFactory ?? defaultLoaderFactory;
    this.serial = opts.serial ?? (typeof navigator !== 'undefined' && (navigator as Navigator & { serial?: typeof navigator.serial }).serial
      ? (navigator as Navigator & { serial: typeof navigator.serial }).serial
      : missingSerialShim());
    this.fetchImpl = opts.fetchImpl ?? ((typeof fetch !== 'undefined') ? fetch.bind(globalThis) : missingFetchShim());
  }

  async findDevice(distribution: Distribution): Promise<DeviceMetadata> {
    let port: SerialPort;
    try {
      port = await this.serial.requestPort();
    } catch (err) {
      throw fail('PERMISSION_DENIED', err);
    }

    let handle: ESPLoaderHandle;
    try {
      handle = await this.loaderFactory({ port, baudrate: this.baudrate });
    } catch (err) {
      throw fail('PORT_OPEN_FAILED', err);
    }

    let chipName: string;
    try {
      chipName = await handle.loader.main();
    } catch (err) {
      // Best-effort cleanup so a failed find doesn't leave the port locked.
      await safeDisconnect(handle.transport);
      throw fail('BOOTLOADER_SYNC_FAILED', err);
    }

    if (!chipMatchesDistribution(chipName, distribution)) {
      await safeDisconnect(handle.transport);
      throw fail('CHIP_MISMATCH', { detected: chipName, expected: distribution.boardIds });
    }

    this.handle = handle;
    const info = typeof port.getInfo === 'function' ? port.getInfo() : undefined;
    return {
      transportKind: 'serial-port',
      displayName: buildDisplayName(chipName, info),
      detected: { chip: chipName, ...(info ?? {}) },
    };
  }

  async install(
    distribution: Distribution,
    _device: DeviceMetadata,
    callbacks: InstallCallbacks,
    abortSignal: AbortSignal,
  ): Promise<void> {
    if (!this.handle) {
      throw fail('PORT_OPEN_FAILED', new Error('install called before findDevice'));
    }
    if (!distribution.binaries) {
      throw fail('CHIP_MISMATCH', new Error('distribution has no binaries'));
    }

    const handle = this.handle;
    const checkAbort = () => {
      if (abortSignal.aborted) {
        throw new Error(ERR_INSTALL_CANCELLED);
      }
    };

    callbacks.onPhaseChange('installing', 'fetching');
    callbacks.onLog('Fetching firmware binaries…');

    const entries = Object.entries(distribution.binaries);
    const fileArray: { data: Uint8Array; address: number }[] = [];
    for (const [key, ref] of entries) {
      checkAbort();
      const res = await this.fetchImpl(ref.url);
      if (!res.ok) {
        throw fail('BINARY_NOT_BUILT', { key, url: ref.url, status: res.status });
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      fileArray.push({ data: buf, address: ref.flashAddress });
      callbacks.onLog(`  ${key}: ${buf.byteLength} bytes @ 0x${ref.flashAddress.toString(16)}`);
    }

    checkAbort();
    callbacks.onPhaseChange('installing', 'writing');

    const totalBytes = fileArray.reduce((acc, f) => acc + f.data.byteLength, 0);
    let bytesWrittenSoFar = 0;
    let lastFileIndex = 0;

    const flashOptions: FlashOptions = {
      fileArray: fileArray.map(f => ({
        // esptool-js' compress path expects a binary string; converting via a
        // utility avoids the wire-format gotcha where Uint8Array is passed as JSON.
        data: uint8ToBinaryString(f.data),
        address: f.address,
      })) as unknown as FlashOptions['fileArray'],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        if (fileIndex !== lastFileIndex) {
          // Sum completed-file bytes so the progress bar is monotonically non-decreasing.
          bytesWrittenSoFar += fileArray[lastFileIndex].data.byteLength;
          lastFileIndex = fileIndex;
        }
        const overall = totalBytes > 0 ? (bytesWrittenSoFar + written) / totalBytes : 0;
        callbacks.onProgress(Math.min(1, overall));
        callbacks.onLog(`  ${fileIndex}: ${written}/${total}`);
      },
    };

    try {
      await handle.loader.writeFlash(flashOptions);
    } catch (err) {
      const isCancel = err instanceof Error && err.message === ERR_INSTALL_CANCELLED;
      if (isCancel) throw err;
      throw fail('WRITE_FAILED', err);
    } finally {
      await safeDisconnect(handle.transport);
      this.handle = undefined;
    }

    callbacks.onProgress(1);
    callbacks.onPhaseChange('verifying');
    // V1: we trust esptool-js' write+verify; explicit re-read could land in v1.1.
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface FailedResult extends Error {
  __installerErrorCode: string;
  __installerErrorDetails?: unknown;
}

/** Throwable used by the transport layer; the Installer view unwraps `__installerErrorCode`. */
function fail(code: keyof typeof ERROR_CATALOG, details?: unknown): FailedResult {
  const entry = ERROR_CATALOG[code];
  const err = new Error(entry.message) as FailedResult;
  err.__installerErrorCode = code;
  err.__installerErrorDetails = details;
  return err;
}

async function safeDisconnect(transport: TransportType): Promise<void> {
  try { await transport.disconnect(); } catch { /* swallow — best-effort cleanup */ }
}

function uint8ToBinaryString(arr: Uint8Array): string {
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return s;
}

function missingSerialShim(): never {
  throw new Error('navigator.serial is unavailable in this environment (use Chromium-based browser, or pass `serial` option for tests)');
}

function missingFetchShim(): never {
  throw new Error('global fetch is unavailable (pass `fetchImpl` for tests)');
}

// ─── Error catalog ────────────────────────────────────────────────────────────

export const ERROR_CATALOG: Record<string, ErrorCatalogEntry> = {
  BOOTLOADER_SYNC_FAILED: {
    message: "Couldn't talk to the chip's bootloader.",
    guidance: 'Hold the BOOT button on your board, then click Install again. Some boards need this every time; some auto-enter bootloader mode.',
  },
  CHIP_MISMATCH: {
    message: "This board isn't the chip family this firmware targets.",
    guidance: 'The detected chip and the firmware target don\'t match. Pick a different distribution, or pick a different device.',
  },
  PORT_OPEN_FAILED: {
    message: "Couldn't open the serial port.",
    guidance: 'Another program may have it open (Arduino IDE, screen, `pio device monitor`). Close it and try again.',
  },
  WRITE_FAILED: {
    message: 'Flash write failed mid-stream.',
    guidance: 'Likely a flaky USB cable. Try a different cable — preferably one that came with a known-good USB device. Charge-only cables are a frequent culprit.',
  },
  VERIFY_FAILED: {
    message: "Wrote bytes don't match what was sent.",
    guidance: 'Try once more. If it persists, the flash chip may be wearing out (rare on a new board). Try a different board.',
  },
  WEB_SERIAL_UNSUPPORTED: {
    message: "This browser doesn't support WebSerial.",
    guidance: "Use Chrome, Edge, or Brave on desktop. Firefox and Safari don't support WebSerial yet.",
  },
  PERMISSION_DENIED: {
    message: 'You closed the port-picker without choosing a device.',
    guidance: 'Click Install and pick a port from the prompt.',
  },
  BINARY_NOT_BUILT: {
    message: "Firmware binary wasn't found on the simulator.",
    guidance: 'Build the firmware first: `cd orobot-firmware/esp32 && pio run -e esp32dev`. The simulator serves binaries from `.pio/build/esp32dev/`.',
  },
} as const;

// Minimal WebSerial type aliases — avoid pulling `w3c-web-serial` types into
// the test/node environment where they aren't available.
type SerialPortInfo = {
  usbVendorId?: number;
  usbProductId?: number;
};
type SerialPortRequestOptions = unknown;
interface SerialPort {
  getInfo?(): SerialPortInfo;
}
