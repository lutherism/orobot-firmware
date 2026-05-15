import fs from 'fs';
import path from 'path';

export interface MotorConfig {
  name:     string;
  resource: number;
  minAngle: number;
  maxAngle: number;
}

export interface VisionConfig {
  /**
   * HuggingFace model ID to use for on-device inference.
   * Defaults to `Xenova/detr-resnet-50` when unset.
   * Example: `"Xenova/yolos-tiny"` for a faster, lighter alternative.
   */
  modelId?: string;
  /**
   * Maximum inference frames per second.
   * Clamped to 0.1–10 on both device and gateway to prevent runaway
   * compute cost. Defaults to 1.
   */
  sampleFps?: number;
}

export interface CameraConfig {
  /**
   * Whether continuous camera streaming is enabled. When true, the firmware
   * starts an ffmpeg capture loop and emits `camera-frame` WS messages at
   * `fps` frames per second. Defaults to false.
   */
  enabled?: boolean;
  /**
   * V4L2 device path on Linux (e.g. `/dev/video0`). Ignored in sim mode.
   * Defaults to `/dev/video0`.
   */
  device?: string;
  /**
   * Target frames per second. Clamped to 1–30. Defaults to 10.
   */
  fps?: number;
}

export interface ProgramConfig {
  motors?:    MotorConfig[];
  poses?:     Record<string, Record<string, number>>;
  sequences?: Record<string, Array<{ pose: string; duration: number }>>;
  actions?:   Array<{ name: string; message: string }>;
  unitId?:    string;
  vision?:    VisionConfig;
  /**
   * Camera configuration for continuous MJPEG streaming.
   * When `enabled` is true (or the field is truthy for legacy boolean compat),
   * the push-relay service (src/camera/stream-service.ts) activates on network
   * connect, and the WS-based CameraStreamService emits camera-frame messages.
   * Defaults to undefined (no camera process started).
   */
  camera?:    CameraConfig;
}

export class ProgramConfigService {
  private config: ProgramConfig;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      this.config = JSON.parse(raw) as ProgramConfig;
    } catch {
      this.config = {};
    }
  }

  get(): Readonly<ProgramConfig> {
    return { ...this.config };
  }

  async save(config: ProgramConfig): Promise<void> {
    this.config = { ...config };
    this.writeQueue = this.writeQueue.then(() => this.writeToDisk());
    return this.writeQueue;
  }

  private async writeToDisk(): Promise<void> {
    const tmpPath = this.filePath + '.tmp';
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(tmpPath, JSON.stringify(this.config, null, 2));
    await fs.promises.rename(tmpPath, this.filePath);
  }
}
