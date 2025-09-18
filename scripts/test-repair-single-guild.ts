/**
 * Test script to repair guildprimetimemass for a single guild: H_6bNjI7TUWxzAk2ZlHcEA
 * Season: cmfis69u30000sh35k5u88g65
 * 
 * This script tests the repair logic on just one guild to verify it works correctly
 * before running the full repair script.
 * 
 * Usage: 
 *   yarn tsx scripts/test-repair-single-guild.ts           # Run the repair for test guild
 *   yarn tsx scripts/test-repair-single-guild.ts --dry-run # Preview changes without modifying database
 */

import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const logger = log.child({ component: 'test-repair-single-guild' });

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
const TEST_GUILD_ID = 'H_6bNjI7TUWxzAk2ZlHcEA';

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

    // Verify the test guild exists
    const testGuild = await prisma.guild.findUnique({
      where: { id: TEST_GUILD_ID }
    });

    if (!testGuild) {
      logger.error(`❌ Test guild ${TEST_GUILD_ID} not found`);
      
      // Show some available guilds in the season for reference
      const availableGuilds = await prisma.guildSeason.findMany({
        where: { seasonId: TARGET_SEASON_ID },
        include: { guild: true },
        take: 10
      });
      
      logger.info('📋 Available guilds in this season:');
      availableGuilds.forEach(gs => {
        logger.info(`  - ${gs.guild.name} (ID: ${gs.guildId})`);
      });
      
      process.exit(1);
    }

    logger.info(`🏰 Test guild: ${testGuild.name} (${TEST_GUILD_ID})`);

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

    // Get the guild season for the test guild
    const guildSeason = await prisma.guildSeason.findUnique({
      where: { 
        guildId_seasonId: { 
          guildId: TEST_GUILD_ID, 
          seasonId: TARGET_SEASON_ID 
        } 
      },
      include: { guild: true }
    });

    if (!guildSeason) {
      logger.error(`❌ Guild season not found for guild ${TEST_GUILD_ID} in season ${TARGET_SEASON_ID}`);
      process.exit(1);
    }

    logger.info(`✅ Found guild season: ${guildSeason.id}`);

    // Get all MMR calculation logs for the test guild in the target season
    logger.info('📊 Fetching MMR calculation logs for test guild...');
    const mmrLogs = await prisma.mmrCalculationLog.findMany({
      where: { 
        seasonId: TARGET_SEASON_ID,
        guildId: TEST_GUILD_ID,
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

    logger.info(`📈 Found ${mmrLogs.length} MMR calculation logs for test guild`);

    if (mmrLogs.length === 0) {
      logger.warn('⚠️ No MMR calculation logs found for the test guild. Cannot proceed.');
      return;
    }

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

    logger.info(`🗓️ Found ${battles.length} battles for test guild`);

    // Calculate correct mass data for the test guild and prime time windows
    const guildMassDataMap = new Map<string, GuildMassData>();

    logger.info('🧮 Calculating correct mass averages for test guild...');
    let processedLogs = 0;
    let primeTimeLogs = 0;

    for (const mmrLog of mmrLogs) {
      processedLogs++;
      
      const battleTime = battleTimeMap.get(mmrLog.battleId);
      if (!battleTime) {
        logger.warn(`⚠️ Battle time not found for battle ${mmrLog.battleId}`);
        continue;
      }

      const battleHour = battleTime.getUTCHours();

      logger.debug(`🕐 Battle ${mmrLog.battleId}: ${battleTime.toISOString()} (Hour: ${battleHour}, Players: ${mmrLog.players})`);

      // Check which prime time window this battle falls into
      for (const primeTimeWindow of primeTimeWindows) {
        if (isBattleInPrimeTimeWindow(battleHour, primeTimeWindow)) {
          primeTimeLogs++;
          
          logger.debug(`✅ Battle ${mmrLog.battleId} falls in prime time window ${primeTimeWindow.startHour}:00-${primeTimeWindow.endHour}:00`);
          
          const key = `${guildSeason.id}_${primeTimeWindow.id}`;
          
          if (!guildMassDataMap.has(key)) {
            guildMassDataMap.set(key, {
              guildSeasonId: guildSeason.id,
              primeTimeWindowId: primeTimeWindow.id,
              totalMass: 0,
              battleCount: 0,
              avgMass: 0,
              lastBattleAt: battleTime
            });
            logger.debug(`🆕 Created new mass data entry for window ${primeTimeWindow.startHour}:00-${primeTimeWindow.endHour}:00`);
          }

          const massData = guildMassDataMap.get(key)!;
          const oldTotal = massData.totalMass;
          const oldCount = massData.battleCount;
          const oldAvg = massData.avgMass;
          
          massData.totalMass += mmrLog.players;
          massData.battleCount++;
          massData.avgMass = massData.totalMass / massData.battleCount;
          
          logger.debug(`📊 Updated mass data: ${oldTotal}+${mmrLog.players}=${massData.totalMass}, battles: ${oldCount}+1=${massData.battleCount}, avg: ${oldAvg.toFixed(2)} → ${massData.avgMass.toFixed(2)}`);
          
          if (battleTime > massData.lastBattleAt) {
            massData.lastBattleAt = battleTime;
          }

          // Only count the battle once per guild (first matching window)
          break;
        }
      }
    }

    logger.info(`✅ Processed ${processedLogs} logs, found ${primeTimeLogs} prime time battles for test guild`);
    logger.info(`📊 Calculated mass data for ${guildMassDataMap.size} prime time windows`);

    if (guildMassDataMap.size === 0) {
      logger.warn('⚠️ No prime time mass data found for test guild. This could mean:');
      logger.warn('   - No battles occurred during prime time windows');
      logger.warn('   - All battles were filtered out due to insignificant participation');
      logger.warn('   - The prime time windows don\'t match any battle times');
      return;
    }

    // Show detailed calculated mass data
    logger.info('\n📈 Calculated mass data for test guild:');
    for (const [key, massData] of guildMassDataMap) {
      const window = primeTimeWindows.find(w => w.id === massData.primeTimeWindowId);
      logger.info(`  ${testGuild.name} (${window?.startHour}:00-${window?.endHour}:00): ${massData.avgMass.toFixed(2)} avg players (${massData.battleCount} battles, total: ${massData.totalMass})`);
    }

    // Show current database state for comparison
    logger.info('\n🔍 Current database state for test guild:');
    const currentRecords = await prisma.guildPrimeTimeMass.findMany({
      where: {
        guildSeasonId: guildSeason.id
      },
      include: {
        primeTimeWindow: true
      }
    });

    if (currentRecords.length === 0) {
      logger.info('  No existing guildprimetimemass records found');
    } else {
      currentRecords.forEach(record => {
        logger.info(`  ${testGuild.name} (${record.primeTimeWindow.startHour}:00-${record.primeTimeWindow.endHour}:00): ${record.avgMass.toFixed(2)} avg players (${record.battleCount} battles) [CURRENT]`);
      });
    }

    if (isDryRun) {
      logger.info('\n🔍 DRY RUN COMPLETE - No changes were made');
      logger.info(`📊 Would have processed ${guildMassDataMap.size} prime time windows for test guild`);
      return;
    }

    // Apply the changes for the test guild
    logger.info('\n⚠️ This will delete and recreate guildprimetimemass records for the test guild.');
    logger.info('🔄 Starting repair process for test guild...');

    // Delete existing records for the test guild
    const deletedCount = await prisma.guildPrimeTimeMass.deleteMany({
      where: {
        guildSeasonId: guildSeason.id
      }
    });

    logger.info(`🗑️ Deleted ${deletedCount.count} existing guildprimetimemass records for test guild`);

    // Insert corrected records
    const recordsToCreate = Array.from(guildMassDataMap.values());
    let createdCount = 0;

    logger.info(`📝 Creating ${recordsToCreate.length} corrected records for test guild...`);

    for (const massData of recordsToCreate) {
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
        
        const window = primeTimeWindows.find(w => w.id === massData.primeTimeWindowId);
        logger.info(`  ✅ Created record for ${window?.startHour}:00-${window?.endHour}:00: ${massData.avgMass.toFixed(2)} avg players`);
      } catch (error) {
        logger.error('❌ Error creating record:', error);
      }
    }

    logger.info(`✅ Successfully created ${createdCount} corrected guildprimetimemass records for test guild`);

    // Verify the repair by showing final state
    const finalRecords = await prisma.guildPrimeTimeMass.findMany({
      where: {
        guildSeasonId: guildSeason.id
      },
      include: {
        primeTimeWindow: true
      },
      orderBy: [
        { primeTimeWindow: { startHour: 'asc' } }
      ]
    });

    logger.info('\n🏆 Final state after repair:');
    finalRecords.forEach(record => {
      logger.info(`  ${testGuild.name} (${record.primeTimeWindow.startHour}:00-${record.primeTimeWindow.endHour}:00): ${record.avgMass.toFixed(2)} avg players (${record.battleCount} battles) [REPAIRED]`);
    });

    logger.info('\n🎉 Test repair completed successfully!');
    logger.info('💡 If the results look correct, you can now run the full repair script.');

  } catch (error) {
    console.error('❌ Detailed error:', error);
    logger.error('❌ Error during test repair:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      error
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test repair
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
