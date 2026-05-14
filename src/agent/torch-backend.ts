/**
 * Torch backend for on-device inference on Jetson/GPU.
 *
 * Runs a Python subprocess that loads the model via HuggingFace `transformers`
 * with `torch-cuda` and returns JSON results on stdout.  Using a subprocess
 * keeps the heavy CUDA dependency out of the Node.js process and lets the
 * Python worker load any HuggingFace model without native bindings.
 *
 * The Python worker (`scripts/torch_infer.py`) is expected to:
 *   1. Accept the model ID as argv[1].
 *   2. Read a base64-encoded JPEG from stdin.
 *   3. Print a single JSON line: { labels, boxes, scores }.
 *
 * For test isolation, the `spawn` function is injected via the constructor.
 */

import type { InferenceResult } from './types';
import { spawn as nodeSpawn } from 'child_process';
import path from 'path';

export type SpawnFn = typeof nodeSpawn;

const TORCH_WORKER_SCRIPT = path.join(__dirname, '../../scripts/torch_infer.py');
const SUBPROCESS_TIMEOUT_MS = 30_000;

export class TorchBackend {
  private readonly modelId: string;
  private readonly spawn: SpawnFn;
  private readonly workerScript: string;

  constructor(
    modelId: string,
    spawnFn: SpawnFn = nodeSpawn,
    workerScript: string = TORCH_WORKER_SCRIPT,
  ) {
    this.modelId      = modelId;
    this.spawn        = spawnFn;
    this.workerScript = workerScript;
  }

  async analyze(imageBuffer: Buffer): Promise<InferenceResult> {
    return new Promise((resolve, reject) => {
      const child = this.spawn('python3', [this.workerScript, this.modelId], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`TorchBackend: subprocess timed out after ${SUBPROCESS_TIMEOUT_MS}ms`));
      }, SUBPROCESS_TIMEOUT_MS);

      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`TorchBackend: subprocess exited with code ${code}. stderr: ${stderr}`));
          return;
        }
        try {
          const result = JSON.parse(stdout.trim()) as InferenceResult;
          resolve(result);
        } catch {
          reject(new Error(`TorchBackend: failed to parse subprocess output: ${stdout}`));
        }
      });

      child.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(new Error(`TorchBackend: failed to spawn subprocess: ${err.message}`));
      });

      // Send the image buffer as base64-encoded data on stdin, then close.
      child.stdin?.write(imageBuffer.toString('base64'));
      child.stdin?.end();
    });
  }
}
