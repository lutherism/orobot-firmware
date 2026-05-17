import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ModelManager } from '../model-manager';
import { STARTER_MODELS } from '../model-catalog';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  // Use a unique temp dir per test run to avoid cross-test pollution.
  return join(tmpdir(), `model-manager-test-${process.pid}-${Date.now()}`);
}

/** Create a minimal fetch mock that returns `body` bytes with optional Content-Length. */
function makeFetchMock(body: Buffer, opts: { status?: number; contentLength?: number } = {}) {
  const status = opts.status ?? 200;
  const headers = new Headers();
  if (opts.contentLength !== undefined) {
    headers.set('content-length', String(opts.contentLength));
  }

  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(body);
        controller.close();
      },
    }),
  } as unknown as Response);
}

// ── listLocalModels ──────────────────────────────────────────────────────────

describe('ModelManager.listLocalModels', () => {
  it('returns empty array when cache dir does not exist', async () => {
    const mgr = new ModelManager({ cacheDir: '/nonexistent/path/12345' });
    const models = await mgr.listLocalModels();
    expect(models).toEqual([]);
  });

  it('returns empty array when cache dir is empty', async () => {
    const cacheDir = makeTmpDir();
    await fs.mkdir(cacheDir, { recursive: true });
    try {
      const mgr = new ModelManager({ cacheDir });
      const models = await mgr.listLocalModels();
      expect(models).toEqual([]);
    } finally {
      await fs.rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('lists .onnx files with correct metadata', async () => {
    const cacheDir = makeTmpDir();
    await fs.mkdir(cacheDir, { recursive: true });
    try {
      // Write a fake model file using the sanitized name format.
      const filename = 'Xenova__detr-resnet-50.onnx';
      const filePath = join(cacheDir, filename);
      await fs.writeFile(filePath, Buffer.from('fake-onnx-bytes'));

      const mgr = new ModelManager({ cacheDir });
      const models = await mgr.listLocalModels();

      expect(models).toHaveLength(1);
      expect(models[0]?.modelId).toBe('Xenova/detr-resnet-50');
      expect(models[0]?.filePath).toBe(filePath);
      expect(models[0]?.sizeBytes).toBeGreaterThan(0);
    } finally {
      await fs.rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('ignores non-.onnx files in the cache dir', async () => {
    const cacheDir = makeTmpDir();
    await fs.mkdir(cacheDir, { recursive: true });
    try {
      await fs.writeFile(join(cacheDir, 'readme.txt'), 'ignored');
      await fs.writeFile(join(cacheDir, 'Xenova__yolos-tiny.onnx'), 'fake');

      const mgr = new ModelManager({ cacheDir });
      const models = await mgr.listLocalModels();

      expect(models).toHaveLength(1);
      expect(models[0]?.modelId).toBe('Xenova/yolos-tiny');
    } finally {
      await fs.rm(cacheDir, { recursive: true, force: true });
    }
  });
});

// ── downloadModel ────────────────────────────────────────────────────────────

describe('ModelManager.downloadModel', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = makeTmpDir();
  });

  it('rejects if modelId is not in the allowlist', async () => {
    const mgr = new ModelManager({ cacheDir, fetchFn: vi.fn() });
    await expect(mgr.downloadModel('unknown/model')).rejects.toThrow('not in the starter allowlist');
  });

  it('downloads a model and writes it to the cache dir', async () => {
    const fakeBytes = Buffer.from('onnx-model-bytes');
    const fetchFn = makeFetchMock(fakeBytes, { contentLength: fakeBytes.length });
    const mgr = new ModelManager({ cacheDir, fetchFn });

    const modelId = STARTER_MODELS[0]!.modelId; // 'Xenova/detr-resnet-50'
    await mgr.downloadModel(modelId);

    const files = await fs.readdir(cacheDir);
    expect(files).toContain('Xenova__detr-resnet-50.onnx');

    const written = await fs.readFile(join(cacheDir, 'Xenova__detr-resnet-50.onnx'));
    expect(written).toEqual(fakeBytes);

    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it('calls onProgress with downloaded and total bytes', async () => {
    const fakeBytes = Buffer.from('abc');
    const fetchFn = makeFetchMock(fakeBytes, { contentLength: 3 });
    const mgr = new ModelManager({ cacheDir, fetchFn });

    const progress: Array<[number, number]> = [];
    const modelId = STARTER_MODELS[0]!.modelId;
    await mgr.downloadModel(modelId, (dl, tot) => progress.push([dl, tot]));

    expect(progress.length).toBeGreaterThan(0);
    const last = progress[progress.length - 1]!;
    expect(last[0]).toBe(3); // all bytes received
    expect(last[1]).toBe(3); // content-length matched

    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it('passes -1 as total when Content-Length is absent', async () => {
    const fakeBytes = Buffer.from('abc');
    const fetchFn = makeFetchMock(fakeBytes); // no contentLength
    const mgr = new ModelManager({ cacheDir, fetchFn });

    const totals: number[] = [];
    const modelId = STARTER_MODELS[0]!.modelId;
    await mgr.downloadModel(modelId, (_, tot) => totals.push(tot));

    expect(totals.every((t) => t === -1)).toBe(true);

    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it('rejects and cleans up tmp file on HTTP error', async () => {
    const fetchFn = makeFetchMock(Buffer.from(''), { status: 404 });
    const mgr = new ModelManager({ cacheDir, fetchFn });

    const modelId = STARTER_MODELS[0]!.modelId;
    await expect(mgr.downloadModel(modelId)).rejects.toThrow('HTTP 404');

    // Temp file should not remain.
    await fs.mkdir(cacheDir, { recursive: true }); // may not exist if mkdir not called
    const files = await fs.readdir(cacheDir).catch(() => []);
    expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);

    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it('concurrent calls for the same modelId share one download', async () => {
    const fakeBytes = Buffer.from('shared');
    const fetchFn = makeFetchMock(fakeBytes, { contentLength: 6 });
    const mgr = new ModelManager({ cacheDir, fetchFn });

    const modelId = STARTER_MODELS[0]!.modelId;
    // Fire two simultaneous downloads.
    await Promise.all([mgr.downloadModel(modelId), mgr.downloadModel(modelId)]);

    // fetch should have been called only once.
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await fs.rm(cacheDir, { recursive: true, force: true });
  });
});

// ── deleteModel ──────────────────────────────────────────────────────────────

describe('ModelManager.deleteModel', () => {
  it('deletes a cached model file', async () => {
    const cacheDir = makeTmpDir();
    await fs.mkdir(cacheDir, { recursive: true });
    try {
      const filename = 'Xenova__detr-resnet-50.onnx';
      await fs.writeFile(join(cacheDir, filename), 'fake');

      const mgr = new ModelManager({ cacheDir });
      await mgr.deleteModel('Xenova/detr-resnet-50');

      const files = await fs.readdir(cacheDir);
      expect(files).not.toContain(filename);
    } finally {
      await fs.rm(cacheDir, { recursive: true, force: true });
    }
  });

  it('resolves silently when model is not cached (idempotent)', async () => {
    const mgr = new ModelManager({ cacheDir: makeTmpDir() });
    // Should not throw even if the file doesn't exist.
    await expect(mgr.deleteModel('Xenova/detr-resnet-50')).resolves.toBeUndefined();
  });
});

// ── cachedPath ───────────────────────────────────────────────────────────────

describe('ModelManager.cachedPath', () => {
  it('returns the expected path for a sanitized modelId', () => {
    const cacheDir = '/tmp/test-cache';
    const mgr = new ModelManager({ cacheDir });
    const path = mgr.cachedPath('Xenova/detr-resnet-50');
    expect(path).toBe('/tmp/test-cache/Xenova__detr-resnet-50.onnx');
  });
});
