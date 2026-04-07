export type NetworkMode = 'client' | 'ap' | 'dev' | 'sim';
export type DeviceType  = 'wifi-motor' | 'wifi-camera' | (string & {});
export type HardwareProfile = 'raspi' | 'banana' | (string & {});

export type WifiState =
  | 'UNCONFIGURED'
  | 'SETUP_MODE'
  | 'PROVISIONING'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DEGRADED'
  | 'RECONNECTING';

export interface ScanResult {
  ssid:     string;
  mac:      string;
  security: string;
}

export interface ConnectionQuality {
  rssi:      number;
  linkSpeed: number;
  frequency: number;
}

export interface WifiCredentials {
  ssid:     string;
  password: string;
}

export interface InboundMessage {
  type:       string;
  data:       string;
  ackId:      string;
  deviceUuid: string;
}
