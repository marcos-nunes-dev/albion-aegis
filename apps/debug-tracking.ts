import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';


const logger = log.child({ component: 'debug-tracking' });
const prisma = new PrismaClient();

async function debugTracking() {
  try {
    logger.info('Starting tracking debug...');

    // Check ALL subscriptions (not just active)
    const allSubscriptions = await prisma.trackingSubscription.findMany();
    
    logger.info({
      message: 'All subscriptions found',
      count: allSubscriptions.length,
      subscriptions: allSubscriptions.map(sub => ({
        id: sub.id,
        userId: sub.userId,
        entityName: sub.entityName,
        entityType: sub.entityType,
        minTotalFame: sub.minTotalFame,
        minTotalKills: sub.minTotalKills,
        minTotalPlayers: sub.minTotalPlayers,
        isActive: sub.isActive,
        createdAt: sub.createdAt
      }))
    });

    // Check active subscriptions specifically
    const activeSubscriptions = await prisma.trackingSubscription.findMany({
      where: { isActive: true }
    });
    
    logger.info({
      message: 'Active subscriptions found',
      count: activeSubscriptions.length
    });

    // Check counter histories
    const counterHistories = await prisma.counterHistory.findMany({
      include: { subscription: true }
    });

    logger.info({
      message: 'All counter histories found',
      count: counterHistories.length,
      histories: counterHistories.map(ch => ({
        id: ch.id,
        subscriptionId: ch.subscriptionId,
        entityName: ch.subscription.entityName,
        periodName: ch.periodName,
        isActive: ch.isActive,
        totalWins: ch.totalWins,
        totalLosses: ch.totalLosses,
        totalKills: ch.totalKills,
        totalDeaths: ch.totalDeaths
      }))
    });

    // Check recent battle results
    const recentBattleResults = await prisma.battleResult.findMany({
      take: 10,
      orderBy: { processedAt: 'desc' },
      include: { subscription: true }
    });

    logger.info({
      message: 'Recent battle results found',
      count: recentBattleResults.length,
      results: recentBattleResults.map(br => ({
        id: br.id,
        subscriptionId: br.subscriptionId,
        entityName: br.subscription.entityName,
        battleAlbionId: br.battleAlbionId.toString(),
        isWin: br.isWin,
        kills: br.kills,
        deaths: br.deaths,
        processedAt: br.processedAt
      }))
    });

    // Check if there are any recent battles in the database
    const recentBattles = await prisma.battle.findMany({
      take: 5,
      orderBy: { ingestedAt: 'desc' }
    });

    logger.info({
      message: 'Recent battles found',
      count: recentBattles.length,
      battles: recentBattles.map(b => ({
        albionId: b.albionId.toString(),
        totalFame: b.totalFame,
        totalKills: b.totalKills,
        totalPlayers: b.totalPlayers,
        ingestedAt: b.ingestedAt
      }))
    });

  } catch (error) {
    logger.error({
      message: 'Debug failed',
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await prisma.$disconnect();
  }
}

debugTracking();
