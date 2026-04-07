import type { EventBus } from '../core/event-bus';

export interface PtyProcess {
  write(data: string): void;
  kill(signal: string | number): void;
  on(event: 'data', handler: (data: string) => void): void;
  on(event: 'exit', handler: () => void): void;
}

export interface PtySpawner {
  spawn(
    shell: string,
    args: string[],
    options: { name: string; cols: number; rows: number; env: NodeJS.ProcessEnv },
  ): PtyProcess;
}

const WATCHDOG_MS      = 5000;
const RESTART_DELAY_MS = 1000;

export class PTYManager {
  private process: PtyProcess | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private waitingForResponse = false;
  private stopped = false;
  private readonly shell: string;

  constructor(
    private readonly spawner: PtySpawner,
    private readonly bus: EventBus,
    shell?: string,
  ) {
    this.shell = shell ?? (process.platform === 'win32' ? 'powershell.exe' : 'bash');
  }

  /** Must be called once before write(). Idempotent if already started. */
  start(): void {
    if (this.process !== null) return;
    this.spawn();
  }

  /** Kills the shell process and prevents any further auto-restart. */
  stop(): void {
    this.stopped = true;
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.process !== null) {
      this.process.kill(9);
      this.process = null;
    }
  }

  /**
   * Forwards data to the shell process and resets the watchdog timer.
   * If no output arrives within 5s the process is killed (and auto-restarts via exit handler).
   */
  write(data: string): void {
    if (!this.process) throw new Error('PTYManager not started — call start() first');
    this.waitingForResponse = true;
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      if (this.waitingForResponse) {
        this.process?.kill(9);
      }
    }, WATCHDOG_MS);
    this.process.write(data);
  }

  private spawn(): void {
    const proc = this.spawner.spawn(this.shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      env: process.env as NodeJS.ProcessEnv,
    });
    this.process = proc;

    proc.write('su - pi\r');
    proc.write('echo Welcome to ORobot SSH\r');

    proc.on('data', (data) => {
      this.waitingForResponse = false;
      if (this.watchdogTimer) {
        clearTimeout(this.watchdogTimer);
        this.watchdogTimer = null;
      }
      this.bus.emit('pty:output', { data });
    });

    proc.on('exit', () => {
      if (this.watchdogTimer) {
        clearTimeout(this.watchdogTimer);
        this.watchdogTimer = null;
      }
      this.process = null;
      if (this.stopped) return; // do not restart after stop()
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.spawn();
      }, RESTART_DELAY_MS);
    });
  }
}
