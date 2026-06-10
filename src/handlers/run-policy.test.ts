/**
 * Tests for the LeRobot policy-inference launcher handler.
 *
 * No real python / huggingface-cli subprocess is ever spawned — a mock
 * PolicySpawner returns fake ChildProcess EventEmitters whose stdout/stderr
 * and close/error events are driven by the test. Sim-mode behaviour is tested
 * separately and never spawns anything.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import { EventBus } from '../core/event-bus';
import type { InboundMessage } from '../core/types';
import type { OutboundEnvelope } from '../core/wire';
import {
  PolicyRunner,
  parseRunPolicyData,
  createRunPolicyHandlers,
  type RunPolicyPayload,
  type PolicySpawner,
} from './run-policy';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBus(): { bus: EventBus; sent: OutboundEnvelope[] } {
  const bus = new EventBus();
  const sent: OutboundEnvelope[] = [];
  bus.on('network:send', ({ payload }) => sent.push(payload));
  return { bus, sent };
}

interface FakeProc {
  proc: ChildProcess;
  emitOut: (s: string) => void;
  emitErr: (s: string) => void;
  emitClose: (code?: number | null, signal?: NodeJS.Signals | null) => void;
  emitError: (err: Error) => void;
  killed: () => boolean;
  killSignal: () => string | undefined;
}

function makeFakeProc(): FakeProc {
  const stdout = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  const stderr = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  let wasKilled = false;
  let sig: string | undefined;
  (proc as any).kill = (s?: string) => { wasKilled = true; sig = s; return true; };
  return {
    proc,
    emitOut: (s) => stdout.emit('data', Buffer.from(s)),
    emitErr: (s) => stderr.emit('data', Buffer.from(s)),
    emitClose: (code = 0, signal = null) => proc.emit('close', code, signal),
    emitError: (err) => proc.emit('error', err),
    killed: () => wasKilled,
    killSignal: () => sig,
  };
}

/** A spawner that hands out queued fake procs in order, recording argv. */
function queuedSpawner(procs: FakeProc[]): {
  spawner: PolicySpawner;
  calls: { command: string; args: string[] }[];
} {
  const calls: { command: string; args: string[] }[] = [];
  let i = 0;
  const spawner: PolicySpawner = (command, args) => {
    calls.push({ command, args });
    return procs[i++].proc;
  };
  return { spawner, calls };
}

const PAYLOAD: RunPolicyPayload = {
  modelRepo:  'lerobot/act_so101_beyond',
  policyType: 'act',
  cameras:    [],
  jobId:      'job-123',
};

function statusEvents(sent: OutboundEnvelope[]) {
  return sent
    .filter(p => p.type === 'policy-status')
    .map(p => JSON.parse(p.data as string) as { jobId: string; status: string; error?: string });
}

function logTexts(sent: OutboundEnvelope[]) {
  return sent.filter(p => p.type === 'device-log').map(p => p.text ?? '');
}

// ── parseRunPolicyData ─────────────────────────────────────────────────────────

describe('parseRunPolicyData', () => {
  it('parses a well-formed gateway payload', () => {
    const data = 'run-policy:' + JSON.stringify({
      modelRepo: 'foo/bar', policyType: 'diffusion', cameras: ['top'], jobId: 'j1',
    });
    expect(parseRunPolicyData(data)).toEqual({
      modelRepo: 'foo/bar', policyType: 'diffusion', cameras: ['top'], jobId: 'j1',
    });
  });

  it('defaults policyType to "act" and cameras to []', () => {
    const data = 'run-policy:' + JSON.stringify({ modelRepo: 'foo/bar', jobId: 'j2' });
    expect(parseRunPolicyData(data)).toEqual({
      modelRepo: 'foo/bar', policyType: 'act', cameras: [], jobId: 'j2',
    });
  });

  it('returns null on malformed JSON', () => {
    expect(parseRunPolicyData('run-policy:{not json')).toBeNull();
  });

  it('returns null when modelRepo or jobId is missing', () => {
    expect(parseRunPolicyData('run-policy:' + JSON.stringify({ jobId: 'j' }))).toBeNull();
    expect(parseRunPolicyData('run-policy:' + JSON.stringify({ modelRepo: 'x' }))).toBeNull();
  });
});

// ── buildInferenceArgs ─────────────────────────────────────────────────────────

describe('PolicyRunner.buildInferenceArgs', () => {
  it('builds the lerobot control_robot argv with policy + model', () => {
    const args = PolicyRunner.buildInferenceArgs(PAYLOAD);
    expect(args).toContain('lerobot.scripts.control_robot');
    expect(args).toContain('--control.policy.type');
    expect(args).toContain('act');
    expect(args).toContain('--control.policy.pretrained=lerobot/act_so101_beyond');
    expect(args).toContain('--robot.type');
    expect(args).toContain('so101');
  });

  it('appends each camera as a --robot.cameras arg', () => {
    const args = PolicyRunner.buildInferenceArgs({ ...PAYLOAD, cameras: ['top', 'wrist'] });
    const camIdx = args.filter(a => a === '--robot.cameras').length;
    expect(camIdx).toBe(2);
    expect(args).toContain('top');
    expect(args).toContain('wrist');
  });
});

// ── sim mode ───────────────────────────────────────────────────────────────────

describe('PolicyRunner — sim mode', () => {
  it('never spawns and reports unavailable + error status', () => {
    const { bus, sent } = makeBus();
    const spawner = vi.fn();
    const runner = new PolicyRunner(bus, () => 'dev-1', { simMode: true, spawner: spawner as any });

    runner.start(PAYLOAD);

    expect(spawner).not.toHaveBeenCalled();
    const statuses = statusEvents(sent);
    expect(statuses.map(s => s.status)).toEqual(['running', 'error']);
    expect(statuses[1].error).toMatch(/unavailable/i);
    expect(logTexts(sent).join('\n')).toMatch(/sim mode/i);
  });
});

// ── happy path: download → inference → done ────────────────────────────────────

describe('PolicyRunner — real spawner', () => {
  it('downloads the model then launches inference and reports done', () => {
    const { bus, sent } = makeBus();
    const dl = makeFakeProc();
    const inf = makeFakeProc();
    const { spawner, calls } = queuedSpawner([dl, inf]);
    const runner = new PolicyRunner(bus, () => 'dev-1', { simMode: false, spawner });

    runner.start(PAYLOAD);

    // First spawn = huggingface-cli download
    expect(calls[0].command).toBe('huggingface-cli');
    expect(calls[0].args).toEqual(['download', 'lerobot/act_so101_beyond']);
    expect(runner.runningJobs).toEqual(['job-123']);

    // download streams a line, then succeeds → inference launches
    dl.emitOut('Fetching 12 files');
    dl.emitClose(0);

    expect(calls[1].command).toBe('python3');
    expect(calls[1].args).toContain('lerobot.scripts.control_robot');

    // inference streams output then exits cleanly
    inf.emitOut('step 1 reward 0.5\n');
    inf.emitClose(0);

    const statuses = statusEvents(sent).map(s => s.status);
    expect(statuses).toEqual(['running', 'done']);
    expect(runner.runningJobs).toEqual([]);

    const logs = logTexts(sent);
    expect(logs.some(l => l.includes('Fetching 12 files'))).toBe(true);
    expect(logs.some(l => l.includes('step 1 reward 0.5'))).toBe(true);
  });

  it('reports error when the download step fails (and does not launch inference)', () => {
    const { bus, sent } = makeBus();
    const dl = makeFakeProc();
    const { spawner, calls } = queuedSpawner([dl]);
    const runner = new PolicyRunner(bus, () => 'dev-1', { simMode: false, spawner });

    runner.start(PAYLOAD);
    dl.emitErr('404 repo not found');
    dl.emitClose(1);

    expect(calls).toHaveLength(1); // inference never spawned
    const statuses = statusEvents(sent);
    expect(statuses.map(s => s.status)).toEqual(['running', 'error']);
    expect(statuses[1].error).toMatch(/exited with code 1/);
  });

  it('reports error when inference exits non-zero', () => {
    const { bus, sent } = makeBus();
    const dl = makeFakeProc();
    const inf = makeFakeProc();
    const { spawner } = queuedSpawner([dl, inf]);
    const runner = new PolicyRunner(bus, () => 'dev-1', { simMode: false, spawner });

    runner.start(PAYLOAD);
    dl.emitClose(0);
    inf.emitClose(2);

    const statuses = statusEvents(sent);
    expect(statuses.map(s => s.status)).toEqual(['running', 'error']);
    expect(statuses[1].error).toMatch(/exited with code 2/);
  });

  it('ignores a duplicate start for an already-running job (re-delivery safe)', () => {
    const { bus } = makeBus();
    const dl = makeFakeProc();
    const inf = makeFakeProc();
    const extra = makeFakeProc();
    const { spawner, calls } = queuedSpawner([dl, inf, extra]);
    const runner = new PolicyRunner(bus, () => 'dev-1', { simMode: false, spawner });

    runner.start(PAYLOAD);
    runner.start(PAYLOAD); // duplicate — should be ignored while running

    expect(calls).toHaveLength(1); // only the first download spawned
  });
});

// ── stop ────────────────────────────────────────────────────────────────────────

describe('PolicyRunner — stop', () => {
  it('kills the running inference process and reports cancelled once', () => {
    const { bus, sent } = makeBus();
    const dl = makeFakeProc();
    const inf = makeFakeProc();
    const { spawner } = queuedSpawner([dl, inf]);
    const runner = new PolicyRunner(bus, () => 'dev-1', { simMode: false, spawner });

    runner.start(PAYLOAD);
    dl.emitClose(0); // → inference running
    expect(runner.runningJobs).toEqual(['job-123']);

    runner.stop('job-123');
    expect(inf.killed()).toBe(true);
    expect(inf.killSignal()).toBe('SIGTERM');

    // The subsequent close (from the kill) must NOT emit a second status.
    inf.emitClose(null, 'SIGTERM');

    const cancelled = statusEvents(sent).filter(s => s.status === 'cancelled');
    expect(cancelled).toHaveLength(1);
    expect(runner.runningJobs).toEqual([]);
  });

  it('stop on an unknown job is a no-op that still emits cancelled', () => {
    const { bus, sent } = makeBus();
    const runner = new PolicyRunner(bus, () => 'dev-1', { simMode: false, spawner: queuedSpawner([]).spawner });
    runner.stop('nope');
    expect(statusEvents(sent).map(s => s.status)).toEqual(['cancelled']);
  });
});

// ── handler wiring ───────────────────────────────────────────────────────────────

function makeMsg(data: string): InboundMessage {
  return { type: 'command-in', data, ackId: 'ack-1', deviceUuid: 'dev-1' };
}

describe('createRunPolicyHandlers', () => {
  beforeEach(() => vi.useRealTimers());

  it('run handler starts the runner asynchronously (does not block)', async () => {
    const { bus } = makeBus();
    const { runner, run } = createRunPolicyHandlers(bus, () => 'dev-1', { simMode: true });
    const startSpy = vi.spyOn(runner, 'start');

    const data = 'run-policy:' + JSON.stringify(PAYLOAD);
    await run(makeMsg(data)); // resolves immediately

    expect(startSpy).not.toHaveBeenCalled(); // deferred via setImmediate
    await new Promise(r => setImmediate(r));
    expect(startSpy).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-123' }));
  });

  it('run handler emits an error log on malformed payload and does not start', async () => {
    const { bus, sent } = makeBus();
    const { runner, run } = createRunPolicyHandlers(bus, () => 'dev-1', { simMode: true });
    const startSpy = vi.spyOn(runner, 'start');

    await run(makeMsg('run-policy:{bad'));
    await new Promise(r => setImmediate(r));

    expect(startSpy).not.toHaveBeenCalled();
    expect(logTexts(sent).join('\n')).toMatch(/malformed run-policy/i);
  });

  it('stop handler forwards the jobId to runner.stop', async () => {
    const { bus } = makeBus();
    const { runner, stop } = createRunPolicyHandlers(bus, () => 'dev-1', { simMode: true });
    const stopSpy = vi.spyOn(runner, 'stop');

    await stop(makeMsg('stop-policy:job-xyz'));
    expect(stopSpy).toHaveBeenCalledWith('job-xyz');
  });
});
