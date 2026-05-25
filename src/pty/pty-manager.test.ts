import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PTYManager } from './pty-manager';
import type { PtyProcess, PtySpawner } from './pty-manager';
import { EventBus } from '../core/event-bus';

class MockPtyProcess implements PtyProcess {
  writes: string[] = [];
  killed = false;
  private dataHandlers: Array<(data: string) => void> = [];
  private exitHandlers: Array<() => void> = [];

  write(data: string): void {
    this.writes.push(data);
  }

  kill(_signal: string | number): void {
    this.killed = true;
    // Immediately fire exit handlers so PTYManager schedules its restart timer
    this.exitHandlers.forEach((h) => h());
  }

  on(event: 'data', handler: (data: string) => void): void;
  on(event: 'exit', handler: () => void): void;
  on(event: string, handler: ((data: string) => void) | (() => void)): void {
    if (event === 'data') this.dataHandlers.push(handler as (data: string) => void);
    if (event === 'exit') this.exitHandlers.push(handler as () => void);
  }

  /** Test helper — simulates shell producing output */
  simulateData(data: string): void {
    this.dataHandlers.forEach((h) => h(data));
  }

  /** Test helper — simulates shell process exiting naturally */
  simulateExit(): void {
    this.exitHandlers.forEach((h) => h());
  }
}

class MockPtySpawner implements PtySpawner {
  processes: MockPtyProcess[] = [];

  spawn(): PtyProcess {
    const proc = new MockPtyProcess();
    this.processes.push(proc);
    return proc;
  }
}

describe('PTYManager', () => {
  let spawner: MockPtySpawner;
  let bus: EventBus;
  let manager: PTYManager;

  beforeEach(() => {
    vi.useFakeTimers();
    spawner = new MockPtySpawner();
    bus = new EventBus();
    manager = new PTYManager(spawner, bus);
    manager.start();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() spawns exactly one process', () => {
    expect(spawner.processes).toHaveLength(1);
  });

  it('start() writes init commands to the process', () => {
    const proc = spawner.processes[0];
    expect(proc.writes).toContain('su - pi\r');
    expect(proc.writes).toContain('echo Welcome to ORobot SSH\r');
  });

  it('write() forwards data to the underlying process', () => {
    manager.write('ls -la\r');
    expect(spawner.processes[0].writes).toContain('ls -la\r');
  });

  it('process data output emits pty:output on bus', () => {
    const handler = vi.fn();
    bus.on('pty:output', handler);
    spawner.processes[0].simulateData('some shell output');
    expect(handler).toHaveBeenCalledWith({ data: 'some shell output' });
  });

  it('process exit triggers automatic restart after 1s', async () => {
    spawner.processes[0].simulateExit();
    await vi.advanceTimersByTimeAsync(1100);
    expect(spawner.processes).toHaveLength(2);
  });

  it('watchdog: write() with no output within 5s kills the process', async () => {
    manager.write('bad-command\r');
    await vi.advanceTimersByTimeAsync(5100);
    expect(spawner.processes[0].killed).toBe(true);
  });

  it('watchdog: spawn() arms the watchdog for init writes (slow-boot guard)', async () => {
    // After start(), the init writes (su - pi, echo ...) should have armed the
    // watchdog. If the shell produces no output within 5s (PAM slow on cold boot),
    // the process must be killed — not left alive waiting indefinitely.
    // We do NOT call write() here — the watchdog must be set by spawn() itself.
    await vi.advanceTimersByTimeAsync(5100);
    expect(spawner.processes[0].killed).toBe(true);
  });

  it('watchdog: spawn() watchdog clears when shell emits its first prompt', async () => {
    // Simulate the shell responding within the 5-second window (normal fast boot).
    // The process should NOT be killed.
    await vi.advanceTimersByTimeAsync(2000);
    spawner.processes[0].simulateData('pi@orobot:~$ ');
    await vi.advanceTimersByTimeAsync(3500); // past the original 5s deadline
    expect(spawner.processes[0].killed).toBe(false);
  });

  it('stop() prevents restart when the process exits', async () => {
    manager.stop();
    // Simulate the process exiting after stop() was called
    spawner.processes[0].simulateExit();
    await vi.advanceTimersByTimeAsync(1100);
    // Should still be 1 — no restart was scheduled
    expect(spawner.processes).toHaveLength(1);
  });
});
