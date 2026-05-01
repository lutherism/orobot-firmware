/**
 * Installer utilities — pure functions and the install state machine.
 *
 * The transport-specific logic (esptool-js for ESP32, dd/etcher for SD cards)
 * lives in `./transports/`. This file owns the lifecycle abstraction every
 * transport conforms to.
 */

import type {
  Distribution,
  InstallPhase,
  InstallState,
} from './transports/types';

export type {
  TransportKind,
  Distribution,
  BinaryRef,
  DeviceMetadata,
  InstallPhase,
  InstallError,
  InstallState,
  InstallCallbacks,
  Transport,
  ErrorCatalogEntry,
} from './transports/types';
export { ERR_INSTALL_CANCELLED } from './transports/types';

// ─── Drive metadata (block-device transport, declared but unimplemented) ──────

export type DriveCondition = 'ready' | 'not-ready' | 'not-found';

export interface Drive {
  letter: string;
  name: string;
  size: number;
  free: number;
  condition?: DriveCondition;
  conditionMessage?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format bytes for UI display. */
export function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/** Initial state for a fresh install attempt. */
export function idleState(): InstallState {
  return { phase: 'idle', progress: 0, log: [] };
}

// ─── State machine ────────────────────────────────────────────────────────────
//
// The transition table for the install lifecycle. Transports drive transitions
// via `InstallCallbacks`; this table documents what's legal so the UI can
// reject programming errors instead of corrupting state silently.

const TRANSITIONS: Record<InstallPhase, InstallPhase[]> = {
  idle:       ['finding'],
  finding:    ['found', 'error', 'cancelled', 'idle'],
  found:      ['installing', 'finding', 'error', 'cancelled', 'idle'],
  installing: ['verifying', 'success', 'error', 'cancelled'],
  verifying:  ['success', 'error', 'cancelled'],
  success:    ['idle'],
  error:      ['idle', 'finding'],
  cancelled:  ['idle', 'finding'],
};

export function canTransition(from: InstallPhase, to: InstallPhase): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Apply a phase transition. Throws if the transition is illegal — the install
 * UI catches and surfaces this as a developer-facing log entry rather than
 * corrupting state.
 */
export function transition(state: InstallState, to: InstallPhase, subPhase?: string): InstallState {
  if (!canTransition(state.phase, to)) {
    throw new Error(`illegal install transition: ${state.phase} → ${to}`);
  }
  const next: InstallState = { ...state, phase: to };
  if (subPhase !== undefined) next.subPhase = subPhase;
  // Reset progress at meaningful boundaries.
  if (to === 'idle' || to === 'finding' || to === 'installing') next.progress = 0;
  // Transient fields cleared when leaving terminal states.
  if (to === 'idle') {
    next.error = undefined;
    next.device = undefined;
    next.log = [];
    next.subPhase = undefined;
  }
  return next;
}

// ─── Distribution config validation ───────────────────────────────────────────

export function validateDistribution(d: Distribution): string[] {
  const errors: string[] = [];
  if (!d.id) errors.push('missing id');
  if (!d.targetKind) errors.push('missing targetKind');
  if (d.targetKind === 'serial-port') {
    if (!d.binaries || Object.keys(d.binaries).length === 0) {
      errors.push('serial-port distribution must declare binaries');
    } else {
      for (const [key, ref] of Object.entries(d.binaries)) {
        if (!ref.url) errors.push(`binary ${key}: missing url`);
        if (typeof ref.flashAddress !== 'number' || ref.flashAddress < 0) {
          errors.push(`binary ${key}: invalid flashAddress`);
        }
      }
    }
  }
  if (d.targetKind === 'block-device') {
    if (d.imageUrl === undefined) errors.push('block-device distribution missing imageUrl');
  }
  return errors;
}
