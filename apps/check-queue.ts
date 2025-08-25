import { Queue } from 'bullmq';
import { log } from '../src/log.js';
import redis from '../src/queue/connection.js';

const logger = log.child({ component: 'check-queue' });

async function checkQueue() {
  try {
    logger.info('Checking battle notification queue...');

    const queue = new Queue('battle-notifications', {
      connection: redis
    });

    // Get queue info
    const queueInfo = await queue.getJobCounts();
    
    logger.info({
      message: 'Queue status',
      waiting: queueInfo.waiting,
      active: queueInfo.active,
      completed: queueInfo.completed,
      failed: queueInfo.failed,
      delayed: queueInfo.delayed,
      paused: queueInfo.paused
    });

    // Get recent jobs
    const recentJobs = await queue.getJobs(['waiting', 'active', 'completed', 'failed'], 0, 10);
    
    logger.info({
      message: 'Recent jobs',
      count: recentJobs.length,
      jobs: recentJobs.map(job => ({
        id: job.id,
        name: job.name,
        status: job.finishedOn ? 'completed' : job.failedReason ? 'failed' : 'active',
        data: job.data,
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn,
        failedReason: job.failedReason
      }))
    });

    // Check if there are any waiting jobs
    const waitingJobs = await queue.getWaiting();
    
    logger.info({
      message: 'Waiting jobs',
      count: waitingJobs.length,
      jobs: waitingJobs.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        createdAt: job.timestamp
      }))
    });

    // Check if there are any failed jobs
    const failedJobs = await queue.getFailed();
    
    logger.info({
      message: 'Failed jobs',
      count: failedJobs.length,
      jobs: failedJobs.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        failedReason: job.failedReason,
        failedAt: job.finishedOn
      }))
    });

    await queue.close();

  } catch (error) {
    logger.error({
      message: 'Failed to check queue',
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await redis.quit();
  }
}

checkQueue();
