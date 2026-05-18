import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../core/event-bus';
import { createAgentModelHandlers } from './agent-model';
import type { ModelManager } from '../agent/model-manager';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBus(): { bus: EventBus; sent: unknown[] } {
  const bus = new EventBus();
  const sent: unknown[] = [];
  bus.on('network:send', (payload) => sent.push(payload));
  return { bus, sent };
}

function makeMsg(type: string, data: string, deviceUuid = 'test-device') {
  return { type, data, deviceUuid, userUuid: '', ackId: '' };
}

function makeMockManager(overrides: Partial<{
  listLocalModels: () => Promise<unknown>;
  downloadModel: (id: string, cb?: Function) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  cachedPath: (id: string) => string;
}> = {}): ModelManager {
  return {
    listLocalModels: vi.fn().mockResolvedValue([]),
    downloadModel: vi.fn().mockResolvedValue(undefined),
    deleteModel: vi.fn().mockResolvedValue(undefined),
    cachedPath: vi.fn().mockReturnValue('/tmp/cache/model.onnx'),
    ...overrides,
  } as unknown as ModelManager;
}

// ── listModels ───────────────────────────────────────────────────────────────

describe('createAgentModelHandlers.listModels', () => {
  it('emits agent-list-models-result with model array', async () => {
    const { bus, sent } = makeBus();
    const models = [{ modelId: 'Xenova/detr-resnet-50', filePath: '/tmp/x.onnx', sizeBytes: 100 }];
    const mgr = makeMockManager({ listLocalModels: vi.fn().mockResolvedValue(models) });
    const { listModels } = createAgentModelHandlers(bus, mgr);

    await listModels(makeMsg('agent-list-models-request', ''));

    expect(sent).toHaveLength(1);
    const payload = (sent[0] as { payload: { type: string; data: unknown } }).payload;
    expect(payload.type).toBe('agent-list-models-result');
    const parsed = JSON.parse(payload.data as string);
    expect(parsed).toEqual(models);
  });

  it('emits error result when listLocalModels throws', async () => {
    const { bus, sent } = makeBus();
    const mgr = makeMockManager({ listLocalModels: vi.fn().mockRejectedValue(new Error('disk error')) });
    const { listModels } = createAgentModelHandlers(bus, mgr);

    await listModels(makeMsg('agent-list-models-request', ''));

    const payload = (sent[0] as { payload: { data: string } }).payload;
    const parsed = JSON.parse(payload.data);
    expect(parsed.error).toContain('disk error');
  });
});

// ── downloadModel ─────────────────────────────────────────────────────────────

describe('createAgentModelHandlers.downloadModel', () => {
  it('emits agent-download-model-done on success', async () => {
    const { bus, sent } = makeBus();
    const mgr = makeMockManager({
      cachedPath: vi.fn().mockReturnValue('/tmp/cache/Xenova__detr-resnet-50.onnx'),
    });
    const { downloadModel } = createAgentModelHandlers(bus, mgr);

    await downloadModel(makeMsg('agent-download-model-request', 'Xenova/detr-resnet-50'));

    const doneMsg = (sent as Array<{ payload: { type: string; data: string } }>)
      .find((s) => s.payload.type === 'agent-download-model-done');
    expect(doneMsg).toBeDefined();
    const parsed = JSON.parse(doneMsg!.payload.data);
    expect(parsed.modelId).toBe('Xenova/detr-resnet-50');
    expect(parsed.filePath).toContain('onnx');
  });

  it('emits progress messages during download', async () => {
    const { bus, sent } = makeBus();
    const mgr = makeMockManager({
      downloadModel: vi.fn().mockImplementation(async (_id: string, cb?: Function) => {
        cb?.(100, 1000);
        cb?.(1000, 1000);
      }),
    });
    const { downloadModel } = createAgentModelHandlers(bus, mgr);

    await downloadModel(makeMsg('agent-download-model-request', 'Xenova/detr-resnet-50'));

    const progressMsgs = (sent as Array<{ payload: { type: string; data: string } }>)
      .filter((s) => s.payload.type === 'agent-download-model-progress');
    expect(progressMsgs.length).toBe(2);
    expect(JSON.parse(progressMsgs[0]!.payload.data)).toMatchObject({ downloaded: 100, total: 1000 });
  });

  it('emits error done when modelId is empty', async () => {
    const { bus, sent } = makeBus();
    const mgr = makeMockManager();
    const { downloadModel } = createAgentModelHandlers(bus, mgr);

    await downloadModel(makeMsg('agent-download-model-request', ''));

    const payload = (sent[0] as { payload: { data: string } }).payload;
    const parsed = JSON.parse(payload.data);
    expect(parsed.error).toContain('modelId is required');
  });

  it('emits error done when download fails', async () => {
    const { bus, sent } = makeBus();
    const mgr = makeMockManager({
      downloadModel: vi.fn().mockRejectedValue(new Error('not in allowlist')),
    });
    const { downloadModel } = createAgentModelHandlers(bus, mgr);

    await downloadModel(makeMsg('agent-download-model-request', 'bad/model'));

    const doneMsg = (sent as Array<{ payload: { type: string; data: string } }>)
      .find((s) => s.payload.type === 'agent-download-model-done');
    const parsed = JSON.parse(doneMsg!.payload.data);
    expect(parsed.error).toContain('not in allowlist');
  });
});

// ── deleteModel ──────────────────────────────────────────────────────────────

describe('createAgentModelHandlers.deleteModel', () => {
  it('emits agent-delete-model-done on success', async () => {
    const { bus, sent } = makeBus();
    const mgr = makeMockManager();
    const { deleteModel } = createAgentModelHandlers(bus, mgr);

    await deleteModel(makeMsg('agent-delete-model-request', 'Xenova/detr-resnet-50'));

    const payload = (sent[0] as { payload: { type: string; data: string } }).payload;
    expect(payload.type).toBe('agent-delete-model-done');
    const parsed = JSON.parse(payload.data);
    expect(parsed.modelId).toBe('Xenova/detr-resnet-50');
  });

  it('emits error done when modelId is empty', async () => {
    const { bus, sent } = makeBus();
    const mgr = makeMockManager();
    const { deleteModel } = createAgentModelHandlers(bus, mgr);

    await deleteModel(makeMsg('agent-delete-model-request', ''));

    const payload = (sent[0] as { payload: { data: string } }).payload;
    const parsed = JSON.parse(payload.data);
    expect(parsed.error).toContain('modelId is required');
  });

  it('emits error done when deleteModel throws', async () => {
    const { bus, sent } = makeBus();
    const mgr = makeMockManager({
      deleteModel: vi.fn().mockRejectedValue(new Error('permission denied')),
    });
    const { deleteModel } = createAgentModelHandlers(bus, mgr);

    await deleteModel(makeMsg('agent-delete-model-request', 'Xenova/detr-resnet-50'));

    const payload = (sent[0] as { payload: { type: string; data: string } }).payload;
    expect(payload.type).toBe('agent-delete-model-done');
    const parsed = JSON.parse(payload.data);
    expect(parsed.error).toContain('permission denied');
  });
});
