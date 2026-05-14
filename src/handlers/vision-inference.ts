/**
 * On-device vision inference handler.
 *
 * Triggered by the `infer-frame` message type. Captures a camera frame,
 * runs local inference via a pluggable backend (transformers.js subprocess
 * or Python/ONNX), and emits a `vision-inference` WS message alongside
 * the camera frame containing bounding boxes, labels, and confidence scores.
 *
 * Backend resolution order:
 *   1. Caller-supplied `InferenceBackend` (tests / custom integrations)
 *   2. `OROBOT_VISION_BACKEND=python` → Python subprocess (ONNX Runtime, good for Pi 4)
 *   3. `OROBOT_VISION_BACKEND=transformers` → transformers.js child process
 *   4. No backend found → emits empty `vision-inference` with `status: "unavailable"`
 *
 * Model selection: reads `vision.modelId` from the live program config.
 * Falls back to `Xenova/detr-resnet-50` (compact DETR, ~170 MB, runs on Pi 4
 * at ~1–2 fps via ONNX Runtime).
 */

import type { EventBus } from '../core/event-bus';
import type { MessageHandler } from './registry';
import type { CameraCapture, CameraFrame } from './camera';
import type { ProgramConfigService } from '../core/program-config';
import { makeEnvelope } from '../core/wire';
import { createLogger } from '../core/logger';

// ── Public types ─────────────────────────────────────────────────────────────

export interface Detection {
  label:      string;
  score:      number;
  /** Normalised bounding box [0–1] relative to image width/height. */
  box: {
    x:      number;
    y:      number;
    width:  number;
    height: number;
  };
}

export interface VisionInferenceResult {
  /** ISO timestamp of when inference completed. */
  inferredAt:  string;
  /** HuggingFace model ID used for inference (may differ from config when falling back). */
  modelId:     string;
  /** Milliseconds taken to run inference on-device. */
  latencyMs:   number;
  detections:  Detection[];
  status:      'ok' | 'unavailable' | 'error';
  error?:      string;
}

/**
 * Pluggable inference backend. Implementations receive the image as a
 * base64-encoded string and the MIME type, and return an array of detections.
 * Any backend that cannot run on the current device should throw immediately
 * (without retrying) — the handler will downgrade to `status: "unavailable"`.
 */
export interface InferenceBackend {
  /** Human-readable name used in logs. */
  readonly name: string;
  /**
   * Run inference on a single frame.
   * @param frame     base64-encoded image data
   * @param mimeType  MIME type of the image (e.g. "image/jpeg")
   * @param modelId   HuggingFace model identifier
   */
  infer(frame: string, mimeType: string, modelId: string): Promise<Detection[]>;
}

// ── Default model ────────────────────────────────────────────────────────────

/**
 * Compact DETR-ResNet-50 exported to ONNX — runs on Pi 4 CPU at ~1–2 fps.
 * Requires transformers.js ≥ 2.x or the companion Python helper.
 */
export const DEFAULT_VISION_MODEL = 'Xenova/detr-resnet-50';

// ── Python subprocess backend ────────────────────────────────────────────────

/**
 * Runs inference via a companion Python script (`scripts/vision_infer.py`).
 * The script reads JSON from stdin and writes JSON detections to stdout.
 * Uses ONNX Runtime (good for Pi 4 CPU) or PyTorch/CUDA for Jetson.
 *
 * Expected stdin schema:
 *   { "frame": "<base64>", "mimeType": "image/jpeg", "modelId": "Xenova/detr-resnet-50" }
 *
 * Expected stdout schema:
 *   [{ "label": "cat", "score": 0.92, "box": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4 } }, ...]
 */
export class PythonInferenceBackend implements InferenceBackend {
  readonly name = 'python-onnx';

  async infer(frame: string, mimeType: string, modelId: string): Promise<Detection[]> {
    const { spawn } = await import('child_process');
    const path = await import('path');
    const scriptPath = path.join(__dirname, '../../scripts/vision_infer.py');

    return new Promise((resolve, reject) => {
      const proc = spawn('python3', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`python3 exited ${code}: ${stderr.trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as Detection[]);
        } catch {
          reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 200)}`));
        }
      });

      proc.stdin.end(JSON.stringify({ frame, mimeType, modelId }));
    });
  }
}

// ── transformers.js subprocess backend ──────────────────────────────────────

/**
 * Runs inference in a separate Node.js child process using transformers.js
 * (`@xenova/transformers`). The child process is spawned fresh each call
 * to avoid memory leaks from repeated model loads — suitable for low-fps
 * camera polling.
 *
 * Requires: `npm install @xenova/transformers` (not bundled by default).
 */
export class TransformersJsBackend implements InferenceBackend {
  readonly name = 'transformers.js';

  async infer(frame: string, mimeType: string, modelId: string): Promise<Detection[]> {
    const { fork } = await import('child_process');
    const path = await import('path');
    const workerPath = path.join(__dirname, '../vision/transformers-worker.js');

    return new Promise((resolve, reject) => {
      const child = fork(workerPath, [], { silent: true });
      let stdout = '';

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`transformers worker exited ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as Detection[]);
        } catch {
          reject(new Error(`Failed to parse worker output: ${stdout.slice(0, 200)}`));
        }
      });

      child.send({ frame, mimeType, modelId });
    });
  }
}

// ── Backend auto-detection ────────────────────────────────────────────────────

function resolveBackend(): InferenceBackend | null {
  const env = process.env['OROBOT_VISION_BACKEND'];
  if (env === 'python')       return new PythonInferenceBackend();
  if (env === 'transformers') return new TransformersJsBackend();
  return null;
}

// ── Handler factory ──────────────────────────────────────────────────────────

/**
 * Creates the `infer-frame` message handler.
 *
 * @param bus           event bus for emitting network:send events
 * @param configService program config service (reads `vision.modelId`)
 * @param capture       camera frame capture function (default: captureCameraFrame)
 * @param backend       inference backend; omit to auto-detect from environment
 */
export function createVisionInferenceHandler(
  bus: EventBus,
  configService: ProgramConfigService,
  capture: CameraCapture,
  backend?: InferenceBackend | null,
): MessageHandler {
  const log = createLogger('vision-inference');
  const resolvedBackend = backend !== undefined ? backend : resolveBackend();

  return async (msg) => {
    const config = configService.get();
    const modelId = config.vision?.modelId ?? DEFAULT_VISION_MODEL;
    const startMs = Date.now();

    let result: VisionInferenceResult;

    if (!resolvedBackend) {
      result = {
        inferredAt:  new Date().toISOString(),
        modelId,
        latencyMs:   0,
        detections:  [],
        status:      'unavailable',
        error:       'No inference backend available. Set OROBOT_VISION_BACKEND=python or =transformers.',
      };
    } else {
      let frame: CameraFrame;
      try {
        frame = await capture();
      } catch (err) {
        result = {
          inferredAt:  new Date().toISOString(),
          modelId,
          latencyMs:   Date.now() - startMs,
          detections:  [],
          status:      'error',
          error:       `Camera capture failed: ${err instanceof Error ? err.message : String(err)}`,
        };
        bus.emit('network:send', {
          payload: makeEnvelope('vision-inference', {
            deviceUuid: msg.deviceUuid,
            data: result,
          }),
        });
        return;
      }

      try {
        const detections = await resolvedBackend.infer(frame.frame, frame.mimeType, modelId);
        result = {
          inferredAt:  new Date().toISOString(),
          modelId,
          latencyMs:   Date.now() - startMs,
          detections,
          status:      'ok',
        };
      } catch (err) {
        log.warn({ err, backend: resolvedBackend.name }, 'Inference backend failed');
        result = {
          inferredAt:  new Date().toISOString(),
          modelId,
          latencyMs:   Date.now() - startMs,
          detections:  [],
          status:      'error',
          error:       err instanceof Error ? err.message : String(err),
        };
      }
    }

    bus.emit('network:send', {
      payload: makeEnvelope('vision-inference', {
        deviceUuid: msg.deviceUuid,
        data: result,
      }),
    });
  };
}
