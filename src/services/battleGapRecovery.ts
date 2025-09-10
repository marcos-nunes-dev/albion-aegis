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
    
    try {
      // Step 1: Fetch recent battles from API and check for missing ones
      const recoveredCount = await this.detectAndRecoverMissingBattles();
      
      const duration = Date.now() - startTime;
      logger.info('Battle gap recovery completed', {
        duration,
        battlesRecovered: recoveredCount
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
   * Detect and recover missing battles by checking recent API results
   * This catches battles that were added late to the API
   */
  private async detectAndRecoverMissingBattles(): Promise<number> {
    logger.info('Detecting missing battles from recent API results');
    
    let totalRecovered = 0;
    const pagesToCheck = config.GAP_RECOVERY_PAGES_TO_CHECK || 5; // Default to checking 5 pages
    
    // Only process battles that are older than 10 minutes to avoid conflicts with main crawler
    const cutoffTime = new Date(Date.now() - (10 * 60 * 1000)); // 10 minutes ago
    
    // Check multiple pages to catch late-added battles
    for (let page = 0; page < pagesToCheck; page++) {
      try {
        logger.info(`Checking page ${page + 1} for missing battles`);
        
        const battles = await getBattlesPage(page, 10); // minPlayers = 10
        
        if (battles.length === 0) {
          logger.debug('No more battles found on page', { page });
          break;
        }

        // Filter battles that are old enough to process
        const battlesToCheck = battles.filter(battle => {
          const battleStartTime = new Date(battle.startedAt);
          return battleStartTime <= cutoffTime;
        });

        if (battlesToCheck.length === 0) {
          logger.debug('No battles old enough to process on this page', { page: page + 1 });
          continue;
        }

        // Batch check for existing battles to reduce database queries
        const battleIds = battlesToCheck.map(battle => battle.albionId);
        logger.debug('Batch checking battles in database', {
          page: page + 1,
          battleCount: battleIds.length,
          totalOnPage: battles.length
        });

        const existingBattles = await this.prisma.battle.findMany({
          where: { 
            albionId: { 
              in: battleIds 
            } 
          },
          select: { albionId: true }
        });

        const existingBattleIds = new Set(existingBattles.map(b => b.albionId));

        // Check each battle that passed the cutoff time
        for (const battle of battlesToCheck) {
          const battleStartTime = new Date(battle.startedAt);
          
          // Double-check cutoff time (already filtered above, but for clarity)
          if (battleStartTime > cutoffTime) {
            logger.debug('Skipping recent battle in gap recovery', {
              albionId: battle.albionId.toString(),
              startedAt: battle.startedAt,
              cutoffTime: cutoffTime.toISOString()
            });
            continue;
          }

          if (!existingBattleIds.has(battle.albionId)) {
            // This is a missing battle! Recover it
            logger.info('Found missing battle on API', {
              albionId: battle.albionId.toString(),
              startedAt: battle.startedAt,
              page: page + 1
            });
            
            const recovered = await this.recoverBattle(battle);
            if (recovered) {
              totalRecovered++;
              logger.info('Recovered missing battle', {
                albionId: battle.albionId.toString(),
                startedAt: battle.startedAt,
                page: page + 1
              });
            }
          }
        }

        // If we found no battles to check on this page, continue to next page
        // This ensures we catch battles that might have been added late to earlier pages

      } catch (error) {
        logger.warn('Failed to check page for missing battles', {
          page: page + 1,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        break; // Stop searching if we hit API issues
      }
    }

    logger.info('Missing battle detection completed', {
      pagesChecked: pagesToCheck,
      battlesRecovered: totalRecovered
    });

    return totalRecovered;
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
          logger.info('Enqueued notification job for recovered battle', {
            albionId: battle.albionId.toString()
          });
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
      
      try {
        // Try to create first (most common case)
        const newBattle = await prisma.battle.create({
          data: battleData
        });
        
        return {
          battle: newBattle,
          wasCreated: true
        };
      } catch (error) {
        // If creation fails due to unique constraint, try to update
        if (error instanceof Error && error.message.includes('Unique constraint failed')) {
          logger.debug('Battle already exists, updating instead', {
            albionId: battle.albionId.toString()
          });
          
          const updatedBattle = await prisma.battle.update({
            where: { albionId: battle.albionId },
            data: battleData
          });
          
          return {
            battle: updatedBattle,
            wasCreated: false
          };
        }
        
        // Re-throw if it's not a unique constraint error
        throw error;
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
