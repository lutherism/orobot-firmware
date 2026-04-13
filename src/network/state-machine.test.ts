import { describe, it, expect } from 'vitest';
import { NetworkStateMachine } from './state-machine';
import { EventBus } from '../core/event-bus';
import { DeviceStateService } from '../core/device-state';
import { makeTmpStateFile } from '../test-utils/make-state';

describe('NetworkStateMachine', () => {
  it('current() reflects the initial networkMode from DeviceState', () => {
    const state = new DeviceStateService(makeTmpStateFile({ networkMode: 'ap' }));
    const bus   = new EventBus();
    const sm    = new NetworkStateMachine(state, bus);
    expect(sm.current).toBe('ap');
  });

  it('valid transition updates current, persists, and emits network:mode-changed', async () => {
    const file  = makeTmpStateFile({ networkMode: 'client' });
    const state = new DeviceStateService(file);
    const bus   = new EventBus();
    const sm    = new NetworkStateMachine(state, bus);

    const events: Array<{ from: string; to: string }> = [];
    bus.on('network:mode-changed', (e) => events.push(e));

    await sm.transition('ap');

    expect(sm.current).toBe('ap');
    expect(state.get().networkMode).toBe('ap');
    expect(events).toEqual([{ from: 'client', to: 'ap' }]);
  });

  it('invalid transition throws and does not change state', async () => {
    const state = new DeviceStateService(makeTmpStateFile({ networkMode: 'client' }));
    const bus   = new EventBus();
    const sm    = new NetworkStateMachine(state, bus);

    await expect(sm.transition('sim')).rejects.toThrow('Invalid transition: client → sim');
    expect(sm.current).toBe('client');
    expect(state.get().networkMode).toBe('client');
  });

  it('sim state has no valid transitions', async () => {
    const state = new DeviceStateService(makeTmpStateFile({ networkMode: 'sim' }));
    const bus   = new EventBus();
    const sm    = new NetworkStateMachine(state, bus);

    await expect(sm.transition('client')).rejects.toThrow('Invalid transition: sim → client');
  });

  it('dev → ap transition is valid', async () => {
    const state = new DeviceStateService(makeTmpStateFile({ networkMode: 'dev' }));
    const bus   = new EventBus();
    const sm    = new NetworkStateMachine(state, bus);

    await sm.transition('ap');

    expect(sm.current).toBe('ap');
    expect(state.get().networkMode).toBe('ap');
  });

  it('dev transition stores devIP in state', async () => {
    const state = new DeviceStateService(makeTmpStateFile({ networkMode: 'client' }));
    const bus   = new EventBus();
    const sm    = new NetworkStateMachine(state, bus);

    await sm.transition('dev', { devIP: '192.168.1.100' });

    expect(sm.current).toBe('dev');
    expect(state.get().devIP).toBe('192.168.1.100');
  });
});
