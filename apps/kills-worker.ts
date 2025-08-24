import { startKillsFetcherWorker } from '../src/workers/killsFetcher/worker.js';
import { config } from '../src/lib/config.js';

console.log('🔪 Albion Kills Worker starting...');
console.log('📊 Configuration:', {
  NODE_ENV: config.NODE_ENV,
  API_BASE_URL: config.API_BASE_URL,
  REDIS_URL: config.REDIS_URL ? '***configured***' : '❌ missing',
  KILLS_WORKER_CONCURRENCY: config.KILLS_WORKER_CONCURRENCY,
});

// Start the kills fetcher worker
startKillsFetcherWorker();

console.log('✅ Kills worker started and listening for jobs');
console.log(`💡 Worker concurrency: ${config.KILLS_WORKER_CONCURRENCY}`);
console.log('💡 Jobs will be processed from killsFetchQueue');
