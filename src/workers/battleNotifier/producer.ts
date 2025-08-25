import { Queue } from 'bullmq';
import { log } from '../../log.js';
import { BattleNotificationJob } from './worker.js';
import redis from '../../queue/connection.js';

const logger = log.child({ component: 'battle-notifier-producer' });

export class BattleNotifierProducer {
  private queue: Queue<BattleNotificationJob>;

  constructor() {
    this.queue = new Queue<BattleNotificationJob>('battle-notifications', {
      connection: redis
    });
  }

  /**
   * Enqueue a battle for notification processing
   */
  async enqueueBattleNotification(battleId: bigint): Promise<void> {
    try {
      const job = await this.queue.add('process-battle-notification', {
        battleId: battleId.toString()
      }, {
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 50,      // Keep last 50 failed jobs
        attempts: 3,           // Retry up to 3 times
        backoff: {
          type: 'exponential',
          delay: 2000 // Start with 2 seconds
        }
      });

      logger.info({
        message: 'Battle notification job enqueued',
        battleId: battleId.toString(),
        jobId: job.id
      });

    } catch (error) {
      logger.error({
        message: 'Failed to enqueue battle notification job',
        error: error instanceof Error ? error.message : String(error),
        battleId: battleId.toString()
      });
      throw error;
    }
  }

  /**
   * Enqueue multiple battles for notification processing
   */
  async enqueueBattleNotifications(battleIds: bigint[]): Promise<void> {
    try {
      const jobs = battleIds.map(battleId => ({
        name: 'process-battle-notification',
        data: { battleId: battleId.toString() },
        opts: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      }));

      const addedJobs = await this.queue.addBulk(jobs);

      logger.info({
        message: 'Multiple battle notification jobs enqueued',
        count: addedJobs.length,
        battleIds: battleIds.map(id => id.toString())
      });

    } catch (error) {
      logger.error({
        message: 'Failed to enqueue multiple battle notification jobs',
        error: error instanceof Error ? error.message : String(error),
        count: battleIds.length
      });
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        this.queue.getWaiting(),
        this.queue.getActive(),
        this.queue.getCompleted(),
        this.queue.getFailed()
      ]);

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length
      };
    } catch (error) {
      logger.error({
        message: 'Failed to get queue statistics',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Close the queue connection
   */
  async close(): Promise<void> {
    try {
      await this.queue.close();
      logger.info({ message: 'Battle notifier producer queue closed' });
    } catch (error) {
      logger.error({
        message: 'Failed to close battle notifier producer queue',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
