import pino from 'pino';
import { config } from './lib/config.js';

// Create Pino logger with pretty formatting in development
const loggerOptions: any = {
  level: config.NODE_ENV === 'development' ? 'debug' : 'info',
  base: {
    env: config.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

// Add transport only in development
if (config.NODE_ENV === 'development') {
  loggerOptions.transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    }
  };
}

export const log = pino(loggerOptions);

// Export child loggers for different components
export const createLogger = (component: string) => log.child({ component });

// Common loggers
export const battleLogger = createLogger('battle-crawler');
export const killsLogger = createLogger('kills-fetcher');
export const queueLogger = createLogger('queue');
export const httpLogger = createLogger('http-client');
export const metricsLogger = createLogger('metrics');
