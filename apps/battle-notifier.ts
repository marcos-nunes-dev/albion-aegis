import { Worker } from 'bullmq';
import { log } from '../src/log.js';
import { BattleNotifierWorker, BattleNotificationJob } from '../src/workers/battleNotifier/worker.js';
import redis from '../src/queue/connection.js';
import { config } from '../src/lib/config.js';
import { getPrisma, getHealthStatus } from '../src/db/database.js';

const logger = log.child({ component: 'battle-notifier-app' });

// Log database health status
const healthStatus = getHealthStatus();
logger.info('🗄️ Database Health Status:', {
  isConnected: healthStatus.isConnected,
  connectionErrors: healthStatus.connectionErrors,
  lastHealthCheck: healthStatus.lastHealthCheck,
  poolConfig: healthStatus.poolConfig,
});

// Initialize tracking worker with enhanced database connection
const prisma = getPrisma();
const trackingWorker = new BattleNotifierWorker(prisma);

// Create BullMQ worker
const worker = new Worker<BattleNotificationJob>(
  'battle-notifications',
  async (job) => {
    logger.info({
      message: 'Processing battle notification job',
      jobId: job.id,
      battleId: job.data.battleId.toString()
    });

    await trackingWorker.processJob(job);
  },
  {
    connection: redis,
    concurrency: config.BATTLE_NOTIFIER_CONCURRENCY || 2,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 }
  }
);

// Worker event handlers
worker.on('completed', (job) => {
  logger.info({
    message: 'Battle notification job completed',
    jobId: job.id,
    battleId: job.data.battleId.toString()
  });
});

worker.on('failed', (job, err) => {
  logger.error({
    message: 'Battle notification job failed',
    jobId: job?.id,
    battleId: job?.data.battleId.toString(),
    error: err.message,
    stack: err.stack
  });
});

worker.on('error', (err) => {
  logger.error({
    message: 'Battle notification worker error',
    error: err.message,
    stack: err.stack
  });
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({
    message: `Received ${signal}, shutting down gracefully`,
    signal
  });

  try {
    // Close worker
    await worker.close();
    logger.info({ message: 'Battle notification worker closed' });

    // Close Prisma connection
    const prisma = getPrisma();
    await prisma.$disconnect();
    logger.info({ message: 'Prisma connection closed' });

    process.exit(0);
  } catch (error) {
    logger.error({
      message: 'Error during shutdown',
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error({
    message: 'Uncaught exception',
    error: error.message,
    stack: error.stack
  });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({
    message: 'Unhandled rejection',
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: promise.toString()
  });
  shutdown('unhandledRejection');
});

// Start the worker
logger.info({
  message: 'Battle notification worker started',
  concurrency: config.BATTLE_NOTIFIER_CONCURRENCY || 2,
  databasePool: `${config.DATABASE_POOL_MIN}-${config.DATABASE_POOL_MAX} connections`
});
