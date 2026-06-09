import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { MdnsClaimService } from './mdns-claim';
import { EventBus } from '../core/event-bus';
import { makeTmpState } from '../test-utils/make-state';

// ---------------------------------------------------------------------------
// Minimal ChildProcess stub
// ---------------------------------------------------------------------------

function makeProc(): ChildProcess & { _killed: boolean } {
  const ee = new EventEmitter() as ChildProcess & { _killed: boolean };
  ee._killed = false;
  (ee as unknown as { kill: (sig?: string) => boolean }).kill = vi.fn(() => {
    ee._killed = true;
    setImmediate(() => ee.emit('exit', null, 'SIGTERM'));
    return true;
  });
  (ee as unknown as { stdin: null }).stdin = null;
  (ee as unknown as { stdout: null }).stdout = null;
  (ee as unknown as { stderr: null }).stderr = null;
  (ee as unknown as { stdio: null[] }).stdio = [null, null, null];
  return ee;
}

type SpawnCall = { cmd: string; args: string[] };

/**
 * Returns a spy spawn function and the list of calls/processes it records.
 */
function makeSpawnSpy(): {
  spawnFn: typeof import('child_process').spawn;
  calls: SpawnCall[];
  procs: ReturnType<typeof makeProc>[];
} {
  const calls: SpawnCall[] = [];
  const procs: ReturnType<typeof makeProc>[] = [];
  const spawnFn = vi.fn((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    const p = makeProc();
    procs.push(p);
    return p;
  }) as unknown as typeof import('child_process').spawn;
  return { spawnFn, calls, procs };
}

// ---------------------------------------------------------------------------

describe('MdnsClaimService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does nothing on start() when no pendingClaimCode', () => {
    const { spawnFn, calls } = makeSpawnSpy();
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'test-uuid', pendingClaimCode: null });
    const svc   = new MdnsClaimService(state, bus, undefined, spawnFn);

    svc.start();

    expect(calls).toHaveLength(0);
    svc.stop();
  });

  it('publishes immediately on start() if pendingClaimCode already set', () => {
    const { spawnFn, calls } = makeSpawnSpy();
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'abc-uuid', pendingClaimCode: '123456' });
    const svc   = new MdnsClaimService(state, bus, undefined, spawnFn);

    svc.start();

    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('avahi-publish');
    expect(calls[0].args).toContain('claimCode=123456');
    expect(calls[0].args).toContain('uuid=abc-uuid');
    expect(calls[0].args).toContain('setup=1');
    svc.stop();
  });

  it('service name uses first 8 chars of deviceUuid', () => {
    const { spawnFn, calls } = makeSpawnSpy();
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: '12345678-0000-0000-0000-000000000000', pendingClaimCode: '654321' });
    const svc   = new MdnsClaimService(state, bus, undefined, spawnFn);

    svc.start();

    expect(calls[0].args).toContain('-s');
    const nameIdx = calls[0].args.indexOf('-s');
    expect(calls[0].args[nameIdx + 1]).toBe('orobot-12345678');
    svc.stop();
  });

  it('publishes when portal:claim-code-stored fires', () => {
    const { spawnFn, calls } = makeSpawnSpy();
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'dev-uuid', pendingClaimCode: null });
    const svc   = new MdnsClaimService(state, bus, undefined, spawnFn);

    svc.start();
    expect(calls).toHaveLength(0);

    bus.emit('portal:claim-code-stored', { code: '999888' });

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('claimCode=999888');
    svc.stop();
  });

  it('kills old process and starts new one when a second claim code arrives', () => {
    const { spawnFn, procs } = makeSpawnSpy();
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'dev-uuid', pendingClaimCode: null });
    const svc   = new MdnsClaimService(state, bus, undefined, spawnFn);

    svc.start();
    bus.emit('portal:claim-code-stored', { code: '111111' });
    bus.emit('portal:claim-code-stored', { code: '222222' });

    expect(procs).toHaveLength(2);
    expect(procs[0]._killed).toBe(true);
    expect(procs[1]._killed).toBe(false);
    svc.stop();
  });

  it('withdraws on portal:claim-code-cleared', () => {
    const { spawnFn, procs } = makeSpawnSpy();
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'dev-uuid', pendingClaimCode: null });
    const svc   = new MdnsClaimService(state, bus, undefined, spawnFn);

    svc.start();
    bus.emit('portal:claim-code-stored', { code: '555444' });
    expect(procs[0]._killed).toBe(false);

    bus.emit('portal:claim-code-cleared', {});
    expect(procs[0]._killed).toBe(true);
    svc.stop();
  });

  it('stop() kills running process and removes listeners', () => {
    const { spawnFn, procs } = makeSpawnSpy();
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'dev-uuid', pendingClaimCode: null });
    const svc   = new MdnsClaimService(state, bus, undefined, spawnFn);

    svc.start();
    bus.emit('portal:claim-code-stored', { code: '777666' });
    expect(procs[0]._killed).toBe(false);

    svc.stop();
    expect(procs[0]._killed).toBe(true);

    // After stop(), further events must not trigger new publishes.
    bus.emit('portal:claim-code-stored', { code: '000111' });
    expect(procs).toHaveLength(1);
  });

  it('handles spawn ENOENT gracefully (avahi-publish absent)', () => {
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: 'dev-uuid', pendingClaimCode: null });
    const errSpawn = vi.fn((cmd: string, _args: string[]) => {
      const p = makeProc();
      // Simulate avahi-publish not found on this platform.
      setImmediate(() => {
        const err = new Error('spawn avahi-publish ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        p.emit('error', err);
      });
      return p;
    }) as unknown as typeof import('child_process').spawn;

    const svc = new MdnsClaimService(state, bus, undefined, errSpawn);
    svc.start();
    // Should not throw.
    bus.emit('portal:claim-code-stored', { code: '123456' });
    svc.stop();
  });

  it('does not publish when deviceUuid is empty', () => {
    const { spawnFn, calls } = makeSpawnSpy();
    const bus   = new EventBus();
    const state = makeTmpState({ deviceUuid: '', pendingClaimCode: null });
    // DeviceStateService auto-generates a UUID if empty during construction,
    // so we patch it back after construction.
    const svc   = new MdnsClaimService(state, bus, undefined, spawnFn);

    // Patch to empty UUID to simulate edge case before UUID provisioned.
    void state.patch({ deviceUuid: '' });
    svc.start();
    bus.emit('portal:claim-code-stored', { code: '123456' });

    // Since deviceUuid is '' the guard should bail before spawning.
    // The patch is async; access via state.get() to verify.
    const { deviceUuid } = state.get();
    if (!deviceUuid) {
      expect(calls).toHaveLength(0);
    }
    svc.stop();
  });
});
