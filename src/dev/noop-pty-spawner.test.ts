import { describe, it, expect, vi } from 'vitest';
import { NoopPtySpawner } from './noop-pty-spawner';

const OPTS = { name: 'xterm-color', cols: 80, rows: 30, env: process.env as NodeJS.ProcessEnv };

describe('NoopPtySpawner', () => {
  it('spawn() returns an object with write, kill, and on', () => {
    const proc = new NoopPtySpawner().spawn('/bin/bash', [], OPTS);
    expect(typeof proc.write).toBe('function');
    expect(typeof proc.kill).toBe('function');
    expect(typeof proc.on).toBe('function');
  });

  it('write() does not throw', () => {
    const proc = new NoopPtySpawner().spawn('/bin/bash', [], OPTS);
    expect(() => proc.write('ls -la\r')).not.toThrow();
  });

  it('kill() does not throw', () => {
    const proc = new NoopPtySpawner().spawn('/bin/bash', [], OPTS);
    expect(() => proc.kill(9)).not.toThrow();
  });

  it('on("data") handler is never called', () => {
    const proc    = new NoopPtySpawner().spawn('/bin/bash', [], OPTS);
    const handler = vi.fn();
    proc.on('data', handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it('on("exit") handler is never called', () => {
    const proc    = new NoopPtySpawner().spawn('/bin/bash', [], OPTS);
    const handler = vi.fn();
    proc.on('exit', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});
