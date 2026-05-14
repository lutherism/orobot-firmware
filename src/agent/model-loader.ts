/**
 * ModelLoader — selects the right inference backend based on hardware.
 *
 * Selection logic:
 *   1. If `OROBOT_PLATFORM=jetson` or CUDA is detected via `nvidia-smi`,
 *      use TorchBackend (Python subprocess, GPU).
 *   2. Otherwise use OnnxBackend (onnxruntime-node, CPU).
 *
 * The loader is intentionally lazy: it does not load the model until
 * `analyze()` is first called, so startup cost is deferred.
 */

import type { InferenceResult } from './types';
import { OnnxBackend, type OrtModule } from './onnx-backend';
import { TorchBackend, type SpawnFn } from './torch-backend';
import { execSync } from 'child_process';

export type Backend = 'onnx' | 'torch';

export interface ModelLoaderOptions {
  /** Override backend selection — useful for testing. */
  backend?: Backend;
  /** Override onnxruntime-node module — injected for testing. */
  ort?: OrtModule;
  /** Override spawn function — injected for testing. */
  spawnFn?: SpawnFn;
  /** Override torch worker script path — injected for testing. */
  workerScript?: string;
}

function detectBackend(): Backend {
  const platform = (process.env['OROBOT_PLATFORM'] ?? '').trim().toLowerCase();
  if (platform === 'jetson') return 'torch';

  // Probe for CUDA via nvidia-smi — if it exits cleanly, we're on a GPU box.
  try {
    execSync('nvidia-smi -L', { stdio: 'ignore', timeout: 2000 });
    return 'torch';
  } catch {
    // No CUDA available — fall back to CPU ONNX.
  }

  return 'onnx';
}

function loadOrtModule(): OrtModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('onnxruntime-node') as OrtModule;
}

export class ModelLoader {
  private readonly modelId: string;
  private readonly backend: Backend;
  private onnxBackend: OnnxBackend | null = null;
  private torchBackend: TorchBackend | null = null;
  private loaded = false;
  private readonly options: ModelLoaderOptions;

  constructor(modelId: string, options: ModelLoaderOptions = {}) {
    this.modelId = modelId;
    this.backend = options.backend ?? detectBackend();
    this.options = options;
  }

  /** Load the model into memory. Safe to call multiple times — idempotent. */
  async load(modelPath: string): Promise<void> {
    if (this.loaded) return;

    if (this.backend === 'torch') {
      this.torchBackend = new TorchBackend(
        this.modelId,
        this.options.spawnFn,
        this.options.workerScript,
      );
      // Torch worker loads on first call; nothing to preload here.
    } else {
      const ort = this.options.ort ?? loadOrtModule();
      this.onnxBackend = new OnnxBackend(ort);
      await this.onnxBackend.load(modelPath);
    }

    this.loaded = true;
  }

  async analyze(imageBuffer: Buffer): Promise<InferenceResult> {
    if (!this.loaded) {
      throw new Error('ModelLoader: call load() before analyze()');
    }

    if (this.backend === 'torch' && this.torchBackend) {
      return this.torchBackend.analyze(imageBuffer);
    }

    if (this.onnxBackend) {
      return this.onnxBackend.analyze(imageBuffer);
    }

    throw new Error('ModelLoader: no backend initialized');
  }

  /** Which backend was selected. Useful for logging and diagnostics. */
  get selectedBackend(): Backend {
    return this.backend;
  }
}
