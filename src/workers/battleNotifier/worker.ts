import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { log } from '../../log.js';
import { BattleDetail } from '../../types/albion.js';
import { TrackingService } from '../../services/tracking.js';
import { discordService } from '../../services/discord.js';
import { getBattleDetail } from '../../http/client.js';

const logger = log.child({ component: 'battle-notifier-worker' });

export interface BattleNotificationJob {
  battleId: string;
}

export class BattleNotifierWorker {
  private trackingService: TrackingService;

  constructor(prisma: PrismaClient) {
    this.trackingService = new TrackingService(prisma);
  }

  /**
   * Process a battle notification job
   */
  async processJob(job: Job<BattleNotificationJob>): Promise<void> {
    const { battleId } = job.data;
    const battleIdBigInt = BigInt(battleId);
    
    logger.info({
      message: 'Processing battle notification job',
      battleId: battleId,
      jobId: job.id
    });

    try {
      // Get battle details
      const battleDetail = await getBattleDetail(battleIdBigInt);
      if (!battleDetail) {
        logger.warn({
          message: 'Battle details not found',
          battleId: battleId
        });
        return;
      }

      // Get all active tracking subscriptions
      const subscriptions = await this.trackingService.getActiveSubscriptions();
      
      if (subscriptions.length === 0) {
        logger.debug({
          message: 'No active tracking subscriptions found',
          battleId: battleId
        });
        return;
      }

      // Process each subscription
      const notificationPromises = subscriptions.map(subscription =>
        this.processSubscription(battleDetail, subscription)
      );

      await Promise.allSettled(notificationPromises);

      logger.info({
        message: 'Battle notification processing completed',
        battleId: battleId,
        subscriptionCount: subscriptions.length
      });

    } catch (error) {
      logger.error({
        message: 'Failed to process battle notification job',
        error: error instanceof Error ? error.message : String(error),
        battleId: battleId,
        jobId: job.id
      });
      throw error;
    }
  }

  /**
   * Process a single subscription for a battle
   */
  private async processSubscription(
    battleDetail: BattleDetail,
    subscription: any
  ): Promise<void> {
    try {
      // Check if battle meets criteria
      if (!this.trackingService.checkBattleCriteria(battleDetail, subscription)) {
        logger.debug({
          message: 'Battle does not meet subscription criteria',
          subscriptionId: subscription.id,
          entityName: subscription.entityName,
          battleId: battleDetail.albionId.toString()
        });
        return;
      }

      // Analyze battle for this entity
      const guildStats = await this.trackingService.analyzeBattleForEntity(
        battleDetail,
        subscription.entityName,
        subscription.entityType
      );

      if (!guildStats) {
        logger.debug({
          message: 'Entity not found in battle',
          subscriptionId: subscription.id,
          entityName: subscription.entityName,
          entityType: subscription.entityType,
          battleId: battleDetail.albionId.toString()
        });
        return;
      }

      // Get or create counter history
      const counterHistoryId = await this.trackingService.getActiveCounterHistory(subscription.id);

      // Record battle result
      await this.trackingService.recordBattleResult(
        subscription.id,
        counterHistoryId,
        battleDetail.albionId,
        guildStats
      );

      // Get current counter stats
      const counterStats = await this.trackingService.getCounterStats(subscription.id);
      if (!counterStats) {
        logger.error({
          message: 'Failed to get counter stats for notification',
          subscriptionId: subscription.id
        });
        return;
      }

      // Send Discord notification
      try {
        await discordService.sendErrorAlert({
          category: 'api_error' as any,
          severity: 'low' as any,
          title: `🏆 Battle Alert: ${subscription.entityName}`,
          description: `Battle ${battleDetail.albionId} meets your tracking criteria!`,
          details: {
            entityName: subscription.entityName,
            entityType: subscription.entityType,
            battleId: battleDetail.albionId.toString(),
            guildStats: guildStats,
            counterStats: counterStats
          },
          timestamp: new Date(),
          battleId: battleDetail.albionId.toString()
        });

        logger.info({
          message: 'Battle notification sent successfully',
          subscriptionId: subscription.id,
          entityName: subscription.entityName,
          battleId: battleDetail.albionId.toString()
        });
      } catch (error) {
        logger.error({
          message: 'Failed to send battle notification',
          error: error instanceof Error ? error.message : String(error),
          subscriptionId: subscription.id,
          entityName: subscription.entityName,
          battleId: battleDetail.albionId.toString()
        });
      }

    } catch (error) {
      logger.error({
        message: 'Failed to process subscription',
        error: error instanceof Error ? error.message : String(error),
        subscriptionId: subscription.id,
        entityName: subscription.entityName,
        battleId: battleDetail.albionId.toString()
      });
    }
  }
}
