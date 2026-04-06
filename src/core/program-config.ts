import fs from 'fs';
import path from 'path';

export interface MotorConfig {
  name:     string;
  resource: number;
  minAngle: number;
  maxAngle: number;
}

export interface ProgramConfig {
  motors?:    MotorConfig[];
  poses?:     Record<string, Record<string, number>>;
  sequences?: Record<string, Array<{ pose: string; duration: number }>>;
  actions?:   Array<{ name: string; message: string }>;
  unitId?:    string;
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
