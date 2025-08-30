import { runBattleCrawl } from '../workers/battleCrawler/producer.js';
import { config } from '../lib/config.js';
import { shouldSlowDown, getRateLimitStats } from '../http/client.js';
import { log } from '../log.js';
import { cleanupOldJobs, aggressiveCleanup, comprehensiveCleanup, comprehensiveCleanupWithOrphanRemoval, getQueueStats } from '../queue/queues.js';
import redis from '../queue/connection.js';

// Rate limiting state for slowdown tracking
interface SlowdownState {
  isSlowdownActive: boolean;
  slowdownStartTime: number | null;
}

const slowdownState: SlowdownState = {
  isSlowdownActive: false,
  slowdownStartTime: null,
};

// Slowdown configuration
const SLOWDOWN_DURATION_MS = 120 * 1000; // 120 seconds

/**
 * Check if we should apply slowdown based on rate limiting
 */
function checkSlowdown(): boolean {
  const now = Date.now();
  
  // Check if we're currently in slowdown mode
  if (slowdownState.isSlowdownActive && slowdownState.slowdownStartTime) {
    const slowdownElapsed = now - slowdownState.slowdownStartTime;
    
    if (slowdownElapsed >= SLOWDOWN_DURATION_MS) {
      log.info('Rate limit slowdown period ended, resuming normal operation');
      slowdownState.isSlowdownActive = false;
      slowdownState.slowdownStartTime = null;
      return false; // No extra delay needed
    } else {
      const remainingMs = SLOWDOWN_DURATION_MS - slowdownElapsed;
      log.info('Rate limit slowdown active', { 
        remainingSeconds: Math.ceil(remainingMs / 1000) 
      });
      return true; // Extra delay needed
    }
  }
  
  // Check if we should activate slowdown based on rate limiting
  if (shouldSlowDown() && !slowdownState.isSlowdownActive) {
    const stats = getRateLimitStats();
    log.warn('Activating rate limit slowdown', {
      durationSeconds: SLOWDOWN_DURATION_MS / 1000,
      rateLimitRatio: stats.rateLimitRatio,
      totalRequests: stats.totalRequests,
      rateLimitCount: stats.rateLimitCount,
      threshold: stats.threshold,
    });
    
    slowdownState.isSlowdownActive = true;
    slowdownState.slowdownStartTime = now;
    return true; // Extra delay needed
  }
  
  return false; // No extra delay needed
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Intelligent cleanup strategy based on queue health
 */
async function performIntelligentCleanup(): Promise<void> {
  try {
    // Get current queue statistics
    const stats = await getQueueStats();
    const totalJobs = Object.values(stats.battleCrawl).reduce((a, b) => a + b, 0) +
                     Object.values(stats.killsFetch).reduce((a, b) => a + b, 0);
    
    log.info('Queue health check', {
      totalJobs,
      battleCrawl: stats.battleCrawl,
      killsFetch: stats.killsFetch
    });
    
    // Determine cleanup strategy based on queue health
    if (totalJobs > 1000) {
      log.warn('High job count detected - performing comprehensive cleanup', { totalJobs });
      await comprehensiveCleanup();
    } else if (totalJobs > 500) {
      log.warn('Moderate job count detected - performing aggressive cleanup', { totalJobs });
      await aggressiveCleanup();
    } else if (totalJobs > 100) {
      log.info('Normal job count - performing regular cleanup', { totalJobs });
      await cleanupOldJobs();
    } else {
      log.info('Low job count - no cleanup needed', { totalJobs });
    }
    
    // Check for specific issues
    if (stats.killsFetch.failed > 50) {
      log.warn('High number of failed jobs detected', { failedJobs: stats.killsFetch.failed });
    }
    
    if (stats.killsFetch.active > 10) {
      log.warn('High number of active jobs detected', { activeJobs: stats.killsFetch.active });
    }
    
    // NEW: Check for orphaned queues every 30 minutes (every 2nd cleanup)
    const cleanupCount = Math.floor(Date.now() / (config.REDIS_CLEANUP_INTERVAL_MIN * 60 * 1000));
    if (cleanupCount % 2 === 0) {
      log.info('Performing orphaned queue check and cleanup');
      await comprehensiveCleanupWithOrphanRemoval();
    }
    
    // NEW: Monitor Redis key count and trigger emergency cleanup if needed
    try {
      const keys = await redis.keys('*');
      const bullKeys = keys.filter(key => key.startsWith('bull:'));
      
      log.info('Redis key monitoring', {
        totalKeys: keys.length,
        bullKeys: bullKeys.length
      });
      
      // Emergency cleanup if BullMQ keys exceed 1000
      if (bullKeys.length > 1000) {
        log.error('Emergency: High number of BullMQ keys detected - performing comprehensive cleanup', { bullKeys: bullKeys.length });
        await comprehensiveCleanupWithOrphanRemoval();
      }
      // Warning if BullMQ keys exceed 500
      else if (bullKeys.length > 500) {
        log.warn('Warning: High number of BullMQ keys detected', { bullKeys: bullKeys.length });
      }
    } catch (error) {
      log.warn('Could not check Redis key count', { error: error instanceof Error ? error.message : 'Unknown error' });
    }
    
  } catch (error) {
    log.error('Error during intelligent cleanup', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Start the crawl loop that runs battle crawler periodically
 */
export function startCrawlLoop(): ReturnType<typeof setInterval> {
  log.info('Starting crawl loop', { 
    intervalSeconds: config.CRAWL_INTERVAL_SEC,
    slowdownDurationSeconds: SLOWDOWN_DURATION_MS / 1000,
  });
  
  let crawlCount = 0;
  
  const crawlInterval = setInterval(async () => {
    crawlCount++;
    const startTime = Date.now();
    
    log.info('Crawl starting', { 
      crawlNumber: crawlCount, 
      timestamp: new Date().toISOString() 
    });
    
    // Check if we need to apply slowdown
    const needsSlowdown = checkSlowdown();
    if (needsSlowdown) {
      log.info('Applying rate limit slowdown, sleeping for 120s');
      await sleep(SLOWDOWN_DURATION_MS);
      log.info('Rate limit slowdown completed, continuing with crawl');
    }
    
    try {
      // Run the battle crawl
      await runBattleCrawl();
      
      const duration = Date.now() - startTime;
      log.info('Crawl completed', { 
        crawlNumber: crawlCount, 
        durationMs: duration 
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error('Crawl failed', { 
        crawlNumber: crawlCount, 
        durationMs: duration,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Don't throw - continue with next crawl
    }
  }, config.CRAWL_INTERVAL_SEC * 1000);
  
  // Return the interval ID for cleanup
  return crawlInterval;
}

/**
 * Start the intelligent Redis cleanup loop
 */
export function startCleanupLoop(): ReturnType<typeof setInterval> {
  log.info('Starting intelligent Redis cleanup loop', { 
    intervalMinutes: config.REDIS_CLEANUP_INTERVAL_MIN,
  });
  
  let cleanupCount = 0;
  
  const cleanupInterval = setInterval(async () => {
    cleanupCount++;
    const startTime = Date.now();
    
    log.info('Intelligent Redis cleanup starting', { 
      cleanupNumber: cleanupCount, 
      timestamp: new Date().toISOString() 
    });
    
    try {
      // Run the intelligent cleanup
      await performIntelligentCleanup();
      
      const duration = Date.now() - startTime;
      log.info('Intelligent Redis cleanup completed', { 
        cleanupNumber: cleanupCount, 
        durationMs: duration 
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error('Intelligent Redis cleanup failed', { 
        cleanupNumber: cleanupCount, 
        durationMs: duration,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Don't throw - continue with next cleanup
    }
  }, config.REDIS_CLEANUP_INTERVAL_MIN * 60 * 1000); // Configurable interval
  
  // Return the interval ID for cleanup
  return cleanupInterval;
}

/**
 * Start a high-frequency cleanup loop for very active periods
 */
export function startHighFrequencyCleanupLoop(): ReturnType<typeof setInterval> {
  log.info('Starting high-frequency cleanup loop', { 
    intervalMinutes: config.REDIS_HIGH_FREQ_CLEANUP_INTERVAL_MIN,
  });
  
  let cleanupCount = 0;
  
  const cleanupInterval = setInterval(async () => {
    cleanupCount++;
    const startTime = Date.now();
    
    try {
      // Get current queue statistics
      const stats = await getQueueStats();
      const totalJobs = Object.values(stats.battleCrawl).reduce((a, b) => a + b, 0) +
                       Object.values(stats.killsFetch).reduce((a, b) => a + b, 0);
      
      // Only perform cleanup if job count is high
      if (totalJobs > 200) {
        log.info('High-frequency cleanup triggered', { 
          cleanupNumber: cleanupCount,
          totalJobs,
          timestamp: new Date().toISOString() 
        });
        
        await cleanupOldJobs();
        
        const duration = Date.now() - startTime;
        log.info('High-frequency cleanup completed', { 
          cleanupNumber: cleanupCount, 
          durationMs: duration 
        });
      } else {
        log.debug('High-frequency cleanup skipped - low job count', { totalJobs });
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error('High-frequency cleanup failed', { 
        cleanupNumber: cleanupCount, 
        durationMs: duration,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }, config.REDIS_HIGH_FREQ_CLEANUP_INTERVAL_MIN * 60 * 1000);
  
  // Return the interval ID for cleanup
  return cleanupInterval;
}

/**
 * Stop the crawl loop
 */
export function stopCrawlLoop(intervalId: ReturnType<typeof setInterval>): void {
  log.info('Stopping crawl loop');
  clearInterval(intervalId);
  log.info('Crawl loop stopped');
}

/**
 * Stop the cleanup loop
 */
export function stopCleanupLoop(intervalId: ReturnType<typeof setInterval>): void {
  log.info('Stopping cleanup loop');
  clearInterval(intervalId);
  log.info('Cleanup loop stopped');
}

/**
 * Stop the high-frequency cleanup loop
 */
export function stopHighFrequencyCleanupLoop(intervalId: ReturnType<typeof setInterval>): void {
  log.info('Stopping high-frequency cleanup loop');
  clearInterval(intervalId);
  log.info('High-frequency cleanup loop stopped');
}

/**
 * Get crawl loop statistics
 */
export function getCrawlLoopStats() {
  const now = Date.now();
  const slowdownRemaining = slowdownState.isSlowdownActive && slowdownState.slowdownStartTime
    ? Math.max(0, SLOWDOWN_DURATION_MS - (now - slowdownState.slowdownStartTime))
    : 0;
  
  return {
    rateLimit: {
      ...getRateLimitStats(),
      isSlowdownActive: slowdownState.isSlowdownActive,
      slowdownRemainingMs: slowdownRemaining,
    },
    config: {
      crawlIntervalSec: config.CRAWL_INTERVAL_SEC,
      maxPagesPerCrawl: config.MAX_PAGES_PER_CRAWL,
      softLookbackMin: config.SOFT_LOOKBACK_MIN,
      slowdownDurationMs: SLOWDOWN_DURATION_MS,
      cleanupIntervalMin: config.REDIS_CLEANUP_INTERVAL_MIN,
    },
  };
}

// Legacy functions for backward compatibility
export function recordRateLimit(): void {
  // This is now handled by the HTTP client's rate limit tracker
  log.debug('Legacy recordRateLimit called - now handled by HTTP client');
}

export function recordSuccess(): void {
  // This is now handled by the HTTP client's rate limit tracker
  log.debug('Legacy recordSuccess called - now handled by HTTP client');
}
