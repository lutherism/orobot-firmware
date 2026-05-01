import { describe, it, expect } from 'vitest';
import {
  formatSize,
  idleState,
  canTransition,
  transition,
  validateDistribution,
} from './installerUtils';
import type { Distribution } from './transports/types';

describe('formatSize', () => {
  it('formats bytes to MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1 MB');
    expect(formatSize(512 * 1024)).toBe('1 MB');
  });
  it('formats bytes to GB', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatSize(32 * 1024 * 1024 * 1024)).toBe('32.0 GB');
  });
  it('formats decimal GB', () => {
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });
});

describe('idleState', () => {
  it('returns a fresh idle state', () => {
    const s = idleState();
    expect(s.phase).toBe('idle');
    expect(s.progress).toBe(0);
    expect(s.log).toEqual([]);
    expect(s.error).toBeUndefined();
    expect(s.device).toBeUndefined();
  });
});

describe('canTransition', () => {
  it('allows idle → finding', () => {
    expect(canTransition('idle', 'finding')).toBe(true);
  });
  it('rejects idle → installing', () => {
    expect(canTransition('idle', 'installing')).toBe(false);
  });
  it('rejects success → installing', () => {
    expect(canTransition('success', 'installing')).toBe(false);
  });
  it('allows success → idle (reset)', () => {
    expect(canTransition('success', 'idle')).toBe(true);
  });
  it('allows error → finding (retry)', () => {
    expect(canTransition('error', 'finding')).toBe(true);
  });
  it('allows installing → cancelled', () => {
    expect(canTransition('installing', 'cancelled')).toBe(true);
  });
});

describe('transition', () => {
  it('throws on illegal transition', () => {
    expect(() => transition(idleState(), 'success')).toThrow(/illegal/i);
  });

  it('updates phase and subPhase', () => {
    const s = transition(idleState(), 'finding', 'requesting-port');
    expect(s.phase).toBe('finding');
    expect(s.subPhase).toBe('requesting-port');
  });

  it('resets progress when entering installing', () => {
    const s1 = { ...idleState(), phase: 'found' as const, progress: 0.7 };
    const s2 = transition(s1, 'installing');
    expect(s2.progress).toBe(0);
  });

  it('clears transient fields when returning to idle', () => {
    const s1 = {
      phase: 'error' as const,
      progress: 0.5,
      log: ['boom'],
      error: { code: 'X', message: 'm', guidance: 'g' },
      device: { transportKind: 'serial-port' as const, displayName: 'd' },
    };
    const s2 = transition(s1, 'idle');
    expect(s2.error).toBeUndefined();
    expect(s2.device).toBeUndefined();
    expect(s2.log).toEqual([]);
    expect(s2.subPhase).toBeUndefined();
  });
});

describe('validateDistribution', () => {
  const baseSerial: Distribution = {
    id: 'esp32',
    type: 'esp32',
    label: 'ESP32',
    description: '',
    targetKind: 'serial-port',
    binaries: { app: { url: '/x', flashAddress: 0 } },
    boardIds: ['esp32'],
  };

  it('returns no errors for a valid serial-port distribution', () => {
    expect(validateDistribution(baseSerial)).toEqual([]);
  });

  it('flags missing id', () => {
    expect(validateDistribution({ ...baseSerial, id: '' })).toContain('missing id');
  });

  it('flags serial-port without binaries', () => {
    const d = { ...baseSerial, binaries: undefined };
    expect(validateDistribution(d)).toContain('serial-port distribution must declare binaries');
  });

  it('flags binary missing url', () => {
    const d = { ...baseSerial, binaries: { x: { url: '', flashAddress: 0 } } };
    expect(validateDistribution(d).some(e => e.includes('missing url'))).toBe(true);
  });

  it('flags binary with negative flashAddress', () => {
    const d = { ...baseSerial, binaries: { x: { url: '/x', flashAddress: -1 } } };
    expect(validateDistribution(d).some(e => e.includes('invalid flashAddress'))).toBe(true);
  });

  it('flags block-device missing imageUrl', () => {
    const d: Distribution = {
      id: 'rpi', type: 'rpi', label: 'RPi', description: '',
      targetKind: 'block-device', boardIds: ['rpi'],
    };
    expect(validateDistribution(d)).toContain('block-device distribution missing imageUrl');
  });
});
