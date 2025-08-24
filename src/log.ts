import pino from 'pino';
import { config } from './lib/config.js';

// Create Pino logger with pretty formatting in development
export const log = pino({
  level: config.NODE_ENV === 'development' ? 'debug' : 'info',
  transport: config.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    }
  } : undefined,
  base: {
    env: config.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Export child loggers for different components
export const createLogger = (component: string) => log.child({ component });

// Common loggers
export const battleLogger = createLogger('battle-crawler');
export const killsLogger = createLogger('kills-fetcher');
export const queueLogger = createLogger('queue');
export const httpLogger = createLogger('http-client');
export const metricsLogger = createLogger('metrics');
