/**
 * Tests for the headless Cloud Run simulator entry point.
 *
 * These tests exercise the thin wrapper layer only — env-var validation and
 * data-file setup. They do NOT spin up a real gateway connection (that is an
 * integration concern for Phase 3).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import path from 'path';

// Path to the headless entry — run via tsx so TypeScript is transpiled on-the-fly.
const HEADLESS_ENTRY = path.resolve(__dirname, './headless.ts');

// tsx invocation compatible with Node v20+ (uses --import instead of --loader)
const TSX_ARGS = ['--import', 'tsx', HEADLESS_ENTRY];

// Spawn headless.ts as a subprocess with tsx and collect its output.
function runHeadless(env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(
      'node',
      TSX_ARGS,
      {
        env: { ...process.env, ...env },
        timeout: 5000,
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', () => resolve({ code: null, stdout, stderr }));
  });
}

// Spawn headless.ts and send SIGTERM after `ms` milliseconds, then collect output.
function runHeadlessWithSigterm(env: Record<string, string>, sigTermAfterMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(
      'node',
      TSX_ARGS,
      {
        env: { ...process.env, ...env },
        timeout: 10000,
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', () => resolve({ code: null, stdout, stderr }));

    setTimeout(() => {
      child.kill('SIGTERM');
    }, sigTermAfterMs);
  });
}

describe('headless simulator — env validation', () => {
  it('exits with code 1 and a clear error when GATEWAY_WS_URL is missing', async () => {
    const result = await runHeadless({ DEVICE_UUID: 'test-uuid-1234' });
    expect(result.code).toBe(1);
    // Error message must be on stderr or stdout (written before pino initialises)
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/GATEWAY_WS_URL/);
    expect(combined).toMatch(/required/i);
  }, 8000);

  it('exits with code 1 and a clear error when DEVICE_UUID is missing', async () => {
    const result = await runHeadless({ GATEWAY_WS_URL: 'ws://localhost:9999/device' });
    expect(result.code).toBe(1);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/DEVICE_UUID/);
    expect(combined).toMatch(/required/i);
  }, 8000);

  it('exits with code 1 when both required env vars are missing', async () => {
    const result = await runHeadless({});
    expect(result.code).toBe(1);
  }, 8000);
});

describe('headless simulator — startup and shutdown', () => {
  it('starts without crashing and handles SIGTERM cleanly', async () => {
    // Point at an unreachable WS — the firmware will attempt to connect and
    // back-off, which is fine. We just want to verify it starts and exits 0
    // on SIGTERM before the first reconnect attempt.
    const result = await runHeadlessWithSigterm(
      {
        GATEWAY_WS_URL:    'ws://127.0.0.1:19999/device',
        DEVICE_UUID:       'headless-test-uuid-0001',
        HEARTBEAT_MS:      '999999',
        SCAN_INTERVAL_MS:  '999999',
      },
      // Give it 1500ms to initialise then send SIGTERM
      1500,
    );

    // Must exit 0 — clean shutdown
    expect(result.code).toBe(0);

    // Log output must include startup message
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/Headless simulator starting/i);
  }, 12000);
});
