import type { ScanResult, WifiCredentials } from '../core/types';

export interface WifiShellAdapter {
  scanNetworks(): Promise<ScanResult[]>;
  connectToNetwork(creds: WifiCredentials): Promise<void>;
  startAP(): Promise<void>;
  stopAP(): Promise<void>;
  pushCredentials(targetSsid: string, creds: WifiCredentials): Promise<void>;
}
