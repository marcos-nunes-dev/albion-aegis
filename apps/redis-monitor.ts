import { log } from '../src/log.js';
import redis from '../src/queue/connection.js';
import { cleanupOldJobs, aggressiveCleanup, comprehensiveCleanup, obliterateAllQueues, getQueueStats, comprehensiveCleanupWithOrphanRemoval, nuclearCleanup, ultraAggressiveCleanup } from '../src/queue/queues.js';

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

    // Enhanced analysis for high-volume processing
    const totalJobs = Object.values(stats.battleCrawl).reduce((a, b) => a + b, 0) +
                     Object.values(stats.killsFetch).reduce((a, b) => a + b, 0);

    // Check for potential issues with more detailed thresholds
    if (totalJobs > 500) {
      logger.warn({
        message: 'High number of jobs detected',
        totalJobs,
        recommendation: 'Consider running cleanup'
      });
    }

    if (totalJobs > 1000) {
      logger.error({
        message: 'Very high number of jobs - immediate cleanup needed',
        totalJobs,
        recommendation: 'Run aggressive cleanup immediately'
      });
    }

    // Check for stuck jobs with better thresholds
    if (stats.killsFetch.active > 5) {
      logger.warn({
        message: 'High number of active jobs',
        activeJobs: stats.killsFetch.active,
        recommendation: 'Check if workers are running properly'
      });
    }

    if (stats.killsFetch.active > 10) {
      logger.error({
        message: 'Very high number of active jobs - potential bottleneck',
        activeJobs: stats.killsFetch.active,
        recommendation: 'Check worker concurrency and processing speed'
      });
    }

    if (stats.killsFetch.failed > 20) {
      logger.warn({
        message: 'High number of failed jobs',
        failedJobs: stats.killsFetch.failed,
        recommendation: 'Check error logs and consider cleanup'
      });
    }

    if (stats.killsFetch.failed > 50) {
      logger.error({
        message: 'Very high number of failed jobs - system issues detected',
        failedJobs: stats.killsFetch.failed,
        recommendation: 'Investigate failures and run cleanup'
      });
    }

    // Check for delayed jobs
    if (stats.killsFetch.delayed > 0) {
      logger.warn({
        message: 'Delayed jobs detected',
        delayedJobs: stats.killsFetch.delayed,
        recommendation: 'Check if rate limiting is working properly'
      });
    }

    // Get total Redis keys with more detailed analysis
    const keys = await redis.keys('*');
    const bullKeys = keys.filter(key => key.startsWith('bull:'));
    
    // Analyze BullMQ key patterns
    const keyPatterns = {
      completed: bullKeys.filter(key => key.includes('completed')).length,
      failed: bullKeys.filter(key => key.includes('failed')).length,
      active: bullKeys.filter(key => key.includes('active')).length,
      delayed: bullKeys.filter(key => key.includes('delayed')).length,
      waiting: bullKeys.filter(key => key.includes('waiting')).length,
      events: bullKeys.filter(key => key.includes('events')).length,
      meta: bullKeys.filter(key => key.includes('meta')).length,
    };
    
    logger.info({
      message: 'Redis key statistics',
      totalKeys: keys.length,
      bullKeys: bullKeys.length,
      otherKeys: keys.length - bullKeys.length,
      keyPatterns
    });

    if (bullKeys.length > 300) {
      logger.warn({
        message: 'High number of BullMQ keys',
        bullKeys: bullKeys.length,
        recommendation: 'Run cleanup to remove old jobs'
      });
    }

    if (bullKeys.length > 500) {
      logger.error({
        message: 'Very high number of BullMQ keys - memory pressure',
        bullKeys: bullKeys.length,
        recommendation: 'Run aggressive cleanup immediately'
      });
    }

    // Check Redis memory usage if available
    try {
      const info = await redis.info('memory');
      const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
      if (usedMemoryMatch) {
        logger.info({
          message: 'Redis memory usage',
          usedMemory: usedMemoryMatch[1]
        });
      }
    } catch (error) {
      logger.warn('Could not fetch Redis memory info');
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

async function comprehensiveCleanupRedis() {
  try {
    logger.info('🧹 Starting comprehensive Redis cleanup...');

    // Test Redis connection
    await redis.ping();
    logger.info('✅ Redis connection successful');

    // Get statistics before cleanup
    const statsBefore = await getQueueStats();
    logger.info({
      message: 'Queue statistics before comprehensive cleanup',
      battleCrawl: statsBefore.battleCrawl,
      killsFetch: statsBefore.killsFetch
    });

    // Run comprehensive cleanup
    await comprehensiveCleanup();

    // Get statistics after cleanup
    const statsAfter = await getQueueStats();
    logger.info({
      message: 'Queue statistics after comprehensive cleanup',
      battleCrawl: statsAfter.battleCrawl,
      killsFetch: statsAfter.killsFetch
    });

    // Get total Redis keys
    const keys = await redis.keys('*');
    const bullKeys = keys.filter(key => key.startsWith('bull:'));
    
    logger.info({
      message: 'Comprehensive Redis cleanup completed',
      totalKeys: keys.length,
      bullKeys: bullKeys.length
    });

  } catch (error) {
    logger.error({
      message: 'Error during comprehensive Redis cleanup',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await redis.quit();
  }
}

async function comprehensiveCleanupWithOrphanRemovalRedis() {
  try {
    logger.info('🧹 Starting comprehensive cleanup with orphan removal...');

    // Test Redis connection
    await redis.ping();
    logger.info('✅ Redis connection successful');

    // Get statistics before cleanup
    const statsBefore = await getQueueStats();
    logger.info({
      message: 'Queue statistics before comprehensive cleanup with orphan removal',
      battleCrawl: statsBefore.battleCrawl,
      killsFetch: statsBefore.killsFetch
    });

    // Run comprehensive cleanup with orphan removal
    await comprehensiveCleanupWithOrphanRemoval();

    // Get statistics after cleanup
    const statsAfter = await getQueueStats();
    logger.info({
      message: 'Queue statistics after comprehensive cleanup with orphan removal',
      battleCrawl: statsAfter.battleCrawl,
      killsFetch: statsAfter.killsFetch
    });

    // Get total Redis keys
    const keys = await redis.keys('*');
    const bullKeys = keys.filter(key => key.startsWith('bull:'));
    
    logger.info({
      message: 'Comprehensive cleanup with orphan removal completed',
      totalKeys: keys.length,
      bullKeys: bullKeys.length
    });

  } catch (error) {
    logger.error({
      message: 'Error during comprehensive cleanup with orphan removal',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await redis.quit();
  }
}

async function nuclearCleanupRedis() {
  try {
    logger.info('🧹 Starting NUCLEAR cleanup (DESTRUCTIVE OPERATION)...');

    // Test Redis connection
    await redis.ping();
    logger.info('✅ Redis connection successful');

    // Get statistics before cleanup
    const statsBefore = await getQueueStats();
    logger.info({
      message: 'Queue statistics before nuclear cleanup',
      battleCrawl: statsBefore.battleCrawl,
      killsFetch: statsBefore.killsFetch
    });

    // Run nuclear cleanup
    await nuclearCleanup();

    // Get statistics after cleanup
    const statsAfter = await getQueueStats();
    logger.info({
      message: 'Queue statistics after nuclear cleanup',
      battleCrawl: statsAfter.battleCrawl,
      killsFetch: statsAfter.killsFetch
    });

    // Get total Redis keys
    const keys = await redis.keys('*');
    const bullKeys = keys.filter(key => key.startsWith('bull:'));
    
    logger.info({
      message: 'Nuclear cleanup completed',
      totalKeys: keys.length,
      bullKeys: bullKeys.length
    });

  } catch (error) {
    logger.error({
      message: 'Error during nuclear cleanup',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await redis.quit();
  }
}

async function ultraAggressiveCleanupRedis() {
  try {
    logger.info('🧹 Starting ULTRA-AGGRESSIVE cleanup (EMERGENCY OPERATION)...');

    // Test Redis connection
    await redis.ping();
    logger.info('✅ Redis connection successful');

    // Get statistics before cleanup
    const statsBefore = await getQueueStats();
    logger.info({
      message: 'Queue statistics before ultra-aggressive cleanup',
      battleCrawl: statsBefore.battleCrawl,
      killsFetch: statsBefore.killsFetch
    });

    // Run ultra-aggressive cleanup
    await ultraAggressiveCleanup();

    // Get statistics after cleanup
    const statsAfter = await getQueueStats();
    logger.info({
      message: 'Queue statistics after ultra-aggressive cleanup',
      battleCrawl: statsAfter.battleCrawl,
      killsFetch: statsAfter.killsFetch
    });

    // Get total Redis keys
    const keys = await redis.keys('*');
    const bullKeys = keys.filter(key => key.startsWith('bull:'));
    
    logger.info({
      message: 'Ultra-aggressive cleanup completed',
      totalKeys: keys.length,
      bullKeys: bullKeys.length
    });

  } catch (error) {
    logger.error({
      message: 'Error during ultra-aggressive cleanup',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await redis.quit();
  }
}

async function obliterateRedis() {
  try {
    logger.info('🧹 Starting Redis obliteration (DESTRUCTIVE OPERATION)...');

    // Test Redis connection
    await redis.ping();
    logger.info('✅ Redis connection successful');

    // Get statistics before obliteration
    const statsBefore = await getQueueStats();
    logger.info({
      message: 'Queue statistics before obliteration',
      battleCrawl: statsBefore.battleCrawl,
      killsFetch: statsBefore.killsFetch
    });

    // Run obliteration
    await obliterateAllQueues();

    // Get statistics after obliteration
    const statsAfter = await getQueueStats();
    logger.info({
      message: 'Queue statistics after obliteration',
      battleCrawl: statsAfter.battleCrawl,
      killsFetch: statsAfter.killsFetch
    });

    // Get total Redis keys
    const keys = await redis.keys('*');
    const bullKeys = keys.filter(key => key.startsWith('bull:'));
    
    logger.info({
      message: 'Redis obliteration completed',
      totalKeys: keys.length,
      bullKeys: bullKeys.length
    });

  } catch (error) {
    logger.error({
      message: 'Error during Redis obliteration',
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
  case 'comprehensive':
    comprehensiveCleanupRedis();
    break;
  case 'comprehensive-orphan':
    comprehensiveCleanupWithOrphanRemovalRedis();
    break;
  case 'nuclear':
    nuclearCleanupRedis();
    break;
  case 'ultra':
    ultraAggressiveCleanupRedis();
    break;
  case 'obliterate':
    obliterateRedis();
    break;
  default:
    console.log('Usage:');
    console.log('  yarn tsx apps/redis-monitor.ts monitor              - Monitor Redis health');
    console.log('  yarn tsx apps/redis-monitor.ts cleanup              - Clean up old jobs (30 min)');
    console.log('  yarn tsx apps/redis-monitor.ts aggressive           - Aggressive cleanup (10 min)');
    console.log('  yarn tsx apps/redis-monitor.ts comprehensive        - Comprehensive cleanup (1 min)');
    console.log('  yarn tsx apps/redis-monitor.ts comprehensive-orphan - Comprehensive cleanup with orphan removal');
    console.log('  yarn tsx apps/redis-monitor.ts nuclear              - Nuclear cleanup (removes all except active jobs)');
    console.log('  yarn tsx apps/redis-monitor.ts ultra                - Ultra-aggressive cleanup (removes ALL BullMQ keys)');
    console.log('  yarn tsx apps/redis-monitor.ts obliterate           - Obliterate all queues (DESTRUCTIVE)');
    break;
}
