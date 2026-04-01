import type { PtySpawner, PtyProcess } from '../pty/pty-manager';

export class NoopPtySpawner implements PtySpawner {
  spawn(
    shell: string,
    _args: string[],
    _options: { name: string; cols: number; rows: number; env: NodeJS.ProcessEnv },
  ): PtyProcess {
    console.log(`[pty] spawned (no-op): ${shell}`);
    return {
      write(data: string): void {
        console.log(`[pty] received: ${data.trim()}`);
      },
      kill(_signal: string | number): void {
        // no-op — nothing to kill
      },
      on(_event: 'data' | 'exit', _handler: ((data: string) => void) | (() => void)): void {
        // no-op — never emits data or exit in dev mode
      },
    };
  }
}
