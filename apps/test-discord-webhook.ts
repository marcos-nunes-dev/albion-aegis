import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';
import { DiscordWebhookService } from '../src/services/discord.js';

const logger = log.child({ component: 'test-discord-webhook' });
const prisma = new PrismaClient();

async function testDiscordWebhook() {
  try {
    logger.info('Testing Discord webhook...');

    // Get a subscription with a webhook
    const subscription = await prisma.trackingSubscription.findFirst({
      where: { isActive: true }
    });

    if (!subscription) {
      logger.error('No active subscription found');
      return;
    }

    logger.info({
      message: 'Found subscription to test',
      entityName: subscription.entityName,
      webhookUrl: subscription.discordWebhook.substring(0, 50) + '...'
    });

    // Test the webhook connection
    const discordService = new DiscordWebhookService(subscription.discordWebhook);
    
    logger.info('Testing webhook connection...');
    const connectionTest = await discordService.testConnection();
    
    logger.info({
      message: 'Webhook connection test result',
      success: connectionTest
    });

    if (connectionTest) {
      // Test sending a notification
      logger.info('Testing notification send...');
      
      const mockStats = {
        entityName: subscription.entityName,
        entityType: subscription.entityType,
        totalFame: 1000000,
        totalKills: 10,
        totalPlayers: 20,
        kills: 5,
        deaths: 2,
        isWin: true
      };

      const mockCounterStats = {
        wins: 3,
        losses: 1,
        kills: 15,
        deaths: 5
      };

      const success = await discordService.sendBattleNotification(
        BigInt('1265121608'),
        mockStats,
        mockCounterStats
      );

      logger.info({
        message: 'Notification send test result',
        success
      });
    }

    discordService.destroy();

  } catch (error) {
    logger.error({
      message: 'Discord webhook test failed',
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await prisma.$disconnect();
  }
}

testDiscordWebhook();
