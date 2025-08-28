import { runBattleCrawl } from '../src/workers/battleCrawler/producer.js';
import { config } from '../src/lib/config.js';
import { prisma } from '../src/db/prisma.js';

console.log('🧪 Albion Dev Once - Single Crawl Test');

async function runSingleCrawl() {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connection successful');

    // Run a single battle crawl
    const startTime = Date.now();
    
    await runBattleCrawl();
    
    const duration = Date.now() - startTime;
    console.log(`✅ Single crawl completed in ${duration}ms`);

  } catch (error) {
    console.error('\n❌ Single crawl failed:', error);
    process.exit(1);
  } finally {
    // Always disconnect from database
    await prisma.$disconnect();
  }
}

// Run the single crawl
runSingleCrawl().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
