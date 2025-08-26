import { PrismaClient } from '@prisma/client';
import { log } from '../log.js';
import { BattleDetail, GuildBattleStats, TrackingSubscription } from '../types/albion.js';

const logger = log.child({ component: 'tracking-service' });

export class TrackingService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get all active tracking subscriptions
   */
  async getActiveSubscriptions(): Promise<TrackingSubscription[]> {
    try {
      const subscriptions = await this.prisma.trackingSubscription.findMany({
        where: { isActive: true }
      });

      logger.debug({
        message: 'Retrieved active tracking subscriptions',
        count: subscriptions.length
      });

      return subscriptions;
    } catch (error) {
      logger.error({
        message: 'Failed to get active subscriptions',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get subscriptions that match a specific entity
   */
  async getSubscriptionsForEntity(entityName: string, entityType: 'GUILD' | 'ALLIANCE'): Promise<TrackingSubscription[]> {
    try {
      const subscriptions = await this.prisma.trackingSubscription.findMany({
        where: {
          entityName,
          entityType,
          isActive: true
        }
      });

      logger.debug({
        message: 'Retrieved subscriptions for entity',
        entityName,
        entityType,
        count: subscriptions.length
      });

      return subscriptions;
    } catch (error) {
      logger.error({
        message: 'Failed to get subscriptions for entity',
        error: error instanceof Error ? error.message : String(error),
        entityName,
        entityType
      });
      throw error;
    }
  }

  /**
   * Analyze battle for guild/alliance participation and determine win/loss
   */
  async analyzeBattleForEntity(
    battleDetail: BattleDetail,
    entityName: string,
    entityType: 'GUILD' | 'ALLIANCE'
  ): Promise<GuildBattleStats | null> {
    try {
      // Find the entity in the battle (case-insensitive comparison)
      const entityData = entityType === 'GUILD' 
        ? battleDetail.guilds.find(g => g.name && g.name.toLowerCase() === entityName.toLowerCase())
        : battleDetail.alliances.find(a => a.name && a.name.toLowerCase() === entityName.toLowerCase());

      if (!entityData) {
        logger.debug({
          message: 'Entity not found in battle',
          entityName,
          entityType,
          battleId: battleDetail.albionId.toString()
        });
        return null;
      }

      // Get kill events from database to determine win/loss
      const killEvents = await this.prisma.killEvent.findMany({
        where: { battleAlbionId: battleDetail.albionId },
        orderBy: { TimeStamp: 'asc' }
      });
      
      // Count kills and deaths for this entity
      let kills = 0;
      let deaths = 0;

      for (const killEvent of killEvents) {
        const killerEntity = entityType === 'GUILD' 
          ? killEvent.killerGuild 
          : killEvent.killerAlliance;
        
        const victimEntity = entityType === 'GUILD' 
          ? killEvent.victimGuild 
          : killEvent.victimAlliance;

        if (killerEntity?.toLocaleLowerCase() === entityName.toLocaleLowerCase()) {
          kills++;
        }
        if (victimEntity?.toLocaleLowerCase() === entityName.toLocaleLowerCase()) {
          deaths++;
        }
      }

      // Determine win/loss (more kills than deaths = win)
      const isWin = kills > deaths;

      const stats: GuildBattleStats = {
        entityName,
        entityType,
        totalFame: battleDetail.totalFame,
        totalKills: battleDetail.totalKills,
        totalPlayers: battleDetail.totalPlayers,
        kills,
        deaths,
        isWin
      };

      logger.info({
        message: 'Battle analysis completed',
        entityName,
        entityType,
        battleId: battleDetail.albionId.toString(),
        kills,
        deaths,
        isWin,
        totalFame: battleDetail.totalFame
      });

      return stats;
    } catch (error) {
      logger.error({
        message: 'Failed to analyze battle for entity',
        error: error instanceof Error ? error.message : String(error),
        entityName,
        entityType,
        battleId: battleDetail.albionId.toString()
      });
      return null;
    }
  }

  /**
   * Check if battle meets subscription criteria
   */
  checkBattleCriteria(
    battleDetail: BattleDetail,
    subscription: TrackingSubscription
  ): boolean {
    const meetsFame = battleDetail.totalFame >= subscription.minTotalFame;
    const meetsKills = battleDetail.totalKills >= subscription.minTotalKills;
    const meetsPlayers = battleDetail.totalPlayers >= subscription.minTotalPlayers;

    const meetsCriteria = meetsFame && meetsKills && meetsPlayers;

    logger.debug({
      message: 'Checked battle criteria',
      subscriptionId: subscription.id,
      entityName: subscription.entityName,
      battleId: battleDetail.albionId.toString(),
      totalFame: battleDetail.totalFame,
      totalKills: battleDetail.totalKills,
      totalPlayers: battleDetail.totalPlayers,
      minFame: subscription.minTotalFame,
      minKills: subscription.minTotalKills,
      minPlayers: subscription.minTotalPlayers,
      meetsCriteria
    });

    return meetsCriteria;
  }

  /**
   * Get or create active counter history for subscription
   */
  async getActiveCounterHistory(subscriptionId: string): Promise<string> {
    try {
      let counterHistory = await this.prisma.counterHistory.findFirst({
        where: {
          subscriptionId,
          isActive: true
        }
      });

      if (!counterHistory) {
        // Create new counter history
        const periodName = `Period ${new Date().toISOString().split('T')[0]}`;
        
        counterHistory = await this.prisma.counterHistory.create({
          data: {
            subscriptionId,
            periodName,
            startDate: new Date(),
            totalWins: 0,
            totalLosses: 0,
            totalKills: 0,
            totalDeaths: 0,
            isActive: true
          }
        });

        logger.info({
          message: 'Created new counter history',
          subscriptionId,
          counterHistoryId: counterHistory.id,
          periodName
        });
      }

      return counterHistory.id;
    } catch (error) {
      logger.error({
        message: 'Failed to get or create counter history',
        error: error instanceof Error ? error.message : String(error),
        subscriptionId
      });
      throw error;
    }
  }

  /**
   * Record battle result and update counter
   */
  async recordBattleResult(
    subscriptionId: string,
    counterHistoryId: string,
    battleId: bigint,
    guildStats: GuildBattleStats
  ): Promise<void> {
    try {
      // Create battle result record
      await this.prisma.battleResult.create({
        data: {
          subscriptionId,
          counterHistoryId,
          battleAlbionId: battleId,
          isWin: guildStats.isWin,
          kills: guildStats.kills,
          deaths: guildStats.deaths,
          totalFame: guildStats.totalFame,
          totalPlayers: guildStats.totalPlayers
        }
      });

      // Update counter history
      const updateData = guildStats.isWin
        ? { totalWins: { increment: 1 } }
        : { totalLosses: { increment: 1 } };

      await this.prisma.counterHistory.update({
        where: { id: counterHistoryId },
        data: {
          ...updateData,
          totalKills: { increment: guildStats.kills },
          totalDeaths: { increment: guildStats.deaths }
        }
      });

      logger.info({
        message: 'Battle result recorded',
        subscriptionId,
        counterHistoryId,
        battleId: battleId.toString(),
        isWin: guildStats.isWin,
        kills: guildStats.kills,
        deaths: guildStats.deaths
      });
    } catch (error) {
      logger.error({
        message: 'Failed to record battle result',
        error: error instanceof Error ? error.message : String(error),
        subscriptionId,
        counterHistoryId,
        battleId: battleId.toString()
      });
      throw error;
    }
  }

  /**
   * Get current counter stats for subscription
   */
  async getCounterStats(subscriptionId: string): Promise<{
    wins: number;
    losses: number;
    kills: number;
    deaths: number;
  } | null> {
    try {
      const counterHistory = await this.prisma.counterHistory.findFirst({
        where: {
          subscriptionId,
          isActive: true
        }
      });

      if (!counterHistory) {
        return null;
      }

      return {
        wins: counterHistory.totalWins,
        losses: counterHistory.totalLosses,
        kills: counterHistory.totalKills,
        deaths: counterHistory.totalDeaths
      };
    } catch (error) {
      logger.error({
        message: 'Failed to get counter stats',
        error: error instanceof Error ? error.message : String(error),
        subscriptionId
      });
      return null;
    }
  }

  /**
   * Reset counter for subscription (end current period and start new one)
   */
  async resetCounter(subscriptionId: string): Promise<string> {
    try {
      // End current active counter
      await this.prisma.counterHistory.updateMany({
        where: {
          subscriptionId,
          isActive: true
        },
        data: {
          isActive: false,
          endDate: new Date()
        }
      });

      // Create new counter
      const periodName = `Period ${new Date().toISOString().split('T')[0]}`;
      
      const newCounter = await this.prisma.counterHistory.create({
        data: {
          subscriptionId,
          periodName,
          startDate: new Date(),
          totalWins: 0,
          totalLosses: 0,
          totalKills: 0,
          totalDeaths: 0,
          isActive: true
        }
      });

      logger.info({
        message: 'Counter reset completed',
        subscriptionId,
        newCounterId: newCounter.id,
        periodName
      });

      return newCounter.id;
    } catch (error) {
      logger.error({
        message: 'Failed to reset counter',
        error: error instanceof Error ? error.message : String(error),
        subscriptionId
      });
      throw error;
    }
  }
}
