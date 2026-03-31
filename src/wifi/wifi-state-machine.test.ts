import { describe, it, expect, vi } from 'vitest';
import { WifiStateMachine } from './wifi-state-machine';
import { EventBus } from '../core/event-bus';

describe('WifiStateMachine', () => {
  it('starts in UNCONFIGURED state', () => {
    const sm = new WifiStateMachine(new EventBus());
    expect(sm.current).toBe('UNCONFIGURED');
  });

  it('UNCONFIGURED → SETUP_MODE is valid', () => {
    const sm = new WifiStateMachine(new EventBus());
    sm.transition('SETUP_MODE');
    expect(sm.current).toBe('SETUP_MODE');
  });

  it('UNCONFIGURED → CONNECTING is valid', () => {
    const sm = new WifiStateMachine(new EventBus());
    sm.transition('CONNECTING');
    expect(sm.current).toBe('CONNECTING');
  });

  it('UNCONFIGURED → CONNECTED throws', () => {
    const sm = new WifiStateMachine(new EventBus());
    expect(() => sm.transition('CONNECTED')).toThrow('Invalid WiFi transition');
  });

  it('full happy path: UNCONFIGURED → CONNECTING → CONNECTED → DEGRADED → RECONNECTING → CONNECTED', () => {
    const sm = new WifiStateMachine(new EventBus());
    sm.transition('CONNECTING');
    sm.transition('CONNECTED');
    sm.transition('DEGRADED');
    sm.transition('RECONNECTING');
    sm.transition('CONNECTED');
    expect(sm.current).toBe('CONNECTED');
  });

  it('provision path: SETUP_MODE → PROVISIONING → CONNECTING', () => {
    const sm = new WifiStateMachine(new EventBus());
    sm.transition('SETUP_MODE');
    sm.transition('PROVISIONING');
    sm.transition('CONNECTING');
    expect(sm.current).toBe('CONNECTING');
  });

  it('SETUP_MODE → CONNECTING is valid (goto-client with saved creds)', () => {
    const sm = new WifiStateMachine(new EventBus());
    sm.transition('SETUP_MODE');
    sm.transition('CONNECTING');
    expect(sm.current).toBe('CONNECTING');
  });

  it('CONNECTING → SETUP_MODE is valid (fallback on failures)', () => {
    const sm = new WifiStateMachine(new EventBus());
    sm.transition('CONNECTING');
    sm.transition('SETUP_MODE');
    expect(sm.current).toBe('SETUP_MODE');
  });

  it('RECONNECTING → SETUP_MODE is valid (max retries exceeded)', () => {
    const sm = new WifiStateMachine(new EventBus());
    sm.transition('CONNECTING');
    sm.transition('CONNECTED');
    sm.transition('DEGRADED');
    sm.transition('RECONNECTING');
    sm.transition('SETUP_MODE');
    expect(sm.current).toBe('SETUP_MODE');
  });

  it('emits wifi:state-changed with from and to on each transition', () => {
    const bus     = new EventBus();
    const handler = vi.fn();
    bus.on('wifi:state-changed', handler);
    const sm = new WifiStateMachine(bus);
    sm.transition('SETUP_MODE');
    expect(handler).toHaveBeenCalledWith({ from: 'UNCONFIGURED', to: 'SETUP_MODE' });
  });
});
