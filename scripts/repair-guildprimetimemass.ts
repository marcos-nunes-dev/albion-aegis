/**
 * Script to repair the guildprimetimemass table for season cmfis69u30000sh35k5u88g65
 * 
 * This script recalculates the correct average mass (player count) for each guild's
 * prime time windows using data from mmr_calculation_logs table.
 * 
 * Usage: 
 *   yarn tsx scripts/repair-guildprimetimemass.ts           # Run the repair
 *   yarn tsx scripts/repair-guildprimetimemass.ts --dry-run # Preview changes without modifying database
 */

import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const logger = log.child({ component: 'repair-guildprimetimemass' });

// Configure Prisma for Supabase connection pooling (same as api-bff/src/db.ts)
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

const isSupabase = databaseUrl.includes('supabase.com');

const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: isSupabase 
        ? `${databaseUrl}?pgbouncer=true&connection_limit=1&prepared_statements=false`
        : databaseUrl,
    },
  },
});

const TARGET_SEASON_ID = 'cmfis69u30000sh35k5u88g65';

// Check if this is a dry run (pass --dry-run as argument)
const isDryRun = process.argv.includes('--dry-run');

interface PrimeTimeWindow {
  id: string;
  startHour: number;
  endHour: number;
}

interface GuildMassData {
  guildSeasonId: string;
  primeTimeWindowId: string;
  totalMass: number;
  battleCount: number;
  avgMass: number;
  lastBattleAt: Date;
}

/**
 * Check if a battle hour falls within a prime time window
 */
function isBattleInPrimeTimeWindow(battleHour: number, window: PrimeTimeWindow): boolean {
  if (window.startHour <= window.endHour) {
    // Same day window (e.g., 20:00 to 22:00)
    return battleHour >= window.startHour && battleHour < window.endHour;
  } else {
    // Overnight window (e.g., 22:00 to 02:00)
    return battleHour >= window.startHour || battleHour < window.endHour;
  }
}

async function main() {
  try {
    await prisma.$connect();
    logger.info('✅ Connected to database');
    
    if (isDryRun) {
      logger.info('🔍 DRY RUN MODE - No changes will be made to the database');
    }

    // Verify the target season exists
    const targetSeason = await prisma.season.findUnique({
      where: { id: TARGET_SEASON_ID }
    });

    if (!targetSeason) {
      logger.error(`❌ Season ${TARGET_SEASON_ID} not found`);
      process.exit(1);
    }

    logger.info(`🎯 Target season: ${targetSeason.name} (${TARGET_SEASON_ID})`);

    // Get all prime time windows
    const primeTimeWindows = await prisma.primeTimeWindow.findMany({
      orderBy: [{ startHour: 'asc' }]
    });

    if (primeTimeWindows.length === 0) {
      logger.error('❌ No prime time windows found');
      process.exit(1);
    }

    logger.info(`📅 Found ${primeTimeWindows.length} prime time windows:`);
    primeTimeWindows.forEach(window => {
      logger.info(`  - ${window.startHour}:00 to ${window.endHour}:00 UTC (ID: ${window.id})`);
    });

    // Get all guild seasons for the target season
    const guildSeasons = await prisma.guildSeason.findMany({
      where: { seasonId: TARGET_SEASON_ID },
      include: { guild: true }
    });

    logger.info(`🏰 Found ${guildSeasons.length} guilds in target season`);

    // Get all MMR calculation logs for the target season with battle data
    logger.info('📊 Fetching MMR calculation logs...');
    const mmrLogs = await prisma.mmrCalculationLog.findMany({
      where: { 
        seasonId: TARGET_SEASON_ID,
        // Only include logs where the guild had significant participation
        hasSignificantParticipation: true,
        // Only include logs where player count is greater than 0
        players: { gt: 0 }
      },
      select: {
        battleId: true,
        guildId: true,
        guildName: true,
        players: true,
        processedAt: true,
        isPrimeTime: true
      },
      orderBy: { processedAt: 'asc' }
    });

    logger.info(`📈 Found ${mmrLogs.length} MMR calculation logs`);

    // Get battle data to determine exact battle times
    logger.info('⚔️ Fetching battle data...');
    const battleIds = [...new Set(mmrLogs.map(log => log.battleId))];
    const battles = await prisma.battle.findMany({
      where: {
        albionId: { in: battleIds }
      },
      select: {
        albionId: true,
        startedAt: true
      }
    });

    const battleTimeMap = new Map<bigint, Date>();
    battles.forEach(battle => {
      battleTimeMap.set(battle.albionId, battle.startedAt);
    });

    logger.info(`🗓️ Found ${battles.length} battles`);

    // Create a map of guild ID to guild season ID
    const guildIdToSeasonIdMap = new Map<string, string>();
    guildSeasons.forEach(gs => {
      guildIdToSeasonIdMap.set(gs.guildId, gs.id);
    });

    // Calculate correct mass data for each guild and prime time window
    const guildMassDataMap = new Map<string, GuildMassData>();

    logger.info('🧮 Calculating correct mass averages...');
    let processedLogs = 0;
    let primeTimeLogs = 0;

    for (const mmrLog of mmrLogs) {
      processedLogs++;
      
      if (processedLogs % 1000 === 0) {
        logger.info(`  Processed ${processedLogs}/${mmrLogs.length} logs...`);
      }

      const battleTime = battleTimeMap.get(mmrLog.battleId);
      if (!battleTime) {
        logger.warn(`⚠️ Battle time not found for battle ${mmrLog.battleId}`);
        continue;
      }

      const guildSeasonId = guildIdToSeasonIdMap.get(mmrLog.guildId);
      if (!guildSeasonId) {
        logger.warn(`⚠️ Guild season not found for guild ${mmrLog.guildId}`);
        continue;
      }

      const battleHour = battleTime.getUTCHours();

      // Check which prime time window this battle falls into
      for (const primeTimeWindow of primeTimeWindows) {
        if (isBattleInPrimeTimeWindow(battleHour, primeTimeWindow)) {
          primeTimeLogs++;
          
          const key = `${guildSeasonId}_${primeTimeWindow.id}`;
          
          if (!guildMassDataMap.has(key)) {
            guildMassDataMap.set(key, {
              guildSeasonId,
              primeTimeWindowId: primeTimeWindow.id,
              totalMass: 0,
              battleCount: 0,
              avgMass: 0,
              lastBattleAt: battleTime
            });
          }

          const massData = guildMassDataMap.get(key)!;
          massData.totalMass += mmrLog.players;
          massData.battleCount++;
          massData.avgMass = massData.totalMass / massData.battleCount;
          
          if (battleTime > massData.lastBattleAt) {
            massData.lastBattleAt = battleTime;
          }

          // Only count the battle once per guild (first matching window)
          break;
        }
      }
    }

    logger.info(`✅ Processed ${processedLogs} logs, found ${primeTimeLogs} prime time battles`);
    logger.info(`📊 Calculated mass data for ${guildMassDataMap.size} guild-window combinations`);

    if (guildMassDataMap.size === 0) {
      logger.warn('⚠️ No prime time mass data found. This could mean:');
      logger.warn('   - No battles occurred during prime time windows');
      logger.warn('   - All battles were filtered out due to insignificant participation');
      logger.warn('   - The prime time windows don\'t match any battle times');
      logger.warn('   - There are no MMR calculation logs for this season');
      return;
    }

    // Show some statistics before applying changes
    logger.info('\n📈 Sample of calculated mass data:');
    let sampleCount = 0;
    for (const [key, massData] of guildMassDataMap) {
      if (sampleCount < 5) {
        const guildSeason = guildSeasons.find(gs => gs.id === massData.guildSeasonId);
        const window = primeTimeWindows.find(w => w.id === massData.primeTimeWindowId);
        logger.info(`  ${guildSeason?.guild.name || 'Unknown'} (${window?.startHour}:00-${window?.endHour}:00): ${massData.avgMass.toFixed(2)} avg players (${massData.battleCount} battles)`);
        sampleCount++;
      } else {
        break;
      }
    }

    if (isDryRun) {
      logger.info('\n🔍 DRY RUN COMPLETE - No changes were made');
      logger.info(`📊 Would have processed ${guildMassDataMap.size} guild-window combinations`);
      return;
    }

    // Ask for confirmation (in a real script you might want to add this)
    logger.info('\n⚠️ This will delete and recreate all guildprimetimemass records for the target season.');
    logger.info('🔄 Starting repair process...');

    // Delete existing records for the target season
    const guildSeasonIds = guildSeasons.map(gs => gs.id);
    
    // First, check how many records exist
    const existingCount = await prisma.guildPrimeTimeMass.count({
      where: {
        guildSeasonId: { in: guildSeasonIds }
      }
    });
    
    logger.info(`🔍 Found ${existingCount} existing guildprimetimemass records to delete`);
    
    const deletedCount = await prisma.guildPrimeTimeMass.deleteMany({
      where: {
        guildSeasonId: { in: guildSeasonIds }
      }
    });

    logger.info(`🗑️ Deleted ${deletedCount.count} existing guildprimetimemass records`);

    // Insert corrected records in batches for better performance
    const recordsToCreate = Array.from(guildMassDataMap.values());
    let createdCount = 0;

    logger.info(`📝 Creating ${recordsToCreate.length} corrected records...`);

    // Process in batches of 50 for better performance
    const batchSize = 50;
    for (let i = 0; i < recordsToCreate.length; i += batchSize) {
      const batch = recordsToCreate.slice(i, i + batchSize);
      
      try {
        await prisma.guildPrimeTimeMass.createMany({
          data: batch.map(massData => ({
            guildSeasonId: massData.guildSeasonId,
            primeTimeWindowId: massData.primeTimeWindowId,
            avgMass: massData.avgMass,
            battleCount: massData.battleCount,
            lastBattleAt: massData.lastBattleAt
          }))
        });
        createdCount += batch.length;
        
        if (createdCount % 100 === 0 || createdCount === recordsToCreate.length) {
          logger.info(`  Created ${createdCount}/${recordsToCreate.length} records...`);
        }
      } catch (error) {
        logger.error(`❌ Error creating batch ${i}-${i + batch.length}:`, error);
        // Fallback to individual creates for this batch
        for (const massData of batch) {
          try {
            await prisma.guildPrimeTimeMass.create({
              data: {
                guildSeasonId: massData.guildSeasonId,
                primeTimeWindowId: massData.primeTimeWindowId,
                avgMass: massData.avgMass,
                battleCount: massData.battleCount,
                lastBattleAt: massData.lastBattleAt
              }
            });
            createdCount++;
          } catch (individualError) {
            logger.error('❌ Error creating individual record:', individualError);
          }
        }
      }
    }

    logger.info(`✅ Successfully created ${createdCount} corrected guildprimetimemass records`);

    // Verify the repair by showing some final statistics
    const finalRecords = await prisma.guildPrimeTimeMass.findMany({
      where: {
        guildSeasonId: { in: guildSeasonIds }
      },
      include: {
        guildSeason: { include: { guild: true } },
        primeTimeWindow: true
      },
      orderBy: [
        { avgMass: 'desc' }
      ],
      take: 10
    });

    logger.info('\n🏆 Top 10 guilds by average mass after repair:');
    finalRecords.forEach((record, index) => {
      logger.info(`  ${index + 1}. ${record.guildSeason.guild.name} (${record.primeTimeWindow.startHour}:00-${record.primeTimeWindow.endHour}:00): ${record.avgMass.toFixed(2)} avg players (${record.battleCount} battles)`);
    });

    logger.info('\n🎉 Repair completed successfully!');

  } catch (error) {
    logger.error('❌ Error during repair:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the repair
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
