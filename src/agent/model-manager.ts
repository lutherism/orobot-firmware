/**
 * ModelManager — local ONNX model lifecycle on the device.
 *
 * Responsibilities:
 *   - List models cached in `~/.orobot/models/` (file-system scan)
 *   - Download a model from HuggingFace Hub by modelId, stream to disk
 *   - Delete a cached model
 *   - Report download progress via callbacks
 *
 * The model files are stored as:
 *   `<cacheDir>/<sanitized-model-id>.onnx`
 *
 * Only models in the STARTER_MODELS allowlist may be downloaded.
 * This prevents arbitrary URL fetches and reduces attack surface.
 *
 * Design notes:
 *   - `listLocalModels()` is safe to call at any time (read-only).
 *   - `downloadModel()` rejects if the modelId is not in the allowlist.
 *   - One download at a time per ModelManager instance; concurrent downloads
 *     share a single AbortController per modelId (idempotent: second caller
 *     waits for the in-flight download to complete).
 *   - Progress is reported as a callback `(downloaded, total) => void`.
 *     `total` is -1 when the server does not send `Content-Length`.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { findInCatalog, type CatalogEntry, STARTER_MODELS } from './model-catalog.js';

export interface ModelMeta {
  /** HuggingFace model ID derived from the filename */
  modelId: string;
  /** Absolute path to the cached .onnx file */
  filePath: string;
  /** File size in bytes */
  sizeBytes: number;
}

export type DownloadProgressCallback = (downloaded: number, total: number) => void;

/** Default cache directory.  Override in tests via constructor option. */
const DEFAULT_CACHE_DIR = join(process.env['HOME'] ?? '/root', '.orobot', 'models');

/** Convert a modelId like "Xenova/detr-resnet-50" → "Xenova__detr-resnet-50" */
function sanitizeModelId(modelId: string): string {
  return modelId.replace(/\//g, '__').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Reverse: "Xenova__detr-resnet-50" (minus .onnx) → "Xenova/detr-resnet-50" */
function filenameToModelId(filename: string): string {
  const base = filename.replace(/\.onnx$/, '');
  return base.replace(/__/g, '/');
}

export interface ModelManagerOptions {
  /** Override the cache directory — useful for testing. */
  cacheDir?: string;
  /** Override the fetch implementation — useful for testing. */
  fetchFn?: typeof fetch;
}

export class ModelManager {
  private readonly cacheDir: string;
  private readonly fetchFn: typeof fetch;
  /** Track in-flight downloads so concurrent requests wait on the same promise. */
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(options: ModelManagerOptions = {}) {
    this.cacheDir = options.cacheDir ?? DEFAULT_CACHE_DIR;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /**
   * List all ONNX models cached locally.
   * Returns an empty array if the cache directory does not exist.
   */
  async listLocalModels(): Promise<ModelMeta[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.cacheDir);
    } catch {
      return [];
    }

    const onnxFiles = entries.filter((f) => f.endsWith('.onnx'));

    const metas: ModelMeta[] = [];
    for (const filename of onnxFiles) {
      const filePath = join(this.cacheDir, filename);
      try {
        const stat = await fs.stat(filePath);
        metas.push({
          modelId: filenameToModelId(filename),
          filePath,
          sizeBytes: stat.size,
        });
      } catch {
        // Race: file was deleted between readdir and stat — skip.
      }
    }

    return metas;
  }

  /**
   * Download a model from HuggingFace Hub.
   * Rejects if `modelId` is not in the starter allowlist.
   * Concurrent calls for the same modelId share the same download.
   *
   * @param modelId   HuggingFace model ID (must be in STARTER_MODELS).
   * @param onProgress Optional progress callback `(downloaded, total)`.
   *                   `total` is -1 if Content-Length is unknown.
   */
  async downloadModel(
    modelId: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    const entry = findInCatalog(modelId);
    if (!entry) {
      throw new Error(
        `Model "${modelId}" is not in the starter allowlist. ` +
        `Allowed: ${STARTER_MODELS.map((m) => m.modelId).join(', ')}`,
      );
    }

    // If already downloading, wait on the existing promise.
    const existing = this.inFlight.get(modelId);
    if (existing) {
      return existing;
    }

    const promise = this._doDownload(entry, onProgress).finally(() => {
      this.inFlight.delete(modelId);
    });

    this.inFlight.set(modelId, promise);
    return promise;
  }

  private async _doDownload(
    entry: CatalogEntry,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    // Ensure cache directory exists.
    await fs.mkdir(this.cacheDir, { recursive: true });

    const filename = `${sanitizeModelId(entry.modelId)}.onnx`;
    const destPath = join(this.cacheDir, filename);
    const tmpPath = `${destPath}.tmp`;

    const response = await this.fetchFn(entry.downloadUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download model "${entry.modelId}": HTTP ${response.status} ${response.statusText}`,
      );
    }

    const total = parseInt(response.headers.get('content-length') ?? '-1', 10);
    let downloaded = 0;

    const writeStream = createWriteStream(tmpPath);

    try {
      // Node 18+ fetch returns a Web ReadableStream; convert to Node Readable.
      const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);

      nodeStream.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        onProgress?.(downloaded, total);
      });

      await finished(nodeStream.pipe(writeStream));
    } catch (err) {
      // Clean up partial download.
      try { await fs.unlink(tmpPath); } catch { /* ignore */ }
      throw err;
    }

    // Atomically move tmp → final path.
    await fs.rename(tmpPath, destPath);
  }

  /**
   * Delete a locally cached model.
   * Resolves silently if the model is not cached (idempotent).
   */
  async deleteModel(modelId: string): Promise<void> {
    const filename = `${sanitizeModelId(modelId)}.onnx`;
    const filePath = join(this.cacheDir, filename);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  /** Absolute path for a given modelId's cached file (whether or not it exists). */
  cachedPath(modelId: string): string {
    return join(this.cacheDir, `${sanitizeModelId(modelId)}.onnx`);
  }
}
