/**
 * Selects a GPIODriver implementation based on the OROBOT_PLATFORM env var.
 *
 * Why a registry? Sub-PRs in #250 add Jetson and (eventually) other Linux
 * platforms. Each will register here so distributions can pick a driver at
 * boot via `OROBOT_PLATFORM=<name>` without callers needing to import the
 * platform-specific class.
 *
 * Recognised platforms:
 *   - `pi`     → RPiGPIODriver (default; matches today's behavior)
 *   - `mock`   → MockGPIODriver (used by tests and the simulator)
 *
 * An unknown value throws at startup so a typo doesn't silently fall back to
 * Pi pins on the wrong board.
 */
import type { GPIODriver } from './types';
import { RPiGPIODriver } from './gpio-driver';
import { MockGPIODriver } from './mock-driver';

export type Platform = 'pi' | 'mock';

export type DriverFactory = () => GPIODriver;

const builtins: Record<Platform, DriverFactory> = {
  pi:   () => new RPiGPIODriver(),
  mock: () => new MockGPIODriver(),
};

export function selectDriver(env: NodeJS.ProcessEnv = process.env): GPIODriver {
  const raw = (env['OROBOT_PLATFORM'] ?? 'pi').trim().toLowerCase();
  const factory = (builtins as Record<string, DriverFactory | undefined>)[raw];
  if (!factory) {
    const known = Object.keys(builtins).join(', ');
    throw new Error(`Unknown OROBOT_PLATFORM "${raw}". Expected one of: ${known}`);
  }
  return factory();
}
