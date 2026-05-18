/**
 * Starter model allowlist for orobot-agent.
 *
 * These are pre-vetted ONNX models from HuggingFace Hub that are known to
 * work with the OnnxBackend on Raspberry Pi (CPU, quantized, reasonable size).
 *
 * The `downloadUrl` is the resolved ONNX model path from the Hub. Each entry
 * is a canonical HuggingFace model ID that the ModelManager understands.
 */

export interface CatalogEntry {
  /** HuggingFace model ID, e.g. "Xenova/detr-resnet-50" */
  modelId: string;
  /** Human-readable description */
  description: string;
  /** Task category */
  task: 'object-detection' | 'image-classification';
  /** Approximate size in MB (for display) */
  sizeMb: number;
  /** Direct URL to download the ONNX model file */
  downloadUrl: string;
}

export const STARTER_MODELS: CatalogEntry[] = [
  {
    modelId: 'Xenova/detr-resnet-50',
    description: 'DEtection TRansformer (DETR) — general object detection, 80 COCO classes',
    task: 'object-detection',
    sizeMb: 40,
    downloadUrl: 'https://huggingface.co/Xenova/detr-resnet-50/resolve/main/onnx/model_quantized.onnx',
  },
  {
    modelId: 'Xenova/mobilevit-small',
    description: 'MobileViT Small — lightweight image classification, 1000 ImageNet classes',
    task: 'image-classification',
    sizeMb: 20,
    downloadUrl: 'https://huggingface.co/Xenova/mobilevit-small/resolve/main/onnx/model.onnx',
  },
  {
    modelId: 'Xenova/yolos-tiny',
    description: 'YOLOS Tiny — fast object detection, 80 COCO classes',
    task: 'object-detection',
    sizeMb: 30,
    downloadUrl: 'https://huggingface.co/Xenova/yolos-tiny/resolve/main/onnx/model.onnx',
  },
];

/** Look up a catalog entry by modelId (undefined if not in allowlist). */
export function findInCatalog(modelId: string): CatalogEntry | undefined {
  return STARTER_MODELS.find((m) => m.modelId === modelId);
}
