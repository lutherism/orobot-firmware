import type { WifiShellAdapter } from './types';
import type { ScanResult, WifiCredentials } from '../core/types';

export interface PushCall {
  targetSsid: string;
  creds:      WifiCredentials;
}

export class MockWifiShellAdapter implements WifiShellAdapter {
  readonly connectCalls: WifiCredentials[] = [];
  readonly pushCalls:    PushCall[]        = [];
  startAPCalls = 0;
  stopAPCalls  = 0;

  private _scanResults: ScanResult[] = [];

  setScanResults(results: ScanResult[]): void {
    this._scanResults = results;
  }

  async scanNetworks(): Promise<ScanResult[]> {
    return this._scanResults;
  }

  async connectToNetwork(creds: WifiCredentials): Promise<void> {
    this.connectCalls.push(creds);
  }

  async startAP(): Promise<void> {
    this.startAPCalls++;
  }

  async stopAP(): Promise<void> {
    this.stopAPCalls++;
  }

  async pushCredentials(targetSsid: string, creds: WifiCredentials): Promise<void> {
    this.pushCalls.push({ targetSsid, creds });
  }
}
