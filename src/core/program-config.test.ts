import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ProgramConfigService } from './program-config';

function makeTmpConfigFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orobot-cfg-'));
  return path.join(dir, 'program-config.json');
}

describe('ProgramConfigService', () => {
  it('returns empty config when file does not exist', () => {
    const svc = new ProgramConfigService('/nonexistent/path/program-config.json');
    const cfg = svc.get();
    expect(cfg).toEqual({});
  });

  it('persists and retrieves config', async () => {
    const file = makeTmpConfigFile();
    const svc  = new ProgramConfigService(file);
    await svc.save({ motors: [{ name: 'shoulder', resource: 0, minAngle: -90, maxAngle: 90 }] });
    const reloaded = new ProgramConfigService(file);
    expect(reloaded.get().motors?.[0]?.name).toBe('shoulder');
  });

  it('overwrites previous config on save', async () => {
    const file = makeTmpConfigFile();
    const svc  = new ProgramConfigService(file);
    await svc.save({ motors: [{ name: 'old', resource: 0, minAngle: 0, maxAngle: 180 }] });
    await svc.save({ motors: [{ name: 'new', resource: 0, minAngle: -45, maxAngle: 45 }] });
    expect(svc.get().motors?.[0]?.name).toBe('new');
  });

  it('survives corrupt JSON on disk by returning empty config', () => {
    const file = makeTmpConfigFile();
    fs.writeFileSync(file, 'not json {{}}');
    const svc = new ProgramConfigService(file);
    expect(svc.get()).toEqual({});
  });
});
