import { PrismaClient } from '@prisma/client';
import { getBattlesPage } from '../src/http/client.js';
import { discordService } from '../src/services/discord.js';
import { log } from '../src/log.js';

const logger = log.child({ component: 'monitor-missing-battles' });
const prisma = new PrismaClient();

async function monitorMissingBattles() {
  try {
    logger.info('🔍 Starting missing battles monitoring...');

    // Get recent battles from Albion API (last 2 pages)
    const recentBattles: string[] = [];
    
    for (let page = 0; page < 2; page++) {
      try {
        const battles = await getBattlesPage(page, 10); // minPlayers = 10
        battles.forEach(battle => {
          recentBattles.push(battle.albionId.toString());
        });
      } catch (error) {
        logger.error('Failed to fetch battles page', { page, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    logger.info(`📊 Found ${recentBattles.length} recent battles in Albion API`);

    // Check which battles are missing from database
    const missingBattles: string[] = [];
    
    for (const battleId of recentBattles) {
      try {
        const battle = await prisma.battle.findUnique({
          where: { albionId: BigInt(battleId) }
        });
        
        if (!battle) {
          missingBattles.push(battleId);
        }
      } catch (error) {
        logger.error('Failed to check battle in database', { battleId, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    logger.info(`❌ Found ${missingBattles.length} missing battles`);

    // Send Discord alerts for missing battles
    for (const battleId of missingBattles) {
      await discordService.trackMissingBattle(battleId, 'Battle exists in Albion API but not in database');
    }

    // Check for battles without kill events
    const battlesWithoutKills = await prisma.battle.findMany({
      where: {
        killsFetchedAt: null,
        startedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      take: 10
    });

    logger.info(`⚠️ Found ${battlesWithoutKills.length} battles without kill events`);

    // Send Discord alerts for battles without kills
    for (const battle of battlesWithoutKills) {
      await discordService.trackMissingBattle(
        battle.albionId.toString(), 
        'Battle exists in database but kills were never fetched'
      );
    }

    // Check system load
    const activeBattles = await prisma.battle.count({
      where: {
        startedAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000) // Last hour
        }
      }
    });

    // Get queue depths (you might need to implement this based on your queue system)
    const queueDepth = 0; // Placeholder - implement based on your queue monitoring

    await discordService.trackSystemLoad(activeBattles, queueDepth);

    logger.info('✅ Missing battles monitoring completed', {
      totalRecentBattles: recentBattles.length,
      missingBattles: missingBattles.length,
      battlesWithoutKills: battlesWithoutKills.length,
      activeBattles
    });

  } catch (error) {
    logger.error('Failed to monitor missing battles', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    await prisma.$disconnect();
  }
}

// Run monitoring
monitorMissingBattles();
