import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';

const logger = log.child({ component: 'debug-tracking' });
const prisma = new PrismaClient();

async function debugTracking() {
  try {
    logger.info('Debugging tracking system...');

    // Test database connection
    logger.info('Testing database connection...');
    await prisma.$connect();
    logger.info('Database connection successful');

    // Check if we have any battles
    const battleCount = await prisma.battle.count();
    logger.info({ message: 'Total battles in database', count: battleCount });

    // Check if we have any kill events
    const killEventCount = await prisma.killEvent.count();
    logger.info({ message: 'Total kill events in database', count: killEventCount });

    // Check if we have any tracking subscriptions
    const subscriptionCount = await prisma.trackingSubscription.count();
    logger.info({ message: 'Total tracking subscriptions', count: subscriptionCount });

    // Check if we have any battle results
    const battleResultCount = await prisma.battleResult.count();
    logger.info({ message: 'Total battle results', count: battleResultCount });

    // Get a few recent battles
    const recentBattles = await prisma.battle.findMany({
      take: 3,
      orderBy: { ingestedAt: 'desc' }
    });

    logger.info({
      message: 'Recent battles',
      battles: recentBattles.map(b => ({
        albionId: b.albionId.toString(),
        totalFame: b.totalFame,
        totalKills: b.totalKills,
        totalPlayers: b.totalPlayers,
        ingestedAt: b.ingestedAt
      }))
    });

    // Get a few recent kill events
    const recentKillEvents = await prisma.killEvent.findMany({
      take: 5,
      orderBy: { TimeStamp: 'desc' }
    });

    logger.info({
      message: 'Recent kill events',
      killEvents: recentKillEvents.map(ke => ({
        eventId: ke.EventId.toString(),
        battleAlbionId: ke.battleAlbionId?.toString() || 'null',
        killerGuild: ke.killerGuild,
        killerAlliance: ke.killerAlliance,
        victimGuild: ke.victimGuild,
        victimAlliance: ke.victimAlliance,
        timestamp: ke.TimeStamp
      }))
    });

    // Check tracking subscriptions
    const subscriptions = await prisma.trackingSubscription.findMany({
      where: { isActive: true }
    });

    logger.info({
      message: 'Active tracking subscriptions',
      subscriptions: subscriptions.map(s => ({
        id: s.id,
        entityName: s.entityName,
        entityType: s.entityType,
        minTotalFame: s.minTotalFame,
        minTotalKills: s.minTotalKills,
        minTotalPlayers: s.minTotalPlayers
      }))
    });

    // Test specific battle if we have one
    if (recentBattles.length > 0) {
      const testBattleId = recentBattles[0].albionId;
      logger.info({
        message: 'Testing specific battle',
        battleId: testBattleId.toString()
      });

      // Get kill events for this specific battle
      const battleKillEvents = await prisma.killEvent.findMany({
        where: { battleAlbionId: testBattleId },
        orderBy: { TimeStamp: 'asc' }
      });

      logger.info({
        message: 'Kill events for test battle',
        battleId: testBattleId.toString(),
        killEventCount: battleKillEvents.length,
        uniqueGuilds: [...new Set(battleKillEvents.map(ke => ke.killerGuild).filter(Boolean))],
        uniqueAlliances: [...new Set(battleKillEvents.map(ke => ke.killerAlliance).filter(Boolean))]
      });

      // Test PLVAS calculation
      const entityName = 'PLVAS';
      let kills = 0;
      let deaths = 0;

      for (const killEvent of battleKillEvents) {
        if (killEvent.killerGuild === entityName) {
          kills++;
        }
        if (killEvent.victimGuild === entityName) {
          deaths++;
        }
      }

      logger.info({
        message: 'PLVAS calculation test',
        entityName,
        kills,
        deaths,
        isWin: kills > deaths
      });
    }

  } catch (error) {
    logger.error({
      message: 'Debug failed',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  } finally {
    await prisma.$disconnect();
  }
}

debugTracking();
