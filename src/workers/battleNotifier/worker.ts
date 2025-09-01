import { Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { log } from '../../log.js';
import { BattleDetail } from '../../types/albion.js';
import { TrackingService } from '../../services/tracking.js';
import { DiscordWebhookService } from '../../services/discord.js';
import { getBattleDetail } from '../../http/client.js';

const logger = log.child({ component: 'battle-notifier-worker' });

export interface BattleNotificationJob {
  battleId: string;
}

export class BattleNotifierWorker {
  private trackingService: TrackingService;
  private processedBattles: Map<string, number> = new Map(); // battleId -> timestamp
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
      // Check if we've already processed this battle recently (simple cache)
      const now = Date.now();
      const lastProcessed = this.processedBattles.get(battleId);
      if (lastProcessed && (now - lastProcessed) < this.CACHE_TTL) {
        logger.info({
          message: 'Battle processed recently, skipping',
          battleId: battleId,
          lastProcessed: new Date(lastProcessed),
          timeSinceLastProcessed: now - lastProcessed
        });
        return;
      }

      // Mark this battle as processed
      this.processedBattles.set(battleId, now);

      // Clean up old cache entries
      this.cleanupCache();

      // Fetch battle details
      const battleDetail = await getBattleDetail(battleIdBigInt);
      if (!battleDetail) {
        logger.warn({
          message: 'Failed to fetch battle details',
          battleId: battleId
        });
        return;
      }

      // Get all active subscriptions
      const subscriptions = await this.trackingService.getActiveSubscriptions();
      if (subscriptions.length === 0) {
        logger.info({
          message: 'No active subscriptions found',
          battleId: battleId
        });
        return;
      }

      // Process each subscription
      let processedCount = 0;
      for (const subscription of subscriptions) {
        try {
          await this.processSubscription(battleDetail, subscription);
          processedCount++;
        } catch (error) {
          logger.error({
            message: 'Failed to process subscription for battle',
            error: error instanceof Error ? error.message : String(error),
            subscriptionId: subscription.id,
            entityName: subscription.entityName,
            battleId: battleId
          });
        }
      }

      logger.info({
        message: 'Battle notification processing completed',
        battleId: battleId,
        subscriptionsProcessed: processedCount,
        totalSubscriptions: subscriptions.length
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
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [battleId, timestamp] of this.processedBattles.entries()) {
      if (now - timestamp > this.CACHE_TTL) {
        this.processedBattles.delete(battleId);
      }
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
      // Check if this battle has already been processed for this subscription
      const alreadyProcessed = await this.trackingService.hasBattleBeenProcessed(
        subscription.id, 
        battleDetail.albionId
      );
      
      if (alreadyProcessed) {
        logger.info({
          message: 'Battle already processed for subscription, skipping notification',
          subscriptionId: subscription.id,
          entityName: subscription.entityName,
          battleId: battleDetail.albionId.toString()
        });
        return;
      }

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
      const discordService = new DiscordWebhookService(subscription.discordWebhook);
      const success = await discordService.sendBattleNotification(
        battleDetail.albionId,
        guildStats,
        counterStats,
        battleDetail
      );

      if (success) {
        logger.info({
          message: 'Battle notification sent successfully',
          subscriptionId: subscription.id,
          entityName: subscription.entityName,
          battleId: battleDetail.albionId.toString()
        });
      } else {
        logger.error({
          message: 'Failed to send battle notification',
          subscriptionId: subscription.id,
          entityName: subscription.entityName,
          battleId: battleDetail.albionId.toString()
        });
      }

      // Clean up Discord service
      discordService.destroy();

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
