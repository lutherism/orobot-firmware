/**
 * Shared types for the orobot-agent on-device inference engine.
 *
 * `InferenceResult` is the normalized output format regardless of backend
 * (ONNX on Pi/CPU or torch subprocess on Jetson/GPU).
 */

export interface BoundingBox {
  /** x coordinate of the top-left corner, normalized 0–1 */
  x: number;
  /** y coordinate of the top-left corner, normalized 0–1 */
  y: number;
  /** width of the box, normalized 0–1 */
  width: number;
  /** height of the box, normalized 0–1 */
  height: number;
}

export interface InferenceResult {
  labels: string[];
  boxes: BoundingBox[];
  scores: number[];
}

export interface AgentConfig {
  /** HuggingFace model ID, e.g. "Xenova/detr-resnet-50" */
  modelId: string;
}
