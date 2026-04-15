import { describe, it, expect } from 'vitest';
import { selectDriver } from './driver-registry';
import { RPiGPIODriver } from './gpio-driver';
import { MockGPIODriver } from './mock-driver';

describe('selectDriver', () => {
  it('returns RPiGPIODriver by default when OROBOT_PLATFORM is unset', () => {
    expect(selectDriver({})).toBeInstanceOf(RPiGPIODriver);
  });

  it('returns RPiGPIODriver for OROBOT_PLATFORM=pi', () => {
    expect(selectDriver({ OROBOT_PLATFORM: 'pi' })).toBeInstanceOf(RPiGPIODriver);
  });

  it('returns MockGPIODriver for OROBOT_PLATFORM=mock', () => {
    expect(selectDriver({ OROBOT_PLATFORM: 'mock' })).toBeInstanceOf(MockGPIODriver);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(selectDriver({ OROBOT_PLATFORM: '  MOCK ' })).toBeInstanceOf(MockGPIODriver);
  });

  it('throws a clear error for an unknown platform', () => {
    expect(() => selectDriver({ OROBOT_PLATFORM: 'nope' })).toThrow(/Unknown OROBOT_PLATFORM "nope"/);
  });

  it('lists known platforms in the error message so a typo is easy to fix', () => {
    expect(() => selectDriver({ OROBOT_PLATFORM: 'jetson' })).toThrow(/pi, mock/);
  });
});
