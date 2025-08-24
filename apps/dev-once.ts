import { runBattleCrawl } from '../src/workers/battleCrawler/producer.js';
import { config } from '../src/lib/config.js';
import { prisma } from '../src/db/prisma.js';

console.log('🧪 Albion Dev Once - Single Crawl Test');
console.log('📊 Configuration:', {
  NODE_ENV: config.NODE_ENV,
  API_BASE_URL: config.API_BASE_URL,
  REDIS_URL: config.REDIS_URL ? '***configured***' : '❌ missing',
  MAX_PAGES_PER_CRAWL: config.MAX_PAGES_PER_CRAWL,
  SOFT_LOOKBACK_MIN: config.SOFT_LOOKBACK_MIN,
});

async function runSingleCrawl() {
  try {
    // Test database connection
    console.log('\n🔗 Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connection successful');

    // Run a single battle crawl
    console.log('\n🔄 Running single battle crawl...');
    const startTime = Date.now();
    
    await runBattleCrawl();
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Single crawl completed in ${duration}ms`);
    
    // Show some stats
    console.log('\n📊 Crawl completed successfully!');
    console.log('💡 Use this for development and testing');
    console.log('💡 For production, use: npm run start:scheduler');

  } catch (error) {
    console.error('\n❌ Single crawl failed:', error);
    process.exit(1);
  } finally {
    // Always disconnect from database
    await prisma.$disconnect();
    console.log('🔌 Database disconnected');
  }
}

// Run the single crawl
runSingleCrawl().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
