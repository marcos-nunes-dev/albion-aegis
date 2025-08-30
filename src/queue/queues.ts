import { Queue, QueueEvents } from 'bullmq';
import redis from './connection.js';

// Job data types
export interface BattleCrawlJobData {
  runId: string;
}

export interface KillsFetchJobData {
  albionId: string;
}

// Queue names
export const QUEUE_NAMES = {
  BATTLE_CRAWL: 'battle-crawl',
  KILLS_FETCH: 'kills-fetch',
} as const;

// Battle crawl queue - for scheduling battle list polling
export const battleCrawlQueue = new Queue<BattleCrawlJobData>(QUEUE_NAMES.BATTLE_CRAWL, {
  connection: redis,
  defaultJobOptions: {
    // More aggressive cleanup for high-volume processing
    removeOnComplete: { count: 50, age: 15 * 60 * 1000 }, // Keep last 50 or 15 minutes
    removeOnFail: { count: 25, age: 15 * 60 * 1000 },     // Keep last 25 or 15 minutes
    // Retry failed jobs
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Kills fetch queue - for processing individual battle kill events
export const killsFetchQueue = new Queue<KillsFetchJobData>(QUEUE_NAMES.KILLS_FETCH, {
  connection: redis,
  defaultJobOptions: {
    // More aggressive cleanup for high-volume processing
    removeOnComplete: { count: 50, age: 10 * 60 * 1000 }, // Keep last 50 or 10 minutes
    removeOnFail: { count: 25, age: 10 * 60 * 1000 },     // Keep last 25 or 10 minutes
    // Retry failed jobs more aggressively for kills
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

// Queue events for monitoring
export const battleCrawlEvents = new QueueEvents(QUEUE_NAMES.BATTLE_CRAWL, {
  connection: redis,
});

export const killsFetchEvents = new QueueEvents(QUEUE_NAMES.KILLS_FETCH, {
  connection: redis,
});

// Event handlers for battle crawl queue
battleCrawlEvents.on('completed', (args: { jobId: string; returnvalue: string; prev?: string; }) => {
  console.log(`✅ Battle crawl completed: ${args.jobId}`);
});

battleCrawlEvents.on('failed', (args: { jobId: string; failedReason: string; prev?: string; }) => {
  console.error(`❌ Battle crawl failed: ${args.jobId}`, args.failedReason);
});

battleCrawlEvents.on('stalled', (args: { jobId: string; }) => {
  console.warn(`⚠️  Battle crawl job stalled: ${args.jobId}`);
});

// Event handlers for kills fetch queue
killsFetchEvents.on('completed', (args: { jobId: string; returnvalue: string; prev?: string; }) => {
  console.log(`✅ Kills fetch completed: ${args.jobId}`);
});

killsFetchEvents.on('failed', (args: { jobId: string; failedReason: string; prev?: string; }) => {
  console.error(`❌ Kills fetch failed: ${args.jobId}`, args.failedReason);
});

killsFetchEvents.on('stalled', (args: { jobId: string; }) => {
  console.warn(`⚠️  Kills fetch job stalled: ${args.jobId}`);
});

// Queue utility functions
export async function getQueueStats() {
  const [battleCrawlStats, killsFetchStats] = await Promise.all([
    battleCrawlQueue.getJobCounts(),
    killsFetchQueue.getJobCounts(),
  ]);

  return {
    battleCrawl: battleCrawlStats,
    killsFetch: killsFetchStats,
  };
}

export async function clearAllQueues() {
  await Promise.all([
    battleCrawlQueue.obliterate({ force: true }),
    killsFetchQueue.obliterate({ force: true }),
  ]);
  console.log('🧹 All queues cleared');
}

export async function cleanupOldJobs() {
  console.log('🧹 Cleaning up old jobs...');
  
  // Clean up jobs older than 30 minutes for high-volume processing
  const thirtyMinutes = 30 * 60 * 1000;
  
  try {
    await Promise.all([
      battleCrawlQueue.clean(thirtyMinutes, 'completed' as any),
      battleCrawlQueue.clean(thirtyMinutes, 'failed' as any),
      killsFetchQueue.clean(thirtyMinutes, 'completed' as any),
      killsFetchQueue.clean(thirtyMinutes, 'failed' as any),
    ]);
    console.log('✅ Old jobs cleaned up');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
}

export async function aggressiveCleanup() {
  console.log('🧹 Performing aggressive cleanup...');
  
  // Clean up jobs older than 10 minutes for very high volume
  const tenMinutes = 10 * 60 * 1000;
  
  try {
    await Promise.all([
      battleCrawlQueue.clean(tenMinutes, 'completed' as any),
      battleCrawlQueue.clean(tenMinutes, 'failed' as any),
      killsFetchQueue.clean(tenMinutes, 'completed' as any),
      killsFetchQueue.clean(tenMinutes, 'failed' as any),
    ]);
    console.log('✅ Aggressive cleanup completed');
  } catch (error) {
    console.error('❌ Error during aggressive cleanup:', error);
  }
}

export async function comprehensiveCleanup() {
  console.log('🧹 Performing comprehensive cleanup...');
  
  try {
    // Clean up jobs older than 1 minute (very aggressive)
    const oneMinute = 1 * 60 * 1000;
    
    await Promise.all([
      battleCrawlQueue.clean(oneMinute, 'completed' as any),
      battleCrawlQueue.clean(oneMinute, 'failed' as any),
      killsFetchQueue.clean(oneMinute, 'completed' as any),
      killsFetchQueue.clean(oneMinute, 'failed' as any),
    ]);
    
    // Also try cleaning with 0 age (all jobs)
    await Promise.all([
      battleCrawlQueue.clean(0, 'completed' as any),
      battleCrawlQueue.clean(0, 'failed' as any),
      killsFetchQueue.clean(0, 'completed' as any),
      killsFetchQueue.clean(0, 'failed' as any),
    ]);
    
    console.log('✅ Comprehensive cleanup completed');
  } catch (error) {
    console.error('❌ Error during comprehensive cleanup:', error);
  }
}

export async function obliterateAllQueues() {
  console.log('🧹 Obliterating all queues (DESTRUCTIVE OPERATION)...');
  
  try {
    await Promise.all([
      battleCrawlQueue.obliterate({ force: true }),
      killsFetchQueue.obliterate({ force: true }),
    ]);
    console.log('✅ All queues obliterated');
  } catch (error) {
    console.error('❌ Error during queue obliteration:', error);
  }
}

/**
 * Comprehensive cleanup that removes orphaned BullMQ keys
 * This addresses the issue where standard cleanup doesn't remove all keys
 */
export async function comprehensiveCleanupWithOrphanRemoval() {
  console.log('🧹 Performing comprehensive cleanup with orphan removal...');
  
  try {
    // First, try standard cleanup methods
    const oneMinute = 1 * 60 * 1000;
    
    await Promise.all([
      battleCrawlQueue.clean(oneMinute, 'completed' as any),
      battleCrawlQueue.clean(oneMinute, 'failed' as any),
      killsFetchQueue.clean(oneMinute, 'completed' as any),
      killsFetchQueue.clean(oneMinute, 'failed' as any),
    ]);
    
    // Also try cleaning with 0 age (all jobs)
    await Promise.all([
      battleCrawlQueue.clean(0, 'completed' as any),
      battleCrawlQueue.clean(0, 'failed' as any),
      killsFetchQueue.clean(0, 'completed' as any),
      killsFetchQueue.clean(0, 'failed' as any),
    ]);
    
    // Now handle orphaned keys - get all BullMQ keys
    const keys = await redis.keys('bull:*');
    console.log(`Found ${keys.length} BullMQ keys`);
    
    // Group keys by queue and type
    const keyGroups: Record<string, string[]> = {};
    keys.forEach(key => {
      const parts = key.split(':');
      if (parts.length >= 3) {
        const queueName = parts[1];
        const keyType = parts[2];
        const groupKey = `${queueName}:${keyType}`;
        if (!keyGroups[groupKey]) {
          keyGroups[groupKey] = [];
        }
        keyGroups[groupKey].push(key);
      }
    });
    
    console.log('Key groups found:', Object.keys(keyGroups));
    
    // Remove orphaned keys that don't belong to our active queues
    const validQueues = [QUEUE_NAMES.BATTLE_CRAWL, QUEUE_NAMES.KILLS_FETCH];
    let removedKeys = 0;
    
    for (const [groupKey, groupKeys] of Object.entries(keyGroups)) {
      const queueName = groupKey.split(':')[0];
      
      // If this is not one of our active queues, remove all its keys
      if (!validQueues.includes(queueName as any)) {
        console.log(`Removing orphaned queue keys: ${groupKey} (${groupKeys.length} keys)`);
        await Promise.all(groupKeys.map(key => redis.del(key)));
        removedKeys += groupKeys.length;
      }
    }
    
    // Also remove any keys that are too old (older than 1 hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const keysToCheck = keys.filter(key => !key.includes('meta') && !key.includes('events'));
    
    for (const key of keysToCheck) {
      try {
        const ttl = await redis.ttl(key);
        if (ttl === -1) { // No expiration set
          // Check if it's a job key and if so, check its timestamp
          if (key.includes('completed') || key.includes('failed')) {
            const jobData = await redis.hgetall(key);
            if (jobData.timestamp) {
              const jobTimestamp = parseInt(jobData.timestamp);
              if (jobTimestamp < oneHourAgo) {
                await redis.del(key);
                removedKeys++;
              }
            }
          }
        }
      } catch (error) {
        // Skip keys that can't be processed
        console.log(`Skipping problematic key: ${key}`);
      }
    }
    
    console.log(`✅ Comprehensive cleanup completed. Removed ${removedKeys} orphaned keys`);
    
  } catch (error) {
    console.error('❌ Error during comprehensive cleanup with orphan removal:', error);
  }
}

export async function closeAllQueues() {
  await Promise.all([
    battleCrawlQueue.close(),
    killsFetchQueue.close(),
    battleCrawlEvents.close(),
    killsFetchEvents.close(),
  ]);
  console.log('🔌 All queues closed');
}

/**
 * Nuclear cleanup - removes ALL BullMQ keys except active jobs
 * Use this as a last resort when Redis is severely overloaded
 */
export async function nuclearCleanup() {
  console.log('🧹 Performing NUCLEAR cleanup (removes all BullMQ keys except active jobs)...');
  
  try {
    // Get all BullMQ keys
    const keys = await redis.keys('bull:*');
    console.log(`Found ${keys.length} BullMQ keys`);
    
    // Get current active jobs to preserve them
    const [battleCrawlActive, killsFetchActive] = await Promise.all([
      battleCrawlQueue.getActive(),
      killsFetchQueue.getActive(),
    ]);
    
    const activeJobIds = new Set([
      ...battleCrawlActive.map(job => job.id),
      ...killsFetchActive.map(job => job.id),
    ]);
    
    console.log(`Preserving ${activeJobIds.size} active jobs`);
    
    // Remove all keys except those belonging to active jobs
    let removedKeys = 0;
    for (const key of keys) {
      const jobId = key.split(':').pop();
      if (jobId && !activeJobIds.has(jobId)) {
        await redis.del(key);
        removedKeys++;
      }
    }
    
    console.log(`✅ Nuclear cleanup completed. Removed ${removedKeys} keys`);
    
  } catch (error) {
    console.error('❌ Error during nuclear cleanup:', error);
  }
}

/**
 * Ultra-aggressive cleanup - removes ALL BullMQ keys and resets queues
 * This is the most destructive cleanup - use only in emergencies
 */
export async function ultraAggressiveCleanup() {
  console.log('🧹 Performing ULTRA-AGGRESSIVE cleanup (removes ALL BullMQ keys)...');
  
  try {
    // Get all BullMQ keys
    const keys = await redis.keys('bull:*');
    console.log(`Found ${keys.length} BullMQ keys to remove`);
    
    // Remove ALL BullMQ keys
    if (keys.length > 0) {
      await Promise.all(keys.map(key => redis.del(key)));
      console.log(`✅ Removed ${keys.length} BullMQ keys`);
    }
    
    // Close and recreate queues to ensure clean state
    await closeAllQueues();
    
    console.log('✅ Ultra-aggressive cleanup completed. All BullMQ keys removed.');
    
  } catch (error) {
    console.error('❌ Error during ultra-aggressive cleanup:', error);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down queues...');
  await closeAllQueues();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down queues...');
  await closeAllQueues();
  process.exit(0);
});
