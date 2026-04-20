import { describe, it, expect } from 'vitest';

/** Simple test for formatSize logic */
describe('formatSize', () => {
  // Copy of the logic from flashUtils.ts
  const formatSize = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  it('formats bytes to MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1 MB');
    expect(formatSize(512 * 1024)).toBe('512 MB');
  });

  it('formats bytes to GB', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1 GB');
    expect(formatSize(32 * 1024 * 1024 * 1024)).toBe('32 GB');
  });

  it('formats decimal GB', () => {
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });
});