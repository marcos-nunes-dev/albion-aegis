import { startKillsFetcherWorker } from '../src/workers/killsFetcher/worker.js';
import { config } from '../src/lib/config.js';
import { getHealthStatus } from '../src/db/database.js';

console.log('🔪 Albion Kills Worker starting...');
console.log('📊 Configuration:', {
  NODE_ENV: config.NODE_ENV,
  API_BASE_URL: config.API_BASE_URL,
  REDIS_URL: config.REDIS_URL ? '***configured***' : '❌ missing',
  KILLS_WORKER_CONCURRENCY: config.KILLS_WORKER_CONCURRENCY,
  DATABASE_POOL_MIN: config.DATABASE_POOL_MIN,
  DATABASE_POOL_MAX: config.DATABASE_POOL_MAX,
  DATABASE_CONNECTION_TIMEOUT: config.DATABASE_CONNECTION_TIMEOUT,
  DATABASE_IDLE_TIMEOUT: config.DATABASE_IDLE_TIMEOUT,
});

// Log database health status
const healthStatus = getHealthStatus();
console.log('🗄️ Database Health Status:', {
  isConnected: healthStatus.isConnected,
  connectionErrors: healthStatus.connectionErrors,
  lastHealthCheck: healthStatus.lastHealthCheck,
  poolConfig: healthStatus.poolConfig,
});

// Start the kills fetcher worker
startKillsFetcherWorker();

console.log('✅ Kills worker started and listening for jobs');
console.log(`💡 Worker concurrency: ${config.KILLS_WORKER_CONCURRENCY}`);
console.log(`💡 Database pool: ${config.DATABASE_POOL_MIN}-${config.DATABASE_POOL_MAX} connections`);
console.log('💡 Jobs will be processed from killsFetchQueue');
