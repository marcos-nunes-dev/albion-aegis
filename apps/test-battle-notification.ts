import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';
import { BattleNotifierWorker } from '../src/workers/battleNotifier/worker.js';
import { getBattleDetail } from '../src/http/client.js';

const logger = log.child({ component: 'test-battle-notification' });
const prisma = new PrismaClient();

async function testBattleNotification() {
  try {
    logger.info('Testing battle notification manually...');

    // Test with the battle that should have triggered
    const battleId = BigInt('1265121608');
    
    logger.info({
      message: 'Testing battle notification for',
      battleId: battleId.toString()
    });

    // Get battle details
    const battleDetail = await getBattleDetail(battleId);
    if (!battleDetail) {
      logger.error('Battle details not found');
      return;
    }

    logger.info({
      message: 'Battle details retrieved',
      totalFame: battleDetail.totalFame,
      totalKills: battleDetail.totalKills,
      totalPlayers: battleDetail.totalPlayers,
      guilds: battleDetail.guilds.map(g => g.name).filter(Boolean),
      alliances: battleDetail.alliances.map(a => a.name).filter(Boolean)
    });

    // Create worker and process manually
    const worker = new BattleNotifierWorker(prisma);
    
    // Get active subscriptions
    const subscriptions = await prisma.trackingSubscription.findMany({
      where: { isActive: true }
    });

    logger.info({
      message: 'Active subscriptions found',
      count: subscriptions.length,
      subscriptions: subscriptions.map(sub => ({
        id: sub.id,
        entityName: sub.entityName,
        entityType: sub.entityType,
        minTotalFame: sub.minTotalFame,
        minTotalKills: sub.minTotalKills,
        minTotalPlayers: sub.minTotalPlayers
      }))
    });

    // Process each subscription manually
    for (const subscription of subscriptions) {
      logger.info({
        message: 'Processing subscription',
        subscriptionId: subscription.id,
        entityName: subscription.entityName
      });

      // Check if battle meets criteria
      const meetsCriteria = battleDetail.totalFame >= subscription.minTotalFame &&
                           battleDetail.totalKills >= subscription.minTotalKills &&
                           battleDetail.totalPlayers >= subscription.minTotalPlayers;

      logger.info({
        message: 'Battle criteria check',
        meetsCriteria,
        totalFame: battleDetail.totalFame,
        minFame: subscription.minTotalFame,
        totalKills: battleDetail.totalKills,
        minKills: subscription.minTotalKills,
        totalPlayers: battleDetail.totalPlayers,
        minPlayers: subscription.minTotalPlayers
      });

      if (!meetsCriteria) {
        logger.info('Battle does not meet criteria, skipping');
        continue;
      }

      // Analyze battle for this entity
      const guildStats = await worker['trackingService'].analyzeBattleForEntity(
        battleDetail,
        subscription.entityName,
        subscription.entityType
      );

      if (!guildStats) {
        logger.info({
          message: 'Entity not found in battle',
          entityName: subscription.entityName,
          entityType: subscription.entityType
        });
        continue;
      }

      logger.info({
        message: 'Entity found in battle',
        entityName: subscription.entityName,
        kills: guildStats.kills,
        deaths: guildStats.deaths,
        isWin: guildStats.isWin
      });

      // Get or create counter history
      const counterHistoryId = await worker['trackingService'].getActiveCounterHistory(subscription.id);
      logger.info({
        message: 'Counter history ID',
        counterHistoryId
      });

      // Record battle result
      await worker['trackingService'].recordBattleResult(
        subscription.id,
        counterHistoryId,
        battleDetail.albionId,
        guildStats
      );

      logger.info('Battle result recorded');

      // Get current counter stats
      const counterStats = await worker['trackingService'].getCounterStats(subscription.id);
      if (!counterStats) {
        logger.error('Failed to get counter stats');
        continue;
      }

      logger.info({
        message: 'Counter stats',
        wins: counterStats.wins,
        losses: counterStats.losses,
        kills: counterStats.kills,
        deaths: counterStats.deaths
      });

      // Send Discord notification
      const { DiscordWebhookService } = await import('../src/services/discord.js');
      const discordService = new DiscordWebhookService(subscription.discordWebhook);
      
      const success = await discordService.sendBattleNotification(
        battleDetail.albionId,
        guildStats,
        counterStats
      );

      logger.info({
        message: 'Discord notification result',
        success
      });

      discordService.destroy();
    }

  } catch (error) {
    logger.error({
      message: 'Battle notification test failed',
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await prisma.$disconnect();
  }
}

testBattleNotification();
