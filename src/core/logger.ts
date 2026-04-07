import pino from 'pino';

export const rootLogger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      colorizeObjects: false,
      translateTime: 'HH:MM:ss',
    },
  },
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
export const createLogger = (component: string, device?: string) =>
  device
    ? rootLogger.child({ device, component })
    : rootLogger.child({ component });
