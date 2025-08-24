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
    // Remove completed jobs after 1 hour
    removeOnComplete: 100,
    removeOnFail: 50,
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
    // Remove completed jobs after 24 hours (keep for debugging)
    removeOnComplete: 1000,
    removeOnFail: 100,
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

export async function closeAllQueues() {
  await Promise.all([
    battleCrawlQueue.close(),
    killsFetchQueue.close(),
    battleCrawlEvents.close(),
    killsFetchEvents.close(),
  ]);
  console.log('🔌 All queues closed');
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
