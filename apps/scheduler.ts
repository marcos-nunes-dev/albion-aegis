import { startCrawlLoop, stopCrawlLoop } from '../src/scheduler/crawlLoop.js';
import { config } from '../src/lib/config.js';
import { prisma } from '../src/db/prisma.js';

console.log('🔄 Albion Scheduler starting...');
console.log('📊 Configuration:', {
  NODE_ENV: config.NODE_ENV,
  API_BASE_URL: config.API_BASE_URL,
  REDIS_URL: config.REDIS_URL ? '***configured***' : '❌ missing',
  CRAWL_INTERVAL_SEC: config.CRAWL_INTERVAL_SEC,
  MAX_PAGES_PER_CRAWL: config.MAX_PAGES_PER_CRAWL,
  SOFT_LOOKBACK_MIN: config.SOFT_LOOKBACK_MIN,
});

// Test database connection
try {
  await prisma.$connect();
  console.log('✅ Database connection successful');
} catch (error) {
  console.error('❌ Database connection failed:', error);
  process.exit(1);
}

// Start the crawl loop
const crawlInterval = startCrawlLoop();

console.log('✅ Scheduler started successfully');
console.log(`💡 Crawl loop running every ${config.CRAWL_INTERVAL_SEC} seconds`);
console.log('💡 Rate limiting and slowdown hooks are active');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down scheduler...');
  stopCrawlLoop(crawlInterval);
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down scheduler...');
  stopCrawlLoop(crawlInterval);
  await prisma.$disconnect();
  process.exit(0);
});
