import { describe, it, expect, vi } from 'vitest';
import { MessageHandlerRegistry } from './registry';
import { EventBus } from '../core/event-bus';
import type { InboundMessage } from '../core/types';

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    type: 'pty-in',
    data: '',
    ackId: 'ack-1',
    deviceUuid: 'dev-123',
    ...overrides,
  };
}

describe('MessageHandlerRegistry', () => {
  it('dispatch calls handler matching exact type', async () => {
    const bus = new EventBus();
    const registry = new MessageHandlerRegistry(bus, () => 'dev-123');
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register('pty-in', handler);
    await registry.dispatch(makeMsg({ type: 'pty-in' }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('dispatch calls handler matching exact data', async () => {
    const bus = new EventBus();
    const registry = new MessageHandlerRegistry(bus, () => 'dev-123');
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register('wifiList', handler);
    await registry.dispatch(makeMsg({ type: 'command-in', data: 'wifiList' }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('dispatch calls handler matching data prefix', async () => {
    const bus = new EventBus();
    const registry = new MessageHandlerRegistry(bus, () => 'dev-123');
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register('gotoangle', true, handler);
    await registry.dispatch(makeMsg({ type: 'command-in', data: 'gotoangle:90' }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ data: 'gotoangle:90' }));
  });

  it('dispatch emits network:send with message-ack after handler', async () => {
    const bus = new EventBus();
    const registry = new MessageHandlerRegistry(bus, () => 'dev-123');
    const sentPayloads: unknown[] = [];
    bus.on('network:send', (p) => sentPayloads.push(p.payload));
    registry.register('pty-in', vi.fn().mockResolvedValue(undefined));
    await registry.dispatch(makeMsg({ type: 'pty-in', ackId: 'ack-42' }));
    expect(sentPayloads).toEqual([
      { type: 'message-ack', ackId: 'ack-42', deviceUuid: 'dev-123' },
    ]);
  });

  it('dispatch sends ack even if handler throws', async () => {
    const bus = new EventBus();
    const registry = new MessageHandlerRegistry(bus, () => 'dev-123');
    const sentPayloads: unknown[] = [];
    bus.on('network:send', (p) => sentPayloads.push(p.payload));
    registry.register('pty-in', vi.fn().mockRejectedValue(new Error('handler error')));
    await registry.dispatch(makeMsg({ type: 'pty-in', ackId: 'ack-fail' }));
    expect(sentPayloads).toHaveLength(1);
    const ack = sentPayloads[0] as Record<string, string>;
    expect(ack.type).toBe('message-ack');
    expect(ack.ackId).toBe('ack-fail');
  });

  it('dispatch with no matching handler still sends ack', async () => {
    const bus = new EventBus();
    const registry = new MessageHandlerRegistry(bus, () => 'dev-123');
    const sentPayloads: unknown[] = [];
    bus.on('network:send', (p) => sentPayloads.push(p.payload));
    await registry.dispatch(makeMsg({ type: 'unknown-type', data: 'unknown-data' }));
    expect(sentPayloads).toHaveLength(1);
    const ack = sentPayloads[0] as Record<string, string>;
    expect(ack.type).toBe('message-ack');
  });
});

describe('MessageHandlerRegistry — priority dispatcher', () => {
  it('priority dispatcher intercepts message and skips registry handler', async () => {
    const bus = new EventBus();
    const registry = new MessageHandlerRegistry(bus, () => 'dev-1');
    const registryHandlerCalled = vi.fn();
    const priorityCalled = vi.fn().mockReturnValue(true);

    registry.register('test', async () => { registryHandlerCalled(); });
    registry.setPriorityDispatcher(priorityCalled);

    await registry.dispatch(makeMsg({ type: 'test' }));

    expect(priorityCalled).toHaveBeenCalled();
    expect(registryHandlerCalled).not.toHaveBeenCalled();
  });

  it('falls through to registry handler when priority dispatcher returns false', async () => {
    const bus = new EventBus();
    const registry = new MessageHandlerRegistry(bus, () => 'dev-1');
    const registryHandlerCalled = vi.fn();

    registry.register('test', async () => { registryHandlerCalled(); });
    registry.setPriorityDispatcher(() => false);

    await registry.dispatch(makeMsg({ type: 'test' }));

    expect(registryHandlerCalled).toHaveBeenCalled();
  });

  it('sends ack regardless of whether priority dispatcher handled the message', async () => {
    const bus = new EventBus();
    const sentPayloads: unknown[] = [];
    bus.on('network:send', (p) => sentPayloads.push(p.payload));
    const registry = new MessageHandlerRegistry(bus, () => 'dev-1');

    registry.setPriorityDispatcher(() => true);
    await registry.dispatch(makeMsg({ ackId: 'ack-99' }));

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0]).toMatchObject({ type: 'message-ack', ackId: 'ack-99' });
  });
});
