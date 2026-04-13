import os from 'os';
import path from 'path';
import fs from 'fs';
import { DeviceStateService } from '../core/device-state';
import type { DeviceState } from '../core/device-state';

/**
 * Creates a temporary data.json file with sensible defaults, applies any
 * partial overrides, and returns the file path.
 */
export function makeTmpStateFile(overrides: Partial<DeviceState> = {}): string {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-test-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify({
    deviceUuid:    'test-uuid',
    networkMode:   'client',
    wifiSettings:  null,
    knownNetworks: [],
    ownerUuid:     null,
    type:          'wifi-motor',
    hardware:      'raspi',
    pingTime:      0,
    devIP:         null,
    ...overrides,
  }));
  return file;
}

/**
 * Creates a DeviceStateService backed by a temporary file with sensible
 * defaults. Pass partial overrides to customise specific fields.
 */
export function makeTmpState(overrides: Partial<DeviceState> = {}): DeviceStateService {
  return new DeviceStateService(makeTmpStateFile(overrides));
}
