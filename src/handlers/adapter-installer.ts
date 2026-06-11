/**
 * AdapterInstaller — auto-install declared `hardwareAdapters` on program deploy.
 *
 * When a program declares `hardwareAdapters: ['@orobot/adapter-waveshare-servo']`
 * in its config (orobotio#3560 / PR #3608), the firmware should install those
 * npm packages into the program's working directory so `script.js` can
 * `require('@orobot/adapter-waveshare-servo')` without any manual setup.
 *
 * ## Trust model
 *
 * `hardwareAdapters` is user-supplied from the program config. To prevent
 * `npm install <arbitrary-string>` being used as a code-execution vector, we
 * enforce an allowlist:
 *
 *   1. Package name MUST match `/^@orobot\/adapter-[a-z0-9][a-z0-9-]*$/`.
 *      Only lowercase `@orobot/adapter-*` scoped packages are accepted.
 *   2. No version specifiers, git URLs, file: paths, or registries are allowed.
 *      The name is validated BEFORE being passed to execFile — not just sanitised.
 *   3. Unknown / rejected IDs log a warning and are silently skipped; they do
 *      NOT abort the install of valid adapters.
 *
 * This keeps the trust boundary tight while still allowing the community to
 * author `@orobot/adapter-*` packages on npm.
 *
 * ## Fallback
 *
 * If an allowed package is not found on npm (404 / network error), the
 * install fails gracefully — a warning is logged and the firmware continues.
 * The device is functional without the adapter; `script.js` will get a
 * `Cannot find module` error at the point where it calls `require()`.
 *
 * ## Dependency injection
 *
 * The npm runner is injected via `NpmInstaller` to allow mocking in tests
 * (the default uses `child_process.spawn`).
 */

import { spawn } from 'child_process';
import path from 'path';
import { createLogger } from '../core/logger';

const log = createLogger('adapter-installer');

/** Regex allowlist — only @orobot/adapter-<slug> packages, no extras. */
const ADAPTER_ID_RE = /^@orobot\/adapter-[a-z0-9][a-z0-9-]*$/;

export type NpmInstaller = (packageId: string, cwd: string) => Promise<void>;

/**
 * Default npm installer: runs `npm install --prefer-offline <packageId>` in
 * the given working directory and resolves when the process exits 0, or
 * rejects with the exit code otherwise.
 */
export function defaultNpmInstaller(packageId: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install', '--prefer-offline', packageId], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const stderrChunks: Buffer[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').slice(0, 500);
        reject(new Error(`npm install exited ${code}: ${stderr}`));
      }
    });
  });
}

export class AdapterInstaller {
  constructor(
    /** Working directory where adapters are installed (program's data dir). */
    private readonly adapterDir: string,
    private readonly npmInstaller: NpmInstaller = defaultNpmInstaller,
  ) {}

  /**
   * Validate that an adapter ID is on the allowlist.
   * Returns true if the ID is safe to install.
   */
  isAllowed(adapterId: string): boolean {
    return typeof adapterId === 'string' && ADAPTER_ID_RE.test(adapterId);
  }

  /**
   * Install a list of adapter IDs.
   *
   * - Rejects unknown / disallowed IDs with a warning (does NOT throw).
   * - Attempts allowed IDs in sequence; logs a warning on failure and
   *   continues — a missing adapter does not abort the install loop.
   *
   * Returns the list of successfully installed adapter IDs.
   */
  async installAdapters(adapterIds: string[]): Promise<string[]> {
    const installed: string[] = [];

    for (const id of adapterIds) {
      if (!this.isAllowed(id)) {
        log.warn({ adapterId: id }, 'adapter-installer: rejected adapter id (not in allowlist @orobot/adapter-*), skipping');
        continue;
      }

      try {
        await this.npmInstaller(id, this.adapterDir);
        installed.push(id);
        log.info({ adapterId: id, adapterDir: this.adapterDir }, 'adapter-installer: installed');
      } catch (err) {
        // Graceful fallback — log and continue
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ adapterId: id, err: message }, 'adapter-installer: install failed (package may not exist on npm), continuing');
      }
    }

    return installed;
  }

  /**
   * Returns the absolute path that Node's `require()` should use as its
   * additional search root to find adapters installed by this service.
   * Callers (e.g. DeviceSandboxService) should inject this into the vm
   * context's Module paths or `node_modules` lookup chain.
   */
  get nodeModulesPath(): string {
    return path.join(this.adapterDir, 'node_modules');
  }
}
