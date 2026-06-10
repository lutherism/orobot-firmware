/**
 * LeRobot policy-inference launcher handler.
 *
 * Triggered by `command-in` messages whose `data` string is prefixed with
 * `run-policy:` or `stop-policy:`. The gateway (orobotio PR #3363, issue
 * #3260) dispatches these via PubSub `device-${uuid}-in`:
 *
 *   Inbound  `command-in`  data: `run-policy:{"modelRepo","policyType","cameras","jobId"}`
 *   Inbound  `command-in`  data: `stop-policy:<jobId>`
 *
 * On `run-policy:` the firmware:
 *   1. Parses the JSON payload `{ modelRepo, policyType, cameras, jobId }`.
 *   2. `huggingface-cli download <modelRepo>` (best-effort; skipped in sim).
 *   3. Launches the LeRobot inference loop, e.g.
 *        python -m lerobot.scripts.control_robot \
 *          --policy.type <policyType> --robot.type so101 ...
 *   4. Streams every stdout/stderr line back as a `device-log` WS message,
 *      which flows `device → PubSub device-${uuid}-out → /control` and lands
 *      in the browser terminal automatically.
 *   5. Emits a `policy-status` WS message on each lifecycle transition
 *      (`running` / `done` / `error` / `cancelled`) carrying
 *      `{ jobId, status, error? }`. The gateway can relay this to the
 *      Firestore `PolicyInferenceJobs/<jobId>` doc (deferred — there is no
 *      device→Firestore write endpoint yet; tracked alongside #3302).
 *
 * INVARIANTS
 * ==========
 * - Never blocks the WS event loop / heartbeat: the subprocess is spawned and
 *   supervised asynchronously, and the handler returns immediately. The
 *   registry acks the `command-in` (`message-ack`) the moment the handler
 *   returns, so a long inference run never starves the heartbeat.
 * - Motor / GPIO discipline is owned by the LeRobot process itself (it drives
 *   the Feetech bus directly over USB); the firmware does NOT issue overlapping
 *   GPIO signals while a policy is running — there is no FIFO contention from
 *   this handler.
 * - `NODE_ENV=sim` (or a missing python/huggingface-cli) bypasses any real
 *   subprocess: the runner reports `unavailable` over `device-log` and emits a
 *   `policy-status` error so the UI doesn't hang.
 */

import { spawn, type ChildProcess } from 'child_process';
import type { EventBus } from '../core/event-bus';
import type { MessageHandler } from './registry';
import { makeEnvelope } from '../core/wire';
import { createLogger } from '../core/logger';

const log = createLogger('run-policy');

export const RUN_POLICY_PREFIX  = 'run-policy:';
export const STOP_POLICY_PREFIX = 'stop-policy:';

/** Decoded `run-policy:` payload (matches the gateway's JSON.stringify). */
export interface RunPolicyPayload {
  modelRepo:  string;
  policyType: string;
  cameras?:   string[];
  jobId:      string;
}

export type PolicyStatus = 'running' | 'done' | 'error' | 'cancelled';

/**
 * Dependency-injected spawner so tests can run without python/huggingface.
 * Mirrors the `FfmpegSpawner` pattern in camera-stream.ts.
 */
export type PolicySpawner = (command: string, args: string[]) => ChildProcess;

export function defaultPolicySpawner(command: string, args: string[]): ChildProcess {
  return spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

export interface PolicyRunnerOptions {
  /** Override the subprocess spawner (tests inject a mock). */
  spawner?: PolicySpawner;
  /** Force "unavailable" behaviour regardless of env (tests). */
  simMode?: boolean;
}

/**
 * Supervises LeRobot policy-inference subprocesses keyed by jobId.
 *
 * One PolicyRunner is shared across the run-policy / stop-policy handlers so
 * `stop-policy:<jobId>` can find and kill the process started by an earlier
 * `run-policy:`.
 */
export class PolicyRunner {
  private readonly procs = new Map<string, ChildProcess>();
  private readonly spawner: PolicySpawner;
  private readonly simMode: boolean;

  constructor(
    private readonly bus: EventBus,
    private readonly getDeviceUuid: () => string,
    options: PolicyRunnerOptions = {},
  ) {
    this.spawner = options.spawner ?? defaultPolicySpawner;
    this.simMode = options.simMode ?? process.env['NODE_ENV'] === 'sim';
  }

  /** jobIds currently running (for tests / introspection). */
  get runningJobs(): string[] {
    return [...this.procs.keys()];
  }

  /**
   * Build the LeRobot control_robot argv. Kept small + pure so it can be
   * unit-tested without spawning anything.
   */
  static buildInferenceArgs(payload: RunPolicyPayload): string[] {
    const args = [
      '-m', 'lerobot.scripts.control_robot',
      '--robot.type', 'so101',
      '--control.type', 'policy',
      '--control.policy.type', payload.policyType,
      `--control.policy.pretrained=${payload.modelRepo}`,
    ];
    for (const cam of payload.cameras ?? []) {
      args.push('--robot.cameras', cam);
    }
    return args;
  }

  /**
   * Start a policy run. Idempotent per jobId — a second start for an
   * already-running jobId is ignored (re-delivery safe).
   */
  start(payload: RunPolicyPayload): void {
    const { jobId } = payload;
    if (this.procs.has(jobId)) {
      log.info({ jobId }, 'run-policy: job already running — ignoring re-delivery');
      return;
    }

    this.emitLog(`Starting policy run ${jobId}: ${payload.modelRepo} (${payload.policyType})`);
    this.emitStatus(jobId, 'running');

    // In sim mode (or no inference runtime) we cannot launch a real process.
    if (this.simMode) {
      this.emitLog(
        'Policy inference runtime unavailable on this device (sim mode). ' +
        'Requires a Raspberry Pi 5 with lerobot >= 0.4.0 and huggingface_hub[cli].',
        'warn',
      );
      this.emitStatus(jobId, 'error', 'Inference runtime unavailable (sim mode).');
      return;
    }

    // Download the model first, then launch inference. Both stream output to
    // the browser terminal. Chained so the inference loop sees the cached model.
    this.spawnStep(
      jobId,
      'huggingface-cli',
      ['download', payload.modelRepo],
      `Downloading model ${payload.modelRepo}…`,
      () => this.launchInference(payload),
    );
  }

  /** Launch the LeRobot inference loop and supervise it to completion. */
  private launchInference(payload: RunPolicyPayload): void {
    const { jobId } = payload;
    const args = PolicyRunner.buildInferenceArgs(payload);
    this.emitLog(`Launching LeRobot inference: python3 ${args.join(' ')}`);

    let proc: ChildProcess;
    try {
      proc = this.spawner('python3', args);
    } catch (err) {
      this.emitStatus(jobId, 'error', errMsg(err));
      this.emitLog(`Failed to launch inference: ${errMsg(err)}`, 'error');
      return;
    }

    this.procs.set(jobId, proc);
    this.pipeOutput(proc);

    proc.on('error', (err) => {
      this.procs.delete(jobId);
      this.emitStatus(jobId, 'error', errMsg(err));
      this.emitLog(`Inference process error: ${errMsg(err)}`, 'error');
    });

    proc.on('close', (code, signal) => {
      const wasTracked = this.procs.delete(jobId);
      // If we already removed it via stop(), report cancelled, not error.
      if (!wasTracked) return;
      if (signal) {
        this.emitStatus(jobId, 'cancelled');
        this.emitLog(`Policy run ${jobId} stopped (${signal}).`);
      } else if (code === 0) {
        this.emitStatus(jobId, 'done');
        this.emitLog(`Policy run ${jobId} completed.`);
      } else {
        this.emitStatus(jobId, 'error', `Inference exited with code ${code}`);
        this.emitLog(`Policy run ${jobId} failed (exit ${code}).`, 'error');
      }
    });
  }

  /**
   * Spawn a single preparatory step (e.g. the model download). Streams its
   * output, and on success runs `onDone`. On failure emits a `policy-status`
   * error and does NOT continue the chain.
   */
  private spawnStep(
    jobId: string,
    command: string,
    args: string[],
    startMsg: string,
    onDone: () => void,
  ): void {
    this.emitLog(startMsg);
    let proc: ChildProcess;
    try {
      proc = this.spawner(command, args);
    } catch (err) {
      this.emitStatus(jobId, 'error', errMsg(err));
      this.emitLog(`Failed to start ${command}: ${errMsg(err)}`, 'error');
      return;
    }

    // Track the prep process under the jobId too, so stop-policy can kill a
    // long-running download mid-flight.
    this.procs.set(jobId, proc);
    this.pipeOutput(proc);

    proc.on('error', (err) => {
      this.procs.delete(jobId);
      this.emitStatus(jobId, 'error', errMsg(err));
      this.emitLog(`${command} error: ${errMsg(err)}`, 'error');
    });

    proc.on('close', (code, signal) => {
      const wasTracked = this.procs.delete(jobId);
      if (!wasTracked) return; // stopped during prep
      if (signal) {
        this.emitStatus(jobId, 'cancelled');
        this.emitLog(`Policy run ${jobId} stopped during ${command}.`);
        return;
      }
      if (code !== 0) {
        this.emitStatus(jobId, 'error', `${command} exited with code ${code}`);
        this.emitLog(`${command} failed (exit ${code}).`, 'error');
        return;
      }
      onDone();
    });
  }

  /** Stream a child's stdout/stderr line-by-line to the browser terminal. */
  private pipeOutput(proc: ChildProcess): void {
    const forward = (chunk: Buffer, level: 'log' | 'error') => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        if (line.trim().length > 0) this.emitLog(line, level);
      }
    };
    proc.stdout?.on('data', (chunk: Buffer) => forward(chunk, 'log'));
    proc.stderr?.on('data', (chunk: Buffer) => forward(chunk, 'error'));
  }

  /** Stop a running policy run by jobId. No-op if unknown (idempotent). */
  stop(jobId: string): void {
    const proc = this.procs.get(jobId);
    if (!proc) {
      this.emitLog(`No running policy for job ${jobId} to stop.`, 'warn');
      // Still surface a cancelled status so the UI can settle.
      this.emitStatus(jobId, 'cancelled');
      return;
    }
    // Delete before killing so the close handler treats it as a clean cancel
    // (wasTracked === false → no duplicate status emission).
    this.procs.delete(jobId);
    this.emitLog(`Stopping policy run ${jobId}…`);
    this.emitStatus(jobId, 'cancelled');
    proc.kill('SIGTERM');
  }

  // ── wire helpers ──────────────────────────────────────────────────────────

  private emitLog(text: string, level: 'log' | 'warn' | 'error' = 'log'): void {
    this.bus.emit('network:send', {
      payload: makeEnvelope('device-log', {
        level,
        text,
        deviceUuid: this.getDeviceUuid(),
      }),
    });
  }

  private emitStatus(jobId: string, status: PolicyStatus, error?: string): void {
    this.bus.emit('network:send', {
      payload: makeEnvelope('policy-status', {
        deviceUuid: this.getDeviceUuid(),
        data: error ? { jobId, status, error } : { jobId, status },
      }),
    });
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Parse a `run-policy:<json>` data string. Returns null on malformed input.
 */
export function parseRunPolicyData(data: string): RunPolicyPayload | null {
  const raw = data.slice(RUN_POLICY_PREFIX.length);
  try {
    const obj = JSON.parse(raw);
    if (typeof obj?.modelRepo !== 'string' || obj.modelRepo.length === 0) return null;
    if (typeof obj?.jobId !== 'string' || obj.jobId.length === 0) return null;
    return {
      modelRepo:  obj.modelRepo,
      policyType: typeof obj.policyType === 'string' && obj.policyType ? obj.policyType : 'act',
      cameras:    Array.isArray(obj.cameras) ? obj.cameras.filter((c: unknown) => typeof c === 'string') : [],
      jobId:      obj.jobId,
    };
  } catch {
    return null;
  }
}

/**
 * Create the `run-policy:` / `stop-policy:` prefix handlers sharing one
 * PolicyRunner. Register both on the registry as prefix handlers:
 *
 *   registry.register('run-policy:',  true, handlers.run);
 *   registry.register('stop-policy:', true, handlers.stop);
 */
export function createRunPolicyHandlers(
  bus: EventBus,
  getDeviceUuid: () => string,
  options: PolicyRunnerOptions = {},
): { runner: PolicyRunner; run: MessageHandler; stop: MessageHandler } {
  const runner = new PolicyRunner(bus, getDeviceUuid, options);

  const run: MessageHandler = (msg) => {
    const payload = parseRunPolicyData(msg.data);
    if (!payload) {
      log.warn({ data: msg.data?.slice(0, 80) }, 'run-policy: malformed payload');
      bus.emit('network:send', {
        payload: makeEnvelope('device-log', {
          level:      'error',
          text:       'Received a malformed run-policy command — ignoring.',
          deviceUuid: getDeviceUuid(),
        }),
      });
      return Promise.resolve();
    }
    // Detach so the WS loop / heartbeat is never blocked by the inference run.
    setImmediate(() => runner.start(payload));
    return Promise.resolve();
  };

  const stop: MessageHandler = (msg) => {
    const jobId = msg.data.slice(STOP_POLICY_PREFIX.length).trim();
    if (jobId) runner.stop(jobId);
    return Promise.resolve();
  };

  return { runner, run, stop };
}
