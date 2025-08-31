import { PrismaClient } from '@prisma/client';
import { log } from '../log.js';
import { config } from '../lib/config.js';
import { getBattlesPage, getBattleDetail } from '../http/client.js';
import { getPrisma, executeWithRetry } from '../db/database.js';
import { killsFetchQueue } from '../queue/queues.js';
import { BattleNotifierProducer } from '../workers/battleNotifier/producer.js';
import type { BattleListItem } from '../types/albion.js';

const logger = log.child({ component: 'battle-gap-recovery' });

export class BattleGapRecoveryService {
  private prisma: PrismaClient;
  private battleNotifierProducer: BattleNotifierProducer;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.battleNotifierProducer = new BattleNotifierProducer();
  }

  /**
   * Run gap detection and recovery for recent battles
   * This should be called periodically to catch delayed battles
   */
  async runGapRecovery(): Promise<void> {
    logger.info('Starting battle gap recovery process');
    
    const startTime = Date.now();
    const now = new Date();
    
    // Look back further than the normal crawl to catch delayed battles
    const lookbackHours = config.GAP_RECOVERY_LOOKBACK_HOURS;
    const recoveryStart = new Date(now.getTime() - (lookbackHours * 60 * 60 * 1000));
    
    try {
      // Step 1: Detect gaps in recent battle data
      const gaps = await this.detectGaps(recoveryStart, now);
      
      if (gaps.length === 0) {
        logger.info('No significant gaps detected, recovery complete');
        return;
      }

      logger.info('Gaps detected, starting recovery', { gapCount: gaps.length });

      // Step 2: For each gap, search for missing battles
      let totalRecovered = 0;
      for (const gap of gaps) {
        const recovered = await this.recoverBattlesInGap(gap);
        totalRecovered += recovered;
      }

      const duration = Date.now() - startTime;
      logger.info('Battle gap recovery completed', {
        duration,
        gapsProcessed: gaps.length,
        battlesRecovered: totalRecovered
      });

    } catch (error) {
      logger.error('Battle gap recovery failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      await this.battleNotifierProducer.close();
    }
  }

  /**
   * Detect significant gaps in battle data
   */
  private async detectGaps(
    startTime: Date,
    endTime: Date,
    maxGapMinutes: number = config.GAP_RECOVERY_MAX_GAP_MINUTES
  ): Promise<Array<{ gapStart: Date; gapEnd: Date; estimatedMissingBattles: number }>> {
    logger.info('Detecting battle gaps', {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      maxGapMinutes
    });

    // Get battles in time range, ordered by startedAt
    const battles = await this.prisma.battle.findMany({
      where: {
        startedAt: {
          gte: startTime,
          lte: endTime
        }
      },
      select: {
        startedAt: true,
        totalPlayers: true,
        totalFame: true
      },
      orderBy: {
        startedAt: 'asc'
      }
    });

    if (battles.length < 2) {
      logger.debug('Not enough battles to detect gaps', { battleCount: battles.length });
      return [];
    }

    const gaps: Array<{ gapStart: Date; gapEnd: Date; estimatedMissingBattles: number }> = [];
    const maxGapMs = maxGapMinutes * 60 * 1000;

    // Analyze gaps between consecutive battles
    for (let i = 0; i < battles.length - 1; i++) {
      const currentBattle = battles[i];
      const nextBattle = battles[i + 1];
      const gapMs = nextBattle.startedAt.getTime() - currentBattle.startedAt.getTime();

      if (gapMs > maxGapMs) {
        // Calculate estimated missing battles based on average battle frequency
        const avgBattleInterval = this.calculateAverageBattleInterval(battles, i);
        const estimatedMissingBattles = Math.floor(gapMs / avgBattleInterval);

        gaps.push({
          gapStart: currentBattle.startedAt,
          gapEnd: nextBattle.startedAt,
          estimatedMissingBattles
        });

        logger.info('Battle gap detected', {
          gapStart: currentBattle.startedAt.toISOString(),
          gapEnd: nextBattle.startedAt.toISOString(),
          gapMinutes: Math.round(gapMs / (60 * 1000)),
          estimatedMissingBattles
        });
      }
    }

    return gaps;
  }

  /**
   * Calculate average battle interval around a specific index
   */
  private calculateAverageBattleInterval(
    battles: Array<{ startedAt: Date }>,
    centerIndex: number,
    windowSize: number = 10
  ): number {
    const startIndex = Math.max(0, centerIndex - windowSize);
    const endIndex = Math.min(battles.length - 1, centerIndex + windowSize);
    
    if (endIndex <= startIndex) {
      return 5 * 60 * 1000; // Default 5 minutes if not enough data
    }

    let totalInterval = 0;
    let intervalCount = 0;

    for (let i = startIndex; i < endIndex; i++) {
      const interval = battles[i + 1].startedAt.getTime() - battles[i].startedAt.getTime();
      totalInterval += interval;
      intervalCount++;
    }

    return intervalCount > 0 ? totalInterval / intervalCount : 5 * 60 * 1000;
  }

  /**
   * Recover battles in a specific gap
   */
  private async recoverBattlesInGap(
    gap: { gapStart: Date; gapEnd: Date; estimatedMissingBattles: number }
  ): Promise<number> {
    logger.info('Recovering battles in gap', {
      gapStart: gap.gapStart.toISOString(),
      gapEnd: gap.gapEnd.toISOString(),
      estimatedMissingBattles: gap.estimatedMissingBattles
    });

    let recoveredCount = 0;
    const maxPagesToSearch = Math.min(10, Math.ceil(gap.estimatedMissingBattles / 10) + 2);

    // Search multiple pages to find battles in the gap
    for (let page = 0; page < maxPagesToSearch; page++) {
      try {
        const battles = await getBattlesPage(page, 10); // minPlayers = 10
        
        if (battles.length === 0) {
          logger.debug('No more battles found on page', { page });
          break;
        }

        let allBattlesOlderThanGap = true;

        for (const battle of battles) {
          const battleTime = new Date(battle.startedAt);
          
          // Check if this battle falls within our gap
          if (battleTime >= gap.gapStart && battleTime <= gap.gapEnd) {
            allBattlesOlderThanGap = false;
            
            // Check if we already have this battle in our database
            const existingBattle = await this.prisma.battle.findUnique({
              where: { albionId: battle.albionId },
              select: { albionId: true }
            });

            if (!existingBattle) {
              // This is a missing battle! Recover it
              const recovered = await this.recoverBattle(battle);
              if (recovered) {
                recoveredCount++;
                logger.info('Recovered missing battle', {
                  albionId: battle.albionId.toString(),
                  startedAt: battle.startedAt,
                  gapStart: gap.gapStart.toISOString(),
                  gapEnd: gap.gapEnd.toISOString()
                });
              }
            }
          } else if (battleTime < gap.gapStart) {
            // We've gone too far back, stop searching
            logger.debug('Reached battles older than gap, stopping search', {
              page,
              battleTime: battleTime.toISOString(),
              gapStart: gap.gapStart.toISOString()
            });
            return recoveredCount;
          }
        }

        // If all battles on this page are older than our gap, we can stop
        if (allBattlesOlderThanGap) {
          logger.debug('All battles on page are older than gap, stopping search', { page });
          break;
        }

      } catch (error) {
        logger.warn('Failed to search page for missing battles', {
          page,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        break; // Stop searching if we hit API issues
      }
    }

    logger.info('Gap recovery completed', {
      gapStart: gap.gapStart.toISOString(),
      gapEnd: gap.gapEnd.toISOString(),
      battlesRecovered: recoveredCount
    });

    return recoveredCount;
  }

  /**
   * Recover a single missing battle
   */
  private async recoverBattle(battle: BattleListItem): Promise<boolean> {
    try {
      // Upsert battle to database (reuse existing logic)
      const upsertResult = await this.upsertBattle(battle);
      
      if (upsertResult.wasCreated) {
        // Enqueue kill fetch job
        await this.enqueueKillsJob(battle.albionId);
        
        // Enqueue battle notification job
        try {
          await this.battleNotifierProducer.enqueueBattleNotification(battle.albionId);
        } catch (error) {
          logger.warn('Failed to enqueue battle notification for recovered battle', {
            albionId: battle.albionId.toString(),
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Failed to recover battle', {
        albionId: battle.albionId.toString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Upsert a battle to the database (reused from battle crawler)
   */
  private async upsertBattle(battle: BattleListItem) {
    return await executeWithRetry(async () => {
      const prisma = getPrisma();
      const existingBattle = await prisma.battle.findUnique({
        where: { albionId: battle.albionId }
      });
      
      // Fetch complete battle data from API to get full guild/alliance information
      let completeBattleData = null;
      try {
        logger.debug('Fetching complete battle data from API', {
          albionId: battle.albionId.toString()
        });
        completeBattleData = await getBattleDetail(battle.albionId);
      } catch (error) {
        logger.warn('Failed to fetch complete battle data, using list data', {
          albionId: battle.albionId.toString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
      // Use complete data if available, otherwise fall back to list data
      const alliancesData = completeBattleData?.alliances || battle.alliances;
      const guildsData = completeBattleData?.guilds || battle.guilds;
      
      const battleData = {
        albionId: battle.albionId,
        startedAt: new Date(battle.startedAt),
        totalFame: battle.totalFame,
        totalKills: battle.totalKills,
        totalPlayers: battle.totalPlayers,
        alliancesJson: alliancesData,
        guildsJson: guildsData,
        ingestedAt: new Date(),
      };
      
      if (existingBattle) {
        // Update existing battle
        const updatedBattle = await prisma.battle.update({
          where: { albionId: battle.albionId },
          data: battleData
        });
        
        return {
          battle: updatedBattle,
          wasCreated: false
        };
      } else {
        // Create new battle
        const newBattle = await prisma.battle.create({
          data: battleData
        });
        
        return {
          battle: newBattle,
          wasCreated: true
        };
      }
    });
  }

  /**
   * Enqueue kills job for a battle
   */
  private async enqueueKillsJob(battleId: bigint): Promise<void> {
    try {
      await killsFetchQueue.add(
        'fetch-kills',
        { albionId: battleId.toString() },
        {
          delay: 5000, // 5 second delay to allow battle to be fully processed
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      );
    } catch (error) {
      logger.error('Failed to enqueue kills job for recovered battle', {
        battleId: battleId.toString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}
