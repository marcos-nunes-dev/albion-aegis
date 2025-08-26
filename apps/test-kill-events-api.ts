import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';
import { getKillsForBattle } from '../src/http/client.js';
import { TrackingService } from '../src/services/tracking.js';

const logger = log.child({ component: 'test-kill-events-api' });
const prisma = new PrismaClient();

async function testKillEventsAPI() {
  try {
    logger.info('Testing kill events API fetching...');

    // Test with the battle ID from the user's example
    const battleId = BigInt('1265309537');
    
    logger.info({
      message: 'Testing kill events for battle',
      battleId: battleId.toString()
    });

    // Test direct API call
    const killEvents = await getKillsForBattle(battleId);
    
    logger.info({
      message: 'Kill events fetched from API',
      battleId: battleId.toString(),
      count: killEvents.length
    });

    // Log some sample kill events
    killEvents.slice(0, 3).forEach((event, index) => {
      logger.info({
        message: `Sample kill event ${index + 1}`,
        eventId: event.EventId.toString(),
        timestamp: event.TimeStamp,
        killer: {
          name: event.Killer.Name,
          guild: event.Killer.GuildName,
          alliance: event.Killer.AllianceName
        },
        victim: {
          name: event.Victim.Name,
          guild: event.Victim.GuildName,
          alliance: event.Victim.AllianceName
        }
      });
    });

    // Test the tracking service analysis
    const trackingService = new TrackingService(prisma);
    
    // Get a sample guild from the kill events
    const sampleGuild = killEvents.find(event => event.Killer.GuildName)?.Killer.GuildName;
    
    if (sampleGuild) {
      logger.info({
        message: 'Testing battle analysis for guild',
        guildName: sampleGuild
      });

      // We need battle details to test the analysis
      const { getBattleDetail } = await import('../src/http/client.js');
      const battleDetail = await getBattleDetail(battleId);
      
      if (battleDetail) {
        const guildStats = await trackingService.analyzeBattleForEntity(
          battleDetail,
          sampleGuild,
          'GUILD'
        );

        if (guildStats) {
          logger.info({
            message: 'Battle analysis completed',
            guildName: sampleGuild,
            kills: guildStats.kills,
            deaths: guildStats.deaths,
            isWin: guildStats.isWin,
            totalFame: guildStats.totalFame
          });
        } else {
          logger.warn({
            message: 'Guild not found in battle analysis',
            guildName: sampleGuild
          });
        }
      }
    }

  } catch (error) {
    logger.error({
      message: 'Kill events API test failed',
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await prisma.$disconnect();
  }
}

testKillEventsAPI();
