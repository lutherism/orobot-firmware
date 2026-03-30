import { describe, it, expect } from 'vitest';
import { createLogger } from './logger';

describe('createLogger', () => {
  it('returns a child logger with component binding', () => {
    const log = createLogger('test-component');
    expect(log.bindings()).toMatchObject({ component: 'test-component' });
  });

  it('info/warn/error methods do not throw', () => {
    const log = createLogger('test');
    expect(() => log.info('msg')).not.toThrow();
    expect(() => log.warn({ key: 1 }, 'msg')).not.toThrow();
    expect(() => log.error('err')).not.toThrow();
  });
});
