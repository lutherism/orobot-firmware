import fs from 'fs';
import path from 'path';
import type {
  NetworkMode,
  DeviceType,
  HardwareProfile,
  WifiCredentials,
} from './types';

export interface DeviceState {
  deviceUuid:    string;
  networkMode:   NetworkMode;
  wifiSettings:  WifiCredentials | null;
  knownNetworks: Array<{ ssid: string; mac: string; password: string }>;
  ownerUuid:     string | null;
  type:          DeviceType;
  hardware:      HardwareProfile;
  pingTime:      number;
  devIP:         string | null;
}

const DEFAULT_STATE: DeviceState = {
  deviceUuid:    '',
  networkMode:   'ap',
  wifiSettings:  null,
  knownNetworks: [],
  ownerUuid:     null,
  type:          'wifi-motor',
  hardware:      'raspi',
  pingTime:      0,
  devIP:         null,
};

export class DeviceStateService {
  private state: DeviceState;

  constructor(private readonly filePath: string) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      this.state = { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch {
      this.state = { ...DEFAULT_STATE };
      this.writeSync();
    }
  }

  get(): Readonly<DeviceState> {
    return Object.freeze({ ...this.state });
  }

  async patch(update: Partial<DeviceState>): Promise<void> {
    this.state = { ...this.state, ...update };
    const tmpPath = this.filePath + '.tmp';
    await fs.promises.writeFile(tmpPath, JSON.stringify(this.state, null, 2));
    await fs.promises.rename(tmpPath, this.filePath);
  }

  private writeSync(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }
}
