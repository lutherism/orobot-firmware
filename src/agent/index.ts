/**
 * orobot-agent — on-device vision inference engine.
 *
 * Public API:
 *
 *   const agent = new Agent({ modelId: 'Xenova/detr-resnet-50' });
 *   await agent.load('/path/to/model.onnx');
 *   const result = await agent.analyze(imageBuffer);
 *   // result: { labels: string[], boxes: BoundingBox[], scores: number[] }
 *
 * Backend is selected automatically:
 *   - Jetson / CUDA detected → TorchBackend (Python subprocess)
 *   - Otherwise              → OnnxBackend (onnxruntime-node, CPU)
 */

export type { InferenceResult, BoundingBox, AgentConfig } from './types';
export { ModelLoader } from './model-loader';
export type { Backend, ModelLoaderOptions } from './model-loader';
export { ModelManager } from './model-manager';
export type { ModelMeta, DownloadProgressCallback, ModelManagerOptions } from './model-manager';
export { STARTER_MODELS, findInCatalog } from './model-catalog';
export type { CatalogEntry } from './model-catalog';

import type { InferenceResult, AgentConfig } from './types';
import { ModelLoader, type ModelLoaderOptions } from './model-loader';

export class Agent {
  private readonly loader: ModelLoader;

  constructor(config: AgentConfig, options: ModelLoaderOptions = {}) {
    this.loader = new ModelLoader(config.modelId, options);
  }

  /**
   * Load the model from disk. Must be called before `analyze()`.
   * @param modelPath Filesystem path to the ONNX model file (ignored for Torch backend).
   */
  async load(modelPath: string): Promise<void> {
    await this.loader.load(modelPath);
  }

  /**
   * Run inference on an image buffer (JPEG or PNG bytes).
   * Returns normalized bounding boxes, class labels, and confidence scores.
   */
  async analyze(imageBuffer: Buffer): Promise<InferenceResult> {
    return this.loader.analyze(imageBuffer);
  }

  /** Which backend is active: 'onnx' (CPU) or 'torch' (GPU/Jetson). */
  get backend(): string {
    return this.loader.selectedBackend;
  }
}
