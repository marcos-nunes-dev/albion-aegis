#!/usr/bin/env tsx
import { config } from '../src/lib/config.js';
import { log } from '../src/log.js';
import redis from '../src/queue/connection.js';
import { getBattlesPage } from '../src/http/client.js';
import { prisma } from '../src/db/prisma.js';
// import { getWatermark } from '../src/services/watermark.js';
const logger = log.child({ component: 'deep-sweep-nightly' });

// Deep sweep configuration
const DEEP_SWEEP_PAGES = config.NIGHTLY_SWEEP_PAGES;
const DEEP_SWEEP_LOOKBACK_HOURS = config.NIGHTLY_SWEEP_LOOKBACK_H;
const DEEP_SWEEP_SLEEP_MS = config.NIGHTLY_SWEEP_SLEEP_MS;

/**
 * Run a deep sweep crawl with larger time window and sleep between pages
 */
async function runDeepSweepNightly(): Promise<void> {
  const startTime = Date.now();
  logger.info('Starting deep sweep nightly crawl', {
    pages: DEEP_SWEEP_PAGES,
    lookbackHours: DEEP_SWEEP_LOOKBACK_HOURS,
    sleepMs: DEEP_SWEEP_SLEEP_MS,
  });

  try {
    // Calculate soft cutoff for deep sweep (larger window)
    const now = new Date();
    const softCutoff = new Date(now.getTime() - (DEEP_SWEEP_LOOKBACK_HOURS * 60 * 60 * 1000));
    
    logger.info('Deep sweep soft cutoff calculated', {
      softCutoff: softCutoff.toISOString(),
      lookbackHours: DEEP_SWEEP_LOOKBACK_HOURS,
    });

    let totalBattlesProcessed = 0;
    let totalBattlesUpserted = 0;
    let maxStartedAtSeen: Date | null = null;

    // Process pages for deep sweep
    for (let page = 0; page < DEEP_SWEEP_PAGES; page++) {
      logger.info('Processing deep sweep page', { page: page + 1, totalPages: DEEP_SWEEP_PAGES });
      
      try {
        // Fetch battles page
        const battles = await getBattlesPage(page, 10); // Minimum 10 players for deep sweep
        
        if (battles.length === 0) {
          logger.info('No battles found on page, stopping deep sweep', { page: page + 1 });
          break;
        }

        let allOlderThanCutoff = true;
        let pageBattlesProcessed = 0;
        let pageBattlesUpserted = 0;

        // Process each battle
        for (const battle of battles) {
          const startedAt = new Date(battle.startedAt);
          
          // Track the latest startedAt we've seen
          if (!maxStartedAtSeen || startedAt > maxStartedAtSeen) {
            maxStartedAtSeen = startedAt;
          }

          // Check if battle is within our soft cutoff window
          if (startedAt >= softCutoff) {
            allOlderThanCutoff = false;
            
            try {
              // Battle existence will be checked via try-catch on create
              
              const battleData = {
                albionId: battle.albionId,
                startedAt: new Date(battle.startedAt),
                totalFame: battle.totalFame,
                totalKills: battle.totalKills,
                totalPlayers: battle.totalPlayers,
                alliancesJson: battle.alliances,
                guildsJson: battle.guilds,
                ingestedAt: new Date(),
              };
              
              // Use upsert to handle unique constraint automatically
              await prisma.battle.upsert({
                where: { albionId: battle.albionId },
                update: battleData,
                create: battleData
              });

              pageBattlesUpserted++;
              totalBattlesUpserted++;
              
                             logger.debug('Battle upserted in deep sweep', {
                 albionId: battle.albionId.toString(),
                 startedAt: startedAt.toISOString(),
                 playerCount: battle.totalPlayers,
               });

            } catch (error) {
              logger.error('Failed to upsert battle in deep sweep', {
                albionId: battle.albionId.toString(),
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }

          pageBattlesProcessed++;
          totalBattlesProcessed++;
        }

        logger.info('Deep sweep page complete', {
          page: page + 1,
          battlesProcessed: pageBattlesProcessed,
          battlesUpserted: pageBattlesUpserted,
          allOlderThanCutoff,
        });

        // If all battles on this page are older than cutoff, stop crawling
        if (allOlderThanCutoff) {
          logger.info('All battles older than deep sweep cutoff, stopping crawl', { page: page + 1 });
          break;
        }

        // Sleep between pages for deep sweep
        if (page < DEEP_SWEEP_PAGES - 1) {
          logger.info('Sleeping between deep sweep pages', { sleepMs: DEEP_SWEEP_SLEEP_MS });
          await new Promise(resolve => setTimeout(resolve, DEEP_SWEEP_SLEEP_MS));
        }

      } catch (error) {
        logger.error('Failed to process deep sweep page', {
          page: page + 1,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        // Continue with next page
      }
    }

    const duration = Date.now() - startTime;
    logger.info('Deep sweep nightly crawl completed', {
      duration,
      battlesProcessed: totalBattlesProcessed,
      battlesUpserted: totalBattlesUpserted,
      maxStartedAtSeen: maxStartedAtSeen?.toISOString(),
      // Note: We don't update watermark for deep sweeps
    });

  } catch (error) {
    logger.error('Deep sweep nightly crawl failed', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  logger.info('🌙 Albion Deep Sweep Nightly - Deep Scan Service');
  logger.info('📊 Configuration:', {
    NODE_ENV: config.NODE_ENV,
    API_BASE_URL: config.API_BASE_URL,
    REDIS_URL: config.REDIS_URL ? '***configured***' : 'not configured',
    DEEP_SWEEP_PAGES: DEEP_SWEEP_PAGES,
    DEEP_SWEEP_LOOKBACK_HOURS: DEEP_SWEEP_LOOKBACK_HOURS,
    DEEP_SWEEP_SLEEP_MS: DEEP_SWEEP_SLEEP_MS,
  });

  try {
    // Test database connection
    logger.info('🔗 Testing database connection...');
    await prisma.$connect();
    logger.info('✅ Database connection successful');

    // Test Redis connection
    logger.info('🔗 Testing Redis connection...');
    await redis.ping();
    logger.info('✅ Redis connection successful');

    // Run the deep sweep
    logger.info('🔄 Running deep sweep nightly crawl...');
    await runDeepSweepNightly();
    
    logger.info('✅ Deep sweep nightly completed successfully!');
    logger.info('💡 This service performs deeper scans with larger time windows');
    logger.info('💡 For regular crawling, use: npm run start:scheduler');

  } catch (error) {
    logger.error('❌ Deep sweep nightly failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    logger.info('🔌 Disconnecting from database...');
    await prisma.$disconnect();
    
    logger.info('🛑 Shutting down Redis connection...');
    await redis.quit();
    
    logger.info('✅ Deep sweep nightly service shutdown complete');
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('🛑 Received SIGTERM, shutting down gracefully...');
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('🛑 Received SIGINT, shutting down gracefully...');
  await prisma.$disconnect();
  await redis.quit();
  process.exit(0);
});

// Run the main function
main().catch((error) => {
  logger.error('❌ Unhandled error:', error);
  process.exit(1);
});
