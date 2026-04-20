import { EventEmitter } from 'events';
import type {
  NetworkMode,
  WifiState,
  ScanResult,
  ConnectionQuality,
} from './types';

export type EventMap = {
  'network:mode-changed':     { from: NetworkMode; to: NetworkMode };
  'network:connected':        { url: string };
  'network:disconnected':     { reason: string };
  'network:message':          { type: string; data: string; ackId: string };
  'network:send':             { payload: Record<string, unknown> };
  'hardware:motor-moved':     { angle: number };
  'hardware:motor-error':     { error: Error };
  'pty:output':               { data: string };
  'wifi:state-changed':       { from: WifiState; to: WifiState };
  'wifi:scan-complete':       { networks: ScanResult[] };
  'wifi:provision-progress':  { step: string; percent: number };
  'wifi:connected':           { ssid: string; quality: ConnectionQuality };
  'wifi:disconnected':         { reason: string };
  'wifi:credentials-shared':   { targetSsid: string };
  'wifi:goto-client-requested': Record<string, never>;
  'portal:claim-code-stored': { code: string };
  'system:heartbeat-sent':    { pingTime: number };
  'system:reboot-requested':  Record<string, never>;
  'system:update-requested':  Record<string, never>;
  'system:device-discovered': { uuid: string; ip: string; name: string };
  'system:device-lost':       { uuid: string };
};

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
    this.emitter.on('error', () => {});
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.emitter.emit(event as string, payload);
  }

  on<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): () => void {
    this.emitter.on(event as string, handler);
    return () => this.emitter.off(event as string, handler);
  }

  once<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): () => void {
    this.emitter.once(event as string, handler);
    return () => this.emitter.off(event as string, handler);
  }
}
