import pino from 'pino';

export const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});

/**
 * Create a child logger scoped to a specific subsystem.
 * Every log line from this logger includes `{ component: "<name>" }`.
 *
 * Usage:
 *   const log = createLogger('gateway-client');
 *   log.info({ event: 'ws:connected', url }, 'Gateway connected');
 */
export const createLogger = (component: string) =>
  rootLogger.child({ component });
