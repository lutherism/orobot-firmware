import { describe, it, expect } from 'vitest';
import { formatSize } from './flashUtils';

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
