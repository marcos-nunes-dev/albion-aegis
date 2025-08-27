import { runBattleCrawl } from '../workers/battleCrawler/producer.js';
import { config } from '../lib/config.js';
import { shouldSlowDown, getRateLimitStats } from '../http/client.js';
import { log } from '../log.js';
import { cleanupOldJobs } from '../queue/queues.js';

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
 * Start the Redis cleanup loop that runs every 30 minutes
 */
export function startCleanupLoop(): ReturnType<typeof setInterval> {
  log.info('Starting Redis cleanup loop', { 
    intervalMinutes: config.REDIS_CLEANUP_INTERVAL_MIN,
  });
  
  let cleanupCount = 0;
  
  const cleanupInterval = setInterval(async () => {
    cleanupCount++;
    const startTime = Date.now();
    
    log.info('Redis cleanup starting', { 
      cleanupNumber: cleanupCount, 
      timestamp: new Date().toISOString() 
    });
    
    try {
      // Run the Redis cleanup
      await cleanupOldJobs();
      
      const duration = Date.now() - startTime;
      log.info('Redis cleanup completed', { 
        cleanupNumber: cleanupCount, 
        durationMs: duration 
      });
      
    } catch (error) {
      const duration = Date.now() - startTime;
      log.error('Redis cleanup failed', { 
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
