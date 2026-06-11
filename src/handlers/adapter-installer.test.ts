/**
 * Tests for AdapterInstaller.
 *
 * npm is never actually invoked — the NpmInstaller dependency is injected
 * as a mock that either resolves or rejects to simulate install success/failure.
 */

import { describe, it, expect, vi } from 'vitest';
import { AdapterInstaller, type NpmInstaller } from './adapter-installer';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeInstaller(
  onInstall: (id: string) => Promise<void> = () => Promise.resolve(),
): { installer: AdapterInstaller; calls: string[] } {
  const calls: string[] = [];
  const npmInstaller: NpmInstaller = (packageId, _cwd) => {
    calls.push(packageId);
    return onInstall(packageId);
  };
  return {
    installer: new AdapterInstaller('/tmp/test-adapters', npmInstaller),
    calls,
  };
}

// ── isAllowed ────────────────────────────────────────────────────────────────

describe('AdapterInstaller.isAllowed', () => {
  const { installer } = makeInstaller();

  it('accepts @orobot/adapter-waveshare-servo', () => {
    expect(installer.isAllowed('@orobot/adapter-waveshare-servo')).toBe(true);
  });

  it('accepts @orobot/adapter-pca9685', () => {
    expect(installer.isAllowed('@orobot/adapter-pca9685')).toBe(true);
  });

  it('accepts single-slug adapters', () => {
    expect(installer.isAllowed('@orobot/adapter-x')).toBe(true);
  });

  it('rejects arbitrary npm package (no scope)', () => {
    expect(installer.isAllowed('lodash')).toBe(false);
  });

  it('rejects wrong scope', () => {
    expect(installer.isAllowed('@evil/adapter-malware')).toBe(false);
  });

  it('rejects @orobot/non-adapter package', () => {
    expect(installer.isAllowed('@orobot/firmware')).toBe(false);
  });

  it('rejects git URL', () => {
    expect(installer.isAllowed('github:evil/pkg')).toBe(false);
  });

  it('rejects file: path', () => {
    expect(installer.isAllowed('file:../../../etc/shadow')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(installer.isAllowed('')).toBe(false);
  });

  it('rejects uppercase chars', () => {
    expect(installer.isAllowed('@orobot/adapter-WaveShare')).toBe(false);
  });

  it('rejects ID with version specifier', () => {
    expect(installer.isAllowed('@orobot/adapter-waveshare-servo@1.0.0')).toBe(false);
  });

  it('rejects @orobot/adapter- with no slug', () => {
    expect(installer.isAllowed('@orobot/adapter-')).toBe(false);
  });
});

// ── installAdapters ──────────────────────────────────────────────────────────

describe('AdapterInstaller.installAdapters', () => {
  it('installs a valid adapter and returns it in the installed list', async () => {
    const { installer, calls } = makeInstaller();
    const installed = await installer.installAdapters(['@orobot/adapter-waveshare-servo']);
    expect(calls).toEqual(['@orobot/adapter-waveshare-servo']);
    expect(installed).toEqual(['@orobot/adapter-waveshare-servo']);
  });

  it('installs multiple valid adapters', async () => {
    const { installer, calls } = makeInstaller();
    const installed = await installer.installAdapters([
      '@orobot/adapter-waveshare-servo',
      '@orobot/adapter-pca9685',
    ]);
    expect(calls).toEqual(['@orobot/adapter-waveshare-servo', '@orobot/adapter-pca9685']);
    expect(installed).toHaveLength(2);
  });

  it('silently skips disallowed IDs (does not call npm)', async () => {
    const { installer, calls } = makeInstaller();
    const installed = await installer.installAdapters(['lodash', '../../../etc/shadow']);
    expect(calls).toHaveLength(0);
    expect(installed).toHaveLength(0);
  });

  it('continues past a failed install and returns only the successes', async () => {
    const { installer, calls } = makeInstaller((id) => {
      if (id === '@orobot/adapter-missing') return Promise.reject(new Error('404 Not Found'));
      return Promise.resolve();
    });
    const installed = await installer.installAdapters([
      '@orobot/adapter-waveshare-servo',
      '@orobot/adapter-missing',
      '@orobot/adapter-pca9685',
    ]);
    expect(calls).toEqual(['@orobot/adapter-waveshare-servo', '@orobot/adapter-missing', '@orobot/adapter-pca9685']);
    expect(installed).toEqual(['@orobot/adapter-waveshare-servo', '@orobot/adapter-pca9685']);
  });

  it('returns empty list when given empty array', async () => {
    const { installer, calls } = makeInstaller();
    const installed = await installer.installAdapters([]);
    expect(calls).toHaveLength(0);
    expect(installed).toHaveLength(0);
  });

  it('skips mixed valid/invalid without throwing', async () => {
    const { installer, calls } = makeInstaller();
    const installed = await installer.installAdapters([
      'evil-pkg',
      '@orobot/adapter-ok',
      'github:x/y',
    ]);
    expect(calls).toEqual(['@orobot/adapter-ok']);
    expect(installed).toEqual(['@orobot/adapter-ok']);
  });
});

// ── load-config integration ──────────────────────────────────────────────────

describe('createLoadConfigHandler — adapter integration', () => {
  it('calls installAdapters when hardwareAdapters is present in config', async () => {
    const { createLoadConfigHandler } = await import('./program-config');
    const { ProgramConfigService } = await import('../core/program-config');
    const { StepperMotor } = await import('../hardware/stepper-motor');
    const { MockGPIODriver } = await import('../hardware/mock-driver');
    const { EventBus } = await import('../core/event-bus');
    const os = await import('os');

    const tmpPath = `${os.tmpdir()}/adapter-test-${Date.now()}.json`;
    const configSvc = new ProgramConfigService(tmpPath);
    const bus = new EventBus();
    const motor = new StepperMotor(new MockGPIODriver(), [], bus);

    const calls: string[] = [];
    const fakeInstaller = {
      isAllowed: (id: string) => /^@orobot\/adapter-[a-z0-9][a-z0-9-]*$/.test(id),
      installAdapters: vi.fn(async (ids: string[]) => { calls.push(...ids); return ids; }),
      nodeModulesPath: '/tmp/fake/node_modules',
    };

    const handler = createLoadConfigHandler(configSvc, motor, undefined, fakeInstaller as any);
    await handler({
      type: 'load-config',
      ackId: '',
      deviceUuid: 'dev-adapter',
      data: JSON.stringify({
        config: { hardwareAdapters: ['@orobot/adapter-waveshare-servo'] },
        unitId: 'u1',
      }),
    });

    // installAdapters is fire-and-forget — give the microtask queue a tick
    await new Promise(r => setTimeout(r, 10));
    expect(fakeInstaller.installAdapters).toHaveBeenCalledWith(['@orobot/adapter-waveshare-servo']);
  });

  it('does not call installAdapters when hardwareAdapters is absent', async () => {
    const { createLoadConfigHandler } = await import('./program-config');
    const { ProgramConfigService } = await import('../core/program-config');
    const { StepperMotor } = await import('../hardware/stepper-motor');
    const { MockGPIODriver } = await import('../hardware/mock-driver');
    const { EventBus } = await import('../core/event-bus');
    const os = await import('os');

    const tmpPath = `${os.tmpdir()}/adapter-test-absent-${Date.now()}.json`;
    const configSvc = new ProgramConfigService(tmpPath);
    const bus = new EventBus();
    const motor = new StepperMotor(new MockGPIODriver(), [], bus);

    const fakeInstaller = {
      installAdapters: vi.fn(async (_ids: string[]) => []),
      nodeModulesPath: '/tmp/fake/node_modules',
    };

    const handler = createLoadConfigHandler(configSvc, motor, undefined, fakeInstaller as any);
    await handler({
      type: 'load-config',
      ackId: '',
      deviceUuid: 'dev-no-adapters',
      data: JSON.stringify({ config: {}, unitId: 'u2' }),
    });

    await new Promise(r => setTimeout(r, 10));
    expect(fakeInstaller.installAdapters).not.toHaveBeenCalled();
  });
});
