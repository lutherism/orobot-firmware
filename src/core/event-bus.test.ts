import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './event-bus';

describe('EventBus', () => {
  it('delivers a typed event to a subscriber', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('network:mode-changed', handler);
    bus.emit('network:mode-changed', { from: 'client', to: 'ap' });
    expect(handler).toHaveBeenCalledWith({ from: 'client', to: 'ap' });
  });

  it('returns an unsubscribe function that stops delivery', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.on('network:connected', handler);
    unsub();
    bus.emit('network:connected', { url: 'ws://test' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not deliver events to subscribers on a different channel', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('network:disconnected', handler);
    bus.emit('network:connected', { url: 'ws://test' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers to multiple subscribers on the same channel', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('hardware:motor-moved', h1);
    bus.on('hardware:motor-moved', h2);
    bus.emit('hardware:motor-moved', { angle: 90 });
    expect(h1).toHaveBeenCalledWith({ angle: 90 });
    expect(h2).toHaveBeenCalledWith({ angle: 90 });
  });

  it('unsubscribing one handler does not affect others on the same channel', () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    const unsub1 = bus.on('hardware:motor-moved', h1);
    bus.on('hardware:motor-moved', h2);
    unsub1();
    bus.emit('hardware:motor-moved', { angle: 45 });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith({ angle: 45 });
  });

  it('once() delivers the event exactly one time', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.once('hardware:motor-moved', handler);
    bus.emit('hardware:motor-moved', { angle: 90 });
    bus.emit('hardware:motor-moved', { angle: 45 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ angle: 90 });
  });

  it('once() returns an unsubscribe function that cancels before first fire', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsub = bus.once('system:heartbeat-sent', handler);
    unsub();
    bus.emit('system:heartbeat-sent', { pingTime: 42 });
    expect(handler).not.toHaveBeenCalled();
  });
});
