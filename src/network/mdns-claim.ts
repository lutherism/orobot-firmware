import { spawn, type ChildProcess } from 'child_process';
import type { DeviceStateService } from '../core/device-state';
import type { EventBus } from '../core/event-bus';
import { createLogger } from '../core/logger';

/**
 * MdnsClaimService — broadcasts a _orobot._tcp mDNS advertisement so the
 * orobot.io web UI (and the firstrun.sh claim flow) can discover this device
 * on the local network without SSH or HDMI access.
 *
 * The advertisement is implemented via `avahi-publish` (part of avahi-utils,
 * pre-installed on Raspberry Pi OS).  If `avahi-publish` is absent the service
 * degrades silently — mDNS is best-effort; the WS gateway path is authoritative.
 *
 * TXT record fields:
 *   uuid=<deviceUuid>      — stable device identifier
 *   claimCode=<code>       — 6-digit pending claim code (absent when claimed)
 *   setup=1                — present while pendingClaimCode is set
 *
 * Lifecycle:
 *   start()  — begin watching events; publishes immediately if a pendingClaimCode
 *              already exists in state (e.g. restart mid-claim flow).
 *   stop()   — withdraw the mDNS advertisement and release all listeners.
 *
 * The advertisement is automatically withdrawn when `pendingClaimCode` is
 * cleared (i.e. when the device is successfully claimed).
 */

export type SpawnFn = typeof spawn;

export class MdnsClaimService {
  private proc: ChildProcess | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly log: ReturnType<typeof createLogger>;

  constructor(
    private readonly state: DeviceStateService,
    private readonly bus: EventBus,
    device?: string,
    private readonly spawnFn: SpawnFn = spawn,
  ) {
    this.log = createLogger('mdns-claim', device);
  }

  start(): void {
    // Publish immediately if a pending claim code already exists (e.g. after a
    // restart in the middle of the first-boot claim flow).
    const { pendingClaimCode } = this.state.get();
    if (pendingClaimCode) {
      this.publish(pendingClaimCode);
    }

    this.unsubscribers.push(
      // New claim code stored (AP portal submission).
      this.bus.on('portal:claim-code-stored', ({ code }) => {
        this.publish(code);
      }),
      // Claim code redeemed successfully — main.ts patches pendingClaimCode to
      // null and the `portal:claim-code-cleared` event is emitted.
      this.bus.on('portal:claim-code-cleared', () => {
        this.withdraw();
      }),
    );
  }

  stop(): void {
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers.length = 0;
    this.withdraw();
  }

  /**
   * Spawn (or replace) an avahi-publish process advertising _orobot._tcp with
   * the current device UUID and claim code in the TXT record.
   */
  private publish(claimCode: string): void {
    this.withdraw(); // kill any running process first

    const { deviceUuid } = this.state.get();
    if (!deviceUuid) return;

    // Service name is the first 8 chars of the UUID to keep it discoverable
    // but short enough for mdns/dns-sd name limits (max 63 chars).
    const serviceName = `orobot-${deviceUuid.slice(0, 8)}`;
    const args = [
      '-s', serviceName,
      '_orobot._tcp',
      '3006',
      `uuid=${deviceUuid}`,
      `claimCode=${claimCode}`,
      'setup=1',
    ];

    try {
      const proc = this.spawnFn('avahi-publish', args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          this.log.debug({ event: 'mdns:unavailable' }, 'avahi-publish not found — mDNS disabled');
        } else {
          this.log.warn({ event: 'mdns:error', err: err.message }, 'avahi-publish error');
        }
        if (this.proc === proc) this.proc = null;
      });

      proc.on('exit', (code, signal) => {
        this.log.debug({ event: 'mdns:exit', code, signal }, 'avahi-publish exited');
        if (this.proc === proc) this.proc = null;
      });

      this.proc = proc;
      this.log.info(
        { event: 'mdns:published', serviceName, claimCode },
        'mDNS _orobot._tcp advertisement started',
      );
    } catch (err) {
      // spawn itself can throw synchronously on some platforms.
      this.log.debug({ event: 'mdns:spawn-failed', err: String(err) }, 'Could not spawn avahi-publish');
    }
  }

  /** Kill the avahi-publish process if it is running. */
  private withdraw(): void {
    if (!this.proc) return;
    try {
      this.proc.kill('SIGTERM');
    } catch {
      // process may already be gone
    }
    this.proc = null;
    this.log.info({ event: 'mdns:withdrawn' }, 'mDNS advertisement withdrawn');
  }
}
