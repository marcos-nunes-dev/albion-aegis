import { log } from '../src/log.js';
import redis from '../src/queue/connection.js';
import { cleanupOldJobs, aggressiveCleanup, getQueueStats } from '../src/queue/queues.js';

const logger = log.child({ component: 'redis-monitor' });

async function monitorRedis() {
  try {
    logger.info('🔍 Starting Redis monitoring...');

    // Test Redis connection
    await redis.ping();
    logger.info('✅ Redis connection successful');

    // Get queue statistics
    const stats = await getQueueStats();
    
    logger.info({
      message: 'Queue statistics',
      battleCrawl: stats.battleCrawl,
      killsFetch: stats.killsFetch
    });

    // Check for potential issues
    const totalJobs = Object.values(stats.battleCrawl).reduce((a, b) => a + b, 0) +
                     Object.values(stats.killsFetch).reduce((a, b) => a + b, 0);

    if (totalJobs > 1000) {
      logger.warn({
        message: 'High number of jobs detected',
        totalJobs,
        recommendation: 'Consider running cleanup'
      });
    }

    // Check for stuck jobs
    if (stats.killsFetch.active > 10) {
      logger.warn({
        message: 'High number of active jobs',
        activeJobs: stats.killsFetch.active,
        recommendation: 'Check if workers are running properly'
      });
    }

    if (stats.killsFetch.failed > 50) {
      logger.warn({
        message: 'High number of failed jobs',
        failedJobs: stats.killsFetch.failed,
        recommendation: 'Check error logs and consider cleanup'
      });
    }

    // Get total Redis keys
    const keys = await redis.keys('*');
    const bullKeys = keys.filter(key => key.startsWith('bull:'));
    
    logger.info({
      message: 'Redis key statistics',
      totalKeys: keys.length,
      bullKeys: bullKeys.length,
      otherKeys: keys.length - bullKeys.length
    });

    if (bullKeys.length > 500) {
      logger.warn({
        message: 'High number of BullMQ keys',
        bullKeys: bullKeys.length,
        recommendation: 'Run cleanup to remove old jobs'
      });
    }

    logger.info('✅ Redis monitoring completed');

  } catch (error) {
    logger.error({
      message: 'Error during Redis monitoring',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await redis.quit();
  }
}

async function cleanupRedis() {
  try {
    logger.info('🧹 Starting Redis cleanup...');

    // Test Redis connection
    await redis.ping();
    logger.info('✅ Redis connection successful');

    // Get statistics before cleanup
    const statsBefore = await getQueueStats();
    logger.info({
      message: 'Queue statistics before cleanup',
      battleCrawl: statsBefore.battleCrawl,
      killsFetch: statsBefore.killsFetch
    });

    // Run cleanup
    await cleanupOldJobs();

    // Get statistics after cleanup
    const statsAfter = await getQueueStats();
    logger.info({
      message: 'Queue statistics after cleanup',
      battleCrawl: statsAfter.battleCrawl,
      killsFetch: statsAfter.killsFetch
    });

    // Get total Redis keys
    const keys = await redis.keys('*');
    const bullKeys = keys.filter(key => key.startsWith('bull:'));
    
    logger.info({
      message: 'Redis cleanup completed',
      totalKeys: keys.length,
      bullKeys: bullKeys.length
    });

  } catch (error) {
    logger.error({
      message: 'Error during Redis cleanup',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await redis.quit();
  }
}

async function aggressiveCleanupRedis() {
  try {
    logger.info('🧹 Starting aggressive Redis cleanup...');

    // Test Redis connection
    await redis.ping();
    logger.info('✅ Redis connection successful');

    // Get statistics before cleanup
    const statsBefore = await getQueueStats();
    logger.info({
      message: 'Queue statistics before aggressive cleanup',
      battleCrawl: statsBefore.battleCrawl,
      killsFetch: statsBefore.killsFetch
    });

    // Run aggressive cleanup
    await aggressiveCleanup();

    // Get statistics after cleanup
    const statsAfter = await getQueueStats();
    logger.info({
      message: 'Queue statistics after aggressive cleanup',
      battleCrawl: statsAfter.battleCrawl,
      killsFetch: statsAfter.killsFetch
    });

    // Get total Redis keys
    const keys = await redis.keys('*');
    const bullKeys = keys.filter(key => key.startsWith('bull:'));
    
    logger.info({
      message: 'Aggressive Redis cleanup completed',
      totalKeys: keys.length,
      bullKeys: bullKeys.length
    });

  } catch (error) {
    logger.error({
      message: 'Error during aggressive Redis cleanup',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await redis.quit();
  }
}

// Parse command line arguments
const command = process.argv[2];

switch (command) {
  case 'monitor':
    monitorRedis();
    break;
  case 'cleanup':
    cleanupRedis();
    break;
  case 'aggressive':
    aggressiveCleanupRedis();
    break;
  default:
    console.log('Usage:');
    console.log('  yarn tsx apps/redis-monitor.ts monitor     - Monitor Redis health');
    console.log('  yarn tsx apps/redis-monitor.ts cleanup     - Clean up old jobs (30 min)');
    console.log('  yarn tsx apps/redis-monitor.ts aggressive  - Aggressive cleanup (10 min)');
    break;
}
