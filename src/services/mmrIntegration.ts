import { PrismaClient } from '@prisma/client';
import { log } from '../log.js';
import { addMmrCalculationJob } from '../queue/mmrQueue.js';
import { BattleAnalysisService } from './battleAnalysis.js';

const logger = log.child({ component: 'mmr-integration' });

export class MmrIntegrationService {
  private prisma: PrismaClient;
  private battleAnalysisService: BattleAnalysisService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.battleAnalysisService = new BattleAnalysisService(prisma);
  }

  /**
   * Process battle for MMR calculation after battle and kills are saved
   * This should be called after your existing battle processing is complete
   */
  async processBattleForMmr(
    battleId: bigint,
    battleData: any,
    killsData: any[]
  ): Promise<void> {
    try {
      logger.info('Starting MMR processing for battle', {
        battleId: battleId.toString()
      });

      // Create battle analysis
      logger.info('Creating battle analysis for battle', {
        battleId: battleId.toString()
      });
      logger.info('Creating battle analysis', {
        battleId: battleId.toString(),
        totalPlayers: battleData.totalPlayers,
        totalFame: battleData.totalFame,
        killCount: killsData.length
      });
      
      const battleAnalysis = await this.battleAnalysisService.createBattleAnalysis(
        battleId,
        battleData,
        killsData
      );

      if (!battleAnalysis) {
              logger.warn('Battle analysis not created, skipping MMR calculation', {
        battleId: battleId.toString(),
        totalPlayers: battleData.totalPlayers,
        totalFame: battleData.totalFame,
        killCount: killsData.length
      });
        return;
      }

      logger.info('Battle analysis created successfully', {
        battleId: battleId.toString(),
        guildCount: battleAnalysis.guildStats.length,
        totalPlayers: battleAnalysis.totalPlayers,
        totalFame: battleAnalysis.totalFame,
        isPrimeTime: battleAnalysis.isPrimeTime
      });

      // Add MMR calculation job to queue
      logger.info('Adding MMR calculation job to queue', {
        battleId: battleId.toString()
      });
      await addMmrCalculationJob(battleAnalysis);

      logger.info('Successfully queued battle for MMR calculation', {
        battleId: battleId.toString()
      });
      logger.info('Successfully queued battle for MMR calculation', {
        battleId: battleId.toString(),
        guildCount: battleAnalysis.guildStats.length,
        totalPlayers: battleAnalysis.totalPlayers,
        totalFame: battleAnalysis.totalFame
      });

    } catch (error) {
      logger.error('Error processing battle for MMR', {
        battleId: battleId.toString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - we don't want to break the main battle processing
    }
  }

  /**
   * Process multiple battles for MMR calculation (batch processing)
   */
  async processBattlesForMmr(
    battles: Array<{ battleId: bigint; battleData: any; killsData: any[] }>
  ): Promise<void> {
    try {
      logger.info('Processing multiple battles for MMR calculation', {
        battleCount: battles.length
      });

      const validBattleIds: bigint[] = [];

      // Process each battle
      for (const { battleId, battleData, killsData } of battles) {
        try {
          const battleAnalysis = await this.battleAnalysisService.createBattleAnalysis(
            battleId,
            battleData,
            killsData
          );

          if (battleAnalysis) {
            validBattleIds.push(battleId);
            await addMmrCalculationJob(battleAnalysis, 1); // Lower priority for batch
          }
        } catch (error) {
          logger.error('Error processing individual battle for MMR', {
            battleId: battleId.toString(),
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          // Continue with other battles
        }
      }

      logger.info('Successfully processed battles for MMR calculation', {
        totalBattles: battles.length,
        validBattles: validBattleIds.length
      });

    } catch (error) {
      logger.error('Error processing battles for MMR', {
        battleCount: battles.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Process historical battles for MMR calculation
   * This can be used to backfill MMR for existing battles
   */
  async processHistoricalBattlesForMmr(
    startDate: Date,
    endDate: Date,
    batchSize: number = 100
  ): Promise<void> {
    try {
      logger.info('Processing historical battles for MMR calculation', {
        startDate,
        endDate,
        batchSize
      });

      let processedCount = 0;
      let offset = 0;

      while (true) {
        // Fetch batch of battles from your existing database
        const battles = await this.fetchHistoricalBattles(startDate, endDate, batchSize, offset);
        
        if (battles.length === 0) {
          break; // No more battles to process
        }

        // Process batch
        await this.processBattlesForMmr(battles);
        
        processedCount += battles.length;
        offset += batchSize;

        logger.info('Processed historical battles batch', {
          processedCount,
          batchSize: battles.length
        });

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      logger.info('Completed processing historical battles for MMR', {
        totalProcessed: processedCount
      });

    } catch (error) {
      logger.error('Error processing historical battles for MMR', {
        startDate,
        endDate,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Fetch historical battles from database
   */
  private async fetchHistoricalBattles(
    startDate: Date,
    endDate: Date,
    limit: number,
    offset: number
  ): Promise<Array<{ battleId: bigint; battleData: any; killsData: any[] }>> {
    try {
      // Fetch battles from your Battle model
      const battles = await this.prisma.battle.findMany({
        where: {
          startedAt: {
            gte: startDate,
            lte: endDate
          }
        },
        take: limit,
        skip: offset,
        orderBy: {
          startedAt: 'asc'
        }
      });

      // For each battle, fetch its kill events
      const battlesWithKills = await Promise.all(
        battles.map(async (battle) => {
          const kills = await this.prisma.killEvent.findMany({
            where: { battleAlbionId: battle.albionId },
            orderBy: { TimeStamp: 'asc' }
          });

          return {
            battleId: battle.albionId,
            battleData: battle,
            killsData: kills
          };
        })
      );

      logger.info('Fetched historical battles for MMR processing', {
        startDate,
        endDate,
        limit,
        offset,
        battlesFound: battlesWithKills.length
      });

      return battlesWithKills;

    } catch (error) {
      logger.error('Error fetching historical battles', {
        startDate,
        endDate,
        limit,
        offset,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Get MMR processing statistics
   */
  async getMmrProcessingStats(): Promise<{
    totalBattlesProcessed: number;
    totalGuildsTracked: number;
    activeSeasons: number;
    lastProcessedBattle?: Date;
  }> {
    try {
      const [totalBattles, totalGuilds, activeSeasons, lastBattle] = await Promise.all([
        this.prisma.mmrCalculationJob.count({ where: { status: 'COMPLETED' } }),
        this.prisma.guild.count(),
        this.prisma.season.count({ where: { isActive: true } }),
        this.prisma.mmrCalculationJob.findFirst({
          where: { status: 'COMPLETED' },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true }
        })
      ]);

      logger.info('Retrieved MMR processing statistics', {
        totalBattlesProcessed: totalBattles,
        totalGuildsTracked: totalGuilds,
        activeSeasons
      });
      
      return {
        totalBattlesProcessed: totalBattles,
        totalGuildsTracked: totalGuilds,
        activeSeasons,
        ...(lastBattle?.updatedAt && { lastProcessedBattle: lastBattle.updatedAt })
      };

    } catch (error) {
      logger.error('Error getting MMR processing stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        totalBattlesProcessed: 0,
        totalGuildsTracked: 0,
        activeSeasons: 0
      };
    }
  }

  /**
   * Validate MMR system health
   */
  async validateMmrSystemHealth(): Promise<{
    isHealthy: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check if there are active seasons
      const activeSeasons = await this.prisma.season.count({ where: { isActive: true } });
      if (activeSeasons === 0) {
        issues.push('No active seasons found');
        recommendations.push('Create an active season to enable MMR calculations');
      }

      // Check if there are guilds in the system
      const guildCount = await this.prisma.guild.count();
      if (guildCount === 0) {
        issues.push('No guilds found in system');
        recommendations.push('Ensure guild discovery is working properly');
      }

      // Check for failed MMR calculations
      const failedJobs = await this.prisma.mmrCalculationJob.count({ where: { status: 'FAILED' } });
      if (failedJobs > 0) {
        issues.push(`${failedJobs} failed MMR calculation jobs found`);
        recommendations.push('Review failed jobs and implement fixes');
      }

      // Check for pending jobs that might be stuck
      const pendingJobs = await this.prisma.mmrCalculationJob.count({ 
        where: { 
          status: 'PENDING',
          createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Older than 24 hours
        } 
      });
      if (pendingJobs > 0) {
        issues.push(`${pendingJobs} pending MMR jobs older than 24 hours found`);
        recommendations.push('Check if MMR workers are running properly');
      }

      const isHealthy = issues.length === 0;

      logger.info('MMR system health validation completed', {
        isHealthy,
        issuesCount: issues.length,
        recommendationsCount: recommendations.length
      });

      return {
        isHealthy,
        issues,
        recommendations
      };

    } catch (error) {
      logger.error('Error validating MMR system health', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      issues.push('Error validating system health');
      recommendations.push('Check system logs for details');
      
      return {
        isHealthy: false,
        issues,
        recommendations
      };
    }
  }
}
