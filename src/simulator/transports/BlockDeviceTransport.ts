/**
 * BlockDeviceTransport — placeholder for the SD-card / Pi install path.
 *
 * Declared so the `Transport` interface has a documented second implementer,
 * keeping the abstraction honest. Throws `not-implemented` at every entry point.
 *
 * Per the V1 spec (`2026-04-26-flash-manager-esp32-installer-design.md`), the
 * SD-card path is a non-goal. When it ships, this file gets a real body using
 * `dd` / etcher / equivalent, with the same `Transport` contract.
 */

import type {
  Distribution,
  DeviceMetadata,
  InstallCallbacks,
  Transport,
  ErrorCatalogEntry,
} from './types';

export class BlockDeviceTransport implements Transport {
  readonly kind = 'block-device' as const;
  readonly errorCatalog: Record<string, ErrorCatalogEntry> = {
    NOT_IMPLEMENTED: {
      message: 'SD-card / Raspberry Pi install isn\'t wired yet.',
      guidance: 'Pick the ESP32 distribution for now. The Pi path is a follow-up.',
    },
  };

  async findDevice(_distribution: Distribution): Promise<DeviceMetadata> {
    throw notImplemented();
  }

  async install(
    _distribution: Distribution,
    _device: DeviceMetadata,
    _callbacks: InstallCallbacks,
    _abortSignal: AbortSignal,
  ): Promise<void> {
    throw notImplemented();
  }
}

function notImplemented(): Error & { __installerErrorCode: string } {
  const err = new Error('SD-card install not yet implemented') as Error & { __installerErrorCode: string };
  err.__installerErrorCode = 'NOT_IMPLEMENTED';
  return err;
}
