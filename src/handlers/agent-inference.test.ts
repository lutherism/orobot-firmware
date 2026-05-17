import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../core/event-bus';
import type { InboundMessage } from '../core/types';
import type { Agent } from '../agent';
import type { InferenceResult } from '../agent/types';
import { createAgentInferenceHandler } from './agent-inference';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  // Encode a 1-byte "image" as base64 so Buffer.from succeeds
  const base64 = Buffer.from([0xff]).toString('base64');
  return {
    type:       'agent-inference-request',
    data:       base64,
    ackId:      'ack-1',
    deviceUuid: 'dev-abc',
    ...overrides,
  };
}

const MOCK_RESULT: InferenceResult = {
  labels: ['cat', 'dog'],
  boxes:  [
    { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
  ],
  scores: [0.92, 0.85],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createAgentInferenceHandler', () => {
  let bus:  EventBus;
  let sent: unknown[];

  const mockAgent: Agent = {
    analyze: vi.fn().mockResolvedValue(MOCK_RESULT),
    load:    vi.fn().mockResolvedValue(undefined),
    get backend() { return 'onnx'; },
  } as unknown as Agent;

  beforeEach(() => {
    bus  = new EventBus();
    sent = [];
    bus.on('network:send', (p) => sent.push(p.payload));
    vi.mocked(mockAgent.analyze).mockClear();
    vi.mocked(mockAgent.analyze).mockResolvedValue(MOCK_RESULT);
  });

  /**
   * Wait for the setImmediate-deferred inference to complete.
   * Two microtask ticks: one for setImmediate, one for the async body.
   */
  async function flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.resolve();
    await Promise.resolve();
  }

  it('calls agent.analyze() with a Buffer decoded from the base64 data field', async () => {
    const handler = createAgentInferenceHandler(bus, mockAgent);
    await handler(makeMsg());
    await flush();

    expect(mockAgent.analyze).toHaveBeenCalledOnce();
    const [buf] = vi.mocked(mockAgent.analyze).mock.calls[0]!;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf[0]).toBe(0xff);
  });

  it('emits agent-inference-result with the InferenceResult from agent.analyze()', async () => {
    const handler = createAgentInferenceHandler(bus, mockAgent);
    await handler(makeMsg({ deviceUuid: 'dev-xyz' }));
    await flush();

    expect(sent).toHaveLength(1);
    const envelope = sent[0] as Record<string, unknown>;
    expect(envelope['type']).toBe('agent-inference-result');
    expect(envelope['deviceUuid']).toBe('dev-xyz');

    const data = JSON.parse(envelope['data'] as string) as Record<string, unknown>;
    expect(data['labels']).toEqual(MOCK_RESULT.labels);
    expect(data['boxes']).toEqual(MOCK_RESULT.boxes);
    expect(data['scores']).toEqual(MOCK_RESULT.scores);
  });

  it('data field is always a JSON string (wire contract)', async () => {
    const handler = createAgentInferenceHandler(bus, mockAgent);
    await handler(makeMsg());
    await flush();

    const envelope = sent[0] as Record<string, unknown>;
    expect(typeof envelope['data']).toBe('string');
    expect(() => JSON.parse(envelope['data'] as string)).not.toThrow();
  });

  it('emits error result when agent is null', async () => {
    const handler = createAgentInferenceHandler(bus, null);
    await handler(makeMsg({ deviceUuid: 'dev-abc' }));
    await flush();

    expect(sent).toHaveLength(1);
    const envelope = sent[0] as Record<string, unknown>;
    expect(envelope['type']).toBe('agent-inference-result');
    const data = JSON.parse(envelope['data'] as string) as Record<string, unknown>;
    expect(typeof data['error']).toBe('string');
    expect(data['error']).toContain('No inference agent');
  });

  it('emits error result when agent.analyze() throws', async () => {
    vi.mocked(mockAgent.analyze).mockRejectedValue(new Error('OOM'));
    const handler = createAgentInferenceHandler(bus, mockAgent);
    await handler(makeMsg());
    await flush();

    expect(sent).toHaveLength(1);
    const data = JSON.parse((sent[0] as any)['data']) as Record<string, unknown>;
    expect(typeof data['error']).toBe('string');
    expect(data['error']).toContain('OOM');
  });

  it('handler resolves without throwing (non-blocking — setImmediate deferred)', async () => {
    const handler = createAgentInferenceHandler(bus, mockAgent);
    await expect(handler(makeMsg())).resolves.toBeUndefined();
    // Drain deferred work so it doesn't leak into the next test
    await flush();
  });

  it('passes garbage Buffer to agent.analyze() when data is not valid base64 (Buffer.from never throws)', async () => {
    // Pin the Node.js silent-garbage behavior: Buffer.from('!!!not-base64!!!', 'base64')
    // does NOT throw — it returns a (possibly empty) Buffer with invalid chars silently dropped.
    // The try/catch in agent-inference.ts is unreachable by the current runtime.
    const handler = createAgentInferenceHandler(bus, mockAgent);
    await handler(makeMsg({ data: '!!!not-base64!!!' }));
    await flush();

    // analyze() is called — no error envelope, because the catch block is unreachable
    expect(mockAgent.analyze).toHaveBeenCalledOnce();
    const envelope = sent[0] as Record<string, unknown>;
    expect(envelope['type']).toBe('agent-inference-result');
    const data = JSON.parse(envelope['data'] as string) as Record<string, unknown>;
    // No error field — bad base64 goes through as a garbage buffer, not an error response
    expect(data['error']).toBeUndefined();
    expect(data['labels']).toEqual(MOCK_RESULT.labels);
  });

  it('handler resolves before inference completes (truly non-blocking)', async () => {
    // Use a local bus so deferred work from prior tests cannot pollute sent
    const localBus  = new EventBus();
    const localSent: unknown[] = [];
    localBus.on('network:send', (p) => localSent.push(p.payload));

    let inferenceStarted = false;
    const slowAgent = {
      analyze: vi.fn().mockImplementation(async () => {
        inferenceStarted = true;
        return MOCK_RESULT;
      }),
    } as unknown as Agent;

    const handler = createAgentInferenceHandler(localBus, slowAgent);
    await handler(makeMsg());
    // Handler has returned — inference should not have started yet (it's deferred)
    expect(inferenceStarted).toBe(false);
    expect(localSent).toHaveLength(0);

    // Now let the event loop run
    await flush();
    expect(inferenceStarted).toBe(true);
    expect(localSent).toHaveLength(1);
  });
});
