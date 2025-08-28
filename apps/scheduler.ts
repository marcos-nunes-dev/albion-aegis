import { startCrawlLoop, stopCrawlLoop, startCleanupLoop, stopCleanupLoop, startHighFrequencyCleanupLoop, stopHighFrequencyCleanupLoop } from '../src/scheduler/crawlLoop.js';
import { config } from '../src/lib/config.js';
import { getPrisma, getHealthStatus } from '../src/db/database.js';

console.log('🔄 Albion Scheduler starting...');
console.log('📊 Configuration:', {
  NODE_ENV: config.NODE_ENV,
  API_BASE_URL: config.API_BASE_URL,
  REDIS_URL: config.REDIS_URL ? '***configured***' : '❌ missing',
  CRAWL_INTERVAL_SEC: config.CRAWL_INTERVAL_SEC,
  MAX_PAGES_PER_CRAWL: config.MAX_PAGES_PER_CRAWL,
  SOFT_LOOKBACK_MIN: config.SOFT_LOOKBACK_MIN,
  DATABASE_POOL_MIN: config.DATABASE_POOL_MIN,
  DATABASE_POOL_MAX: config.DATABASE_POOL_MAX,
});

// Log database health status
const healthStatus = getHealthStatus();
console.log('🗄️ Database Health Status:', {
  isConnected: healthStatus.isConnected,
  connectionErrors: healthStatus.connectionErrors,
  lastHealthCheck: healthStatus.lastHealthCheck,
  poolConfig: healthStatus.poolConfig,
});

// Test database connection
try {
  const prisma = getPrisma();
  await prisma.$connect();
  console.log('✅ Database connection successful');
} catch (error) {
  console.error('❌ Database connection failed:', error);
  process.exit(1);
}

// Start the crawl loop
const crawlInterval = startCrawlLoop();

// Start the intelligent Redis cleanup loop
const cleanupInterval = startCleanupLoop();

// Start the high-frequency cleanup loop for active periods
const highFreqCleanupInterval = startHighFrequencyCleanupLoop();

console.log('✅ Scheduler started successfully');
console.log(`💡 Crawl loop running every ${config.CRAWL_INTERVAL_SEC} seconds`);
console.log(`🧹 Intelligent Redis cleanup enabled (every ${config.REDIS_CLEANUP_INTERVAL_MIN} minutes)`);
console.log(`🧹 High-frequency cleanup enabled (every 5 minutes when needed)`);
console.log('💡 Rate limiting and slowdown hooks are active');
console.log(`💡 Database pool: ${config.DATABASE_POOL_MIN}-${config.DATABASE_POOL_MAX} connections`);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down scheduler...');
  stopCrawlLoop(crawlInterval);
  stopCleanupLoop(cleanupInterval);
  stopHighFrequencyCleanupLoop(highFreqCleanupInterval);
  const prisma = getPrisma();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down scheduler...');
  stopCrawlLoop(crawlInterval);
  stopCleanupLoop(cleanupInterval);
  stopHighFrequencyCleanupLoop(highFreqCleanupInterval);
  const prisma = getPrisma();
  await prisma.$disconnect();
  process.exit(0);
});
