import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InferenceResult } from '../types';
import { OnnxBackend, type OrtModule, type OrtSession, type OrtTensor } from '../onnx-backend';
import { TorchBackend } from '../torch-backend';
import { ModelLoader } from '../model-loader';
import { Agent } from '../index';
import { EventEmitter } from 'events';

// ── OnnxBackend ────────────────────────────────────────────────────────────

function makeOrtTensor(data: number[], dims: number[]): OrtTensor {
  return { data: new Float32Array(data), dims };
}

function makeMockOrt(sessionOutputs: Record<string, OrtTensor>): OrtModule {
  const session: OrtSession = {
    run: vi.fn().mockResolvedValue(sessionOutputs),
  };
  return {
    InferenceSession: {
      create: vi.fn().mockResolvedValue(session),
    },
    Tensor: class MockTensor {
      data: Float32Array;
      dims: number[];
      constructor(_type: string, data: Float32Array, dims: number[]) {
        this.data = data;
        this.dims = dims;
      }
    } as unknown as OrtModule['Tensor'],
  };
}

describe('OnnxBackend', () => {
  it('throws if analyze() is called before load()', async () => {
    const ort = makeMockOrt({});
    const backend = new OnnxBackend(ort);
    await expect(backend.analyze(Buffer.from('test'))).rejects.toThrow('model not loaded');
  });

  it('loads the model via ort.InferenceSession.create', async () => {
    const ort = makeMockOrt({});
    const backend = new OnnxBackend(ort);
    await backend.load('/tmp/model.onnx');
    expect(ort.InferenceSession.create).toHaveBeenCalledWith('/tmp/model.onnx');
  });

  it('returns empty result when output tensors are missing', async () => {
    const ort = makeMockOrt({});
    const backend = new OnnxBackend(ort);
    await backend.load('/tmp/model.onnx');
    const result = await backend.analyze(Buffer.from('img'));
    expect(result).toEqual({ labels: [], boxes: [], scores: [] });
  });

  it('returns empty result when all queries are no-object class (idx 91)', async () => {
    // 1 query, 92 classes (0-91), argmax = 91 (no-object)
    const numQueries = 1;
    const numClasses = 92;
    // logits: all zero except class 91 which is high
    const logits = Array(numQueries * numClasses).fill(0);
    logits[91] = 100; // strong no-object signal
    const boxes  = [0.5, 0.5, 0.2, 0.2];

    const ort = makeMockOrt({
      logits:     makeOrtTensor(logits, [1, numQueries, numClasses]),
      pred_boxes: makeOrtTensor(boxes,  [1, numQueries, 4]),
    });
    const backend = new OnnxBackend(ort);
    await backend.load('/tmp/model.onnx');
    const result = await backend.analyze(Buffer.from('img'));
    expect(result.labels).toHaveLength(0);
  });

  it('returns detections when a class exceeds confidence threshold', async () => {
    const numQueries = 1;
    const numClasses = 92;
    // logits: strong signal on class 1 ("person")
    const logits = Array(numQueries * numClasses).fill(-100);
    logits[1] = 100;
    const boxes = [0.5, 0.5, 0.4, 0.6]; // cx, cy, w, h

    const ort = makeMockOrt({
      logits:     makeOrtTensor(logits, [1, numQueries, numClasses]),
      pred_boxes: makeOrtTensor(boxes,  [1, numQueries, 4]),
    });
    const backend = new OnnxBackend(ort);
    await backend.load('/tmp/model.onnx');
    const result = await backend.analyze(Buffer.from('img'));

    expect(result.labels).toHaveLength(1);
    expect(result.labels[0]).toBe('person');
    expect(result.scores[0]).toBeGreaterThan(0.5);
    // Box converted from cx/cy/w/h → x/y/w/h top-left
    // Float32Array introduces small precision errors — use approximate comparison.
    const box = result.boxes[0];
    expect(box?.x).toBeCloseTo(0.3, 5);
    expect(box?.y).toBeCloseTo(0.2, 5);
    expect(box?.width).toBeCloseTo(0.4, 5);
    expect(box?.height).toBeCloseTo(0.6, 5);
  });

  it('returns InferenceResult with correct schema shape', async () => {
    const numQueries = 2;
    const numClasses = 92;
    const logits = Array(numQueries * numClasses).fill(-100);
    logits[1]  = 100; // query 0 → person
    logits[numClasses + 3] = 100; // query 1 → car (class 3)
    const boxes = [0.5, 0.5, 0.2, 0.2, 0.3, 0.4, 0.1, 0.1];

    const ort = makeMockOrt({
      logits:     makeOrtTensor(logits, [1, numQueries, numClasses]),
      pred_boxes: makeOrtTensor(boxes,  [1, numQueries, 4]),
    });
    const backend = new OnnxBackend(ort);
    await backend.load('/tmp/model.onnx');
    const result = await backend.analyze(Buffer.from('img'));

    expect(result.labels.length).toBe(result.scores.length);
    expect(result.labels.length).toBe(result.boxes.length);
    for (const box of result.boxes) {
      expect(typeof box.x).toBe('number');
      expect(typeof box.y).toBe('number');
      expect(typeof box.width).toBe('number');
      expect(typeof box.height).toBe('number');
    }
  });
});

// ── TorchBackend ────────────────────────────────────────────────────────────

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
};

function makeMockChild(jsonResult: unknown, exitCode = 0): { child: MockChild; spawn: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin  = { write: vi.fn(), end: vi.fn() };

  const spawn = vi.fn().mockReturnValue(child);

  // Emit result asynchronously so the promise chain has time to attach handlers.
  setImmediate(() => {
    child.stdout.emit('data', Buffer.from(JSON.stringify(jsonResult)));
    child.emit('close', exitCode);
  });

  return { child, spawn };
}

describe('TorchBackend', () => {
  it('sends image buffer as base64 on stdin and returns parsed result', async () => {
    const expected: InferenceResult = {
      labels: ['person'],
      boxes:  [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
      scores: [0.95],
    };
    const { child, spawn } = makeMockChild(expected);
    const backend = new TorchBackend('Xenova/detr-resnet-50', spawn as any, '/worker.py');
    const imageBuffer = Buffer.from('fake-jpeg-bytes');
    const result = await backend.analyze(imageBuffer);

    expect(spawn).toHaveBeenCalledWith(
      'python3',
      ['/worker.py', 'Xenova/detr-resnet-50'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(child.stdin.write).toHaveBeenCalledWith(imageBuffer.toString('base64'));
    expect(child.stdin.end).toHaveBeenCalled();
    expect(result).toEqual(expected);
  });

  it('rejects when subprocess exits with non-zero code', async () => {
    const child = new EventEmitter() as MockChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin  = { write: vi.fn(), end: vi.fn() };
    const spawn = vi.fn().mockReturnValue(child);

    setImmediate(() => {
      child.stderr.emit('data', Buffer.from('CUDA out of memory'));
      child.emit('close', 1);
    });

    const backend = new TorchBackend('model', spawn as any, '/worker.py');
    await expect(backend.analyze(Buffer.from('img'))).rejects.toThrow('code 1');
  });

  it('rejects when subprocess output is not valid JSON', async () => {
    const child = new EventEmitter() as MockChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin  = { write: vi.fn(), end: vi.fn() };
    const spawn = vi.fn().mockReturnValue(child);

    setImmediate(() => {
      child.stdout.emit('data', Buffer.from('not-json-output'));
      child.emit('close', 0);
    });

    const backend = new TorchBackend('model', spawn as any, '/worker.py');
    await expect(backend.analyze(Buffer.from('img'))).rejects.toThrow('failed to parse');
  });

  it('rejects when spawn itself throws an error event', async () => {
    const child = new EventEmitter() as MockChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin  = { write: vi.fn(), end: vi.fn() };
    const spawn = vi.fn().mockReturnValue(child);

    setImmediate(() => {
      child.emit('error', new Error('ENOENT: python3 not found'));
    });

    const backend = new TorchBackend('model', spawn as any, '/worker.py');
    await expect(backend.analyze(Buffer.from('img'))).rejects.toThrow('python3 not found');
  });
});

// ── ModelLoader ─────────────────────────────────────────────────────────────

describe('ModelLoader', () => {
  it('throws if analyze() is called before load()', async () => {
    const ort = makeMockOrt({});
    const loader = new ModelLoader('test-model', { backend: 'onnx', ort });
    await expect(loader.analyze(Buffer.from('img'))).rejects.toThrow('call load()');
  });

  it('uses OnnxBackend when backend is forced to "onnx"', async () => {
    const ort = makeMockOrt({});
    const loader = new ModelLoader('test-model', { backend: 'onnx', ort });
    await loader.load('/tmp/model.onnx');
    expect(loader.selectedBackend).toBe('onnx');
    expect(ort.InferenceSession.create).toHaveBeenCalled();
  });

  it('uses TorchBackend when backend is forced to "torch"', async () => {
    const expected: InferenceResult = { labels: ['cat'], boxes: [{ x: 0, y: 0, width: 1, height: 1 }], scores: [0.9] };
    const { spawn } = makeMockChild(expected);
    const loader = new ModelLoader('test-model', {
      backend:      'torch',
      spawnFn:      spawn as any,
      workerScript: '/worker.py',
    });
    await loader.load('/ignored');
    expect(loader.selectedBackend).toBe('torch');
    const result = await loader.analyze(Buffer.from('img'));
    expect(result.labels).toEqual(['cat']);
  });

  it('is idempotent — calling load() twice does not reload the model', async () => {
    const ort = makeMockOrt({});
    const loader = new ModelLoader('test-model', { backend: 'onnx', ort });
    await loader.load('/tmp/model.onnx');
    await loader.load('/tmp/model.onnx');
    expect(ort.InferenceSession.create).toHaveBeenCalledTimes(1);
  });
});

// ── Agent (public API) ───────────────────────────────────────────────────────

describe('Agent', () => {
  it('exposes the correct backend string', async () => {
    const ort   = makeMockOrt({});
    const agent = new Agent({ modelId: 'Xenova/detr-resnet-50' }, { backend: 'onnx', ort });
    expect(agent.backend).toBe('onnx');
  });

  it('returns InferenceResult from analyze()', async () => {
    const numQueries = 1;
    const numClasses = 92;
    const logits = Array(numQueries * numClasses).fill(-100);
    logits[1] = 100;
    const boxes = [0.5, 0.5, 0.2, 0.2];
    const ort = makeMockOrt({
      logits:     makeOrtTensor(logits, [1, numQueries, numClasses]),
      pred_boxes: makeOrtTensor(boxes,  [1, numQueries, 4]),
    });

    const agent = new Agent({ modelId: 'Xenova/detr-resnet-50' }, { backend: 'onnx', ort });
    await agent.load('/tmp/model.onnx');
    const result = await agent.analyze(Buffer.from('img'));

    expect(result).toMatchObject({
      labels: expect.any(Array),
      boxes:  expect.any(Array),
      scores: expect.any(Array),
    });
    expect(result.labels[0]).toBe('person');
  });

  it('Pi (onnx) and Jetson (torch) branches produce same output schema', async () => {
    // ONNX branch
    const numQueries = 1;
    const numClasses = 92;
    const logits = Array(numQueries * numClasses).fill(-100);
    logits[1] = 100;
    const boxes = [0.5, 0.5, 0.2, 0.2];
    const ort = makeMockOrt({
      logits:     makeOrtTensor(logits, [1, numQueries, numClasses]),
      pred_boxes: makeOrtTensor(boxes,  [1, numQueries, 4]),
    });
    const onnxAgent = new Agent({ modelId: 'test' }, { backend: 'onnx', ort });
    await onnxAgent.load('/model.onnx');
    const onnxResult = await onnxAgent.analyze(Buffer.from('img'));

    // Torch branch
    const torchResult: InferenceResult = { labels: ['person'], boxes: [{ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }], scores: [0.99] };
    const { spawn } = makeMockChild(torchResult);
    const torchAgent = new Agent({ modelId: 'test' }, { backend: 'torch', spawnFn: spawn as any, workerScript: '/w.py' });
    await torchAgent.load('/ignored');
    const jetsonResult = await torchAgent.analyze(Buffer.from('img'));

    // Both must have the same shape
    for (const result of [onnxResult, jetsonResult]) {
      expect(Array.isArray(result.labels)).toBe(true);
      expect(Array.isArray(result.boxes)).toBe(true);
      expect(Array.isArray(result.scores)).toBe(true);
      expect(result.labels.length).toBe(result.boxes.length);
      expect(result.labels.length).toBe(result.scores.length);
    }
  });
});
