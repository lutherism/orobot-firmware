/**
 * Installer transport interface.
 *
 * Each supported install medium (WebSerial for ESP32, block-device for SD cards)
 * implements this interface. The Installer view branches on
 * `Distribution.targetKind` to pick the right transport.
 */

export type TransportKind = 'serial-port' | 'block-device';

/** Pointer to a single binary blob the transport must write. */
export interface BinaryRef {
  /** URL the simulator serves the binary at, e.g. `/api/firmware/esp32/bootloader`. */
  url: string;
  /** Decimal flash address (e.g. 4096 for 0x1000). */
  flashAddress: number;
}

export interface Distribution {
  id: string;
  type: string;
  label: string;
  description: string;
  targetKind: TransportKind;
  /** For serial-port targets: each named binary the device firmware needs. */
  binaries?: Record<string, BinaryRef>;
  /** For block-device targets: a single image to write. */
  imageUrl?: string;
  imageSize?: number;
  boardIds: string[];
}

export interface DeviceMetadata {
  transportKind: TransportKind;
  /** User-readable label, e.g. `ESP32-S3 (CP2102N, /dev/ttyUSB0)`. */
  displayName: string;
  /** Free-form transport-specific info: chip family, MAC, drive size, etc. */
  detected?: Record<string, unknown>;
}

export type InstallPhase =
  | 'idle'
  | 'finding'
  | 'found'
  | 'installing'
  | 'verifying'
  | 'success'
  | 'error'
  | 'cancelled';

export interface InstallError {
  code: string;
  message: string;
  guidance: string;
  details?: unknown;
}

export interface InstallState {
  phase: InstallPhase;
  /** 0..1, phase-relative when meaningful. */
  progress: number;
  /** Free-form sub-phase label, e.g. `connecting`, `erasing`, `writing 0x10000`. */
  subPhase?: string;
  log: string[];
  device?: DeviceMetadata;
  error?: InstallError;
}

export interface InstallCallbacks {
  onPhaseChange(phase: InstallPhase, subPhase?: string): void;
  onProgress(progress: number): void;
  onLog(line: string): void;
  onDeviceFound(device: DeviceMetadata): void;
}

export interface ErrorCatalogEntry {
  message: string;
  guidance: string;
}

export interface Transport {
  kind: TransportKind;
  /** Surface a device picker to the user; resolve with the chosen device. */
  findDevice(distribution: Distribution): Promise<DeviceMetadata>;
  /** Write `distribution`'s binaries/image to `device`. */
  install(
    distribution: Distribution,
    device: DeviceMetadata,
    callbacks: InstallCallbacks,
    abortSignal: AbortSignal,
  ): Promise<void>;
  errorCatalog: Record<string, ErrorCatalogEntry>;
}

/** Code raised when the user aborts mid-install. Recognized across transports. */
export const ERR_INSTALL_CANCELLED = 'INSTALL_CANCELLED';
