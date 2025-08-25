import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';
import { BattleNotifierWorker, BattleNotificationJob } from '../src/workers/battleNotifier/worker.js';
import redis from '../src/queue/connection.js';
import { config } from '../src/lib/config.js';

const logger = log.child({ component: 'test-notifier-worker' });
const prisma = new PrismaClient();

async function testNotifierWorker() {
  try {
    logger.info('Testing battle notifier worker...');

    // Create the worker
    const trackingWorker = new BattleNotifierWorker(prisma);

    const worker = new Worker<BattleNotificationJob>(
      'battle-notifications',
      async (job) => {
        logger.info({ 
          message: 'Processing battle notification job', 
          jobId: job.id, 
          battleId: job.data.battleId 
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

    // Add event listeners
    worker.on('completed', (job) => {
      logger.info({
        message: 'Job completed',
        jobId: job.id,
        battleId: job.data.battleId
      });
    });

    worker.on('failed', (job, err) => {
      logger.error({
        message: 'Job failed',
        jobId: job?.id,
        battleId: job?.data.battleId,
        error: err.message
      });
    });

    worker.on('error', (err) => {
      logger.error({
        message: 'Worker error',
        error: err.message
      });
    });

    logger.info('Worker started successfully');

    // Keep the worker running for a few seconds to test
    await new Promise(resolve => setTimeout(resolve, 10000));

    logger.info('Shutting down worker...');
    await worker.close();
    await prisma.$disconnect();
    await redis.quit();

  } catch (error) {
    logger.error({
      message: 'Failed to test notifier worker',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

testNotifierWorker();
