import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DeviceStateService } from './device-state';

describe('DeviceStateService', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-state-test-'));
    filePath = path.join(tmpDir, 'data.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates a default state file when none exists', () => {
    const svc = new DeviceStateService(filePath);
    expect(svc.get().networkMode).toBe('ap');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('reads existing state from disk on construction', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({ deviceUuid: 'test-uuid', networkMode: 'client' }),
    );
    const svc = new DeviceStateService(filePath);
    expect(svc.get().deviceUuid).toBe('test-uuid');
    expect(svc.get().networkMode).toBe('client');
  });

  it('patch() updates state in memory', async () => {
    const svc = new DeviceStateService(filePath);
    await svc.patch({ deviceUuid: 'abc-123' });
    expect(svc.get().deviceUuid).toBe('abc-123');
  });

  it('patch() writes updated state to disk', async () => {
    const svc = new DeviceStateService(filePath);
    await svc.patch({ networkMode: 'client', pingTime: 42 });
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(onDisk.networkMode).toBe('client');
    expect(onDisk.pingTime).toBe(42);
  });

  it('patch() does not leave a .tmp file behind', async () => {
    const svc = new DeviceStateService(filePath);
    await svc.patch({ deviceUuid: 'x' });
    expect(fs.existsSync(filePath + '.tmp')).toBe(false);
  });

  it('patch() preserves fields not included in the update', async () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({ deviceUuid: 'keep-me', networkMode: 'ap', pingTime: 99 }),
    );
    const svc = new DeviceStateService(filePath);
    await svc.patch({ networkMode: 'client' });
    expect(svc.get().deviceUuid).toBe('keep-me');
    expect(svc.get().pingTime).toBe(99);
  });

  it('get() returns a frozen snapshot — mutation throws in strict mode', () => {
    const svc = new DeviceStateService(filePath);
    const state = svc.get();
    expect(() => {
      (state as { networkMode: string }).networkMode = 'dev';
    }).toThrow();
  });

  it('throws when the state file exists but contains malformed JSON', () => {
    fs.writeFileSync(filePath, '{ broken json');
    expect(() => new DeviceStateService(filePath)).toThrow(SyntaxError);
  });
});
