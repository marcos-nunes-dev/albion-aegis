#!/usr/bin/env tsx

import { getPrisma } from '../src/db/database.js';
import { log } from '../src/log.js';

const logger = log.child({ component: 'daily-gap-recovery' });

/**
 * Daily Battle Gap Recovery Service
 * 
 * This service runs daily at 7 AM Brazilian time (UTC-3, so 10 AM UTC)
 * to recover battles that might have been missed during high-traffic periods.
 * 
 * Features:
 * - Fetches last 24 hours of battles from Albion API
 * - Batch checks 20 battles at a time against database
 * - Recovers missing battles using existing recovery logic
 * - Provides detailed logging for monitoring
 */
class DailyGapRecoveryService {
  private prisma: any;
  private battleNotifierProducer: any;

  constructor() {
    this.prisma = getPrisma();
    this.battleNotifierProducer = null; // Will be initialized when needed
  }

  /**
   * Main execution method
   */
  async run(): Promise<void> {
    const startTime = Date.now();
    const brazilianTime = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    logger.info('Starting daily battle gap recovery', {
      brazilianTime,
      lookbackHours: 24,
      batchSize: 20
    });

    try {
      // Run the custom 24-hour gap recovery process
      const recoveredCount = await this.detectAndRecoverMissingBattles24h();

      const duration = Date.now() - startTime;
      logger.info('Daily battle gap recovery completed successfully', {
        duration: `${duration}ms`,
        battlesRecovered: recoveredCount,
        brazilianTime
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Daily battle gap recovery failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${duration}ms`,
        brazilianTime
      });
      throw error;
    } finally {
      if (this.battleNotifierProducer) {
        await this.battleNotifierProducer.close();
      }
      
      // Close database connection
      await this.prisma.$disconnect();
      logger.info('Database connection closed');
      
      // Exit the process gracefully
      logger.info('Exiting daily gap recovery service');
      process.exit(0);
    }
  }

  /**
   * Detect and recover missing battles from recent API results
   * This approach checks ALL battles on each page without time filtering
   * and only stops when we've gone far enough back in time
   */
  private async detectAndRecoverMissingBattles24h(): Promise<number> {
    logger.info('Detecting missing battles from recent API results');
    
    let totalRecovered = 0;
    const maxPagesToCheck = 200; // Check up to 200 pages (10,000 battles) to be thorough
    const maxAgeHours = 48; // Stop when battles are older than 48 hours
    const currentTime = new Date();
    
    logger.info('Starting comprehensive battle gap recovery', {
      maxPagesToCheck,
      maxAgeHours,
      currentTime: currentTime.toISOString()
    });
    
    // Check multiple pages to catch all recent battles
    for (let page = 0; page < maxPagesToCheck; page++) {
      try {
        logger.info(`Checking page ${page + 1} for missing battles`);
        
        const battles = await this.getBattlesPage(page, 10); // minPlayers = 10
        
        if (battles.length === 0) {
          logger.debug('No more battles found on page', { page });
          break;
        }

        // Check if we've gone too far back in time
        const oldestBattle = battles[battles.length - 1];
        const oldestBattleTime = new Date(oldestBattle.startedAt);
        const hoursAgo = (currentTime.getTime() - oldestBattleTime.getTime()) / (1000 * 60 * 60);
        
        logger.debug('Page battle time range', {
          page: page + 1,
          newestBattle: battles[0].startedAt,
          oldestBattle: oldestBattle.startedAt,
          oldestHoursAgo: Math.round(hoursAgo)
        });

        // If the oldest battle on this page is too old, we can stop
        if (hoursAgo > maxAgeHours) {
          logger.info('Reached battles older than 24 hours, stopping search', {
            page: page + 1,
            oldestHoursAgo: Math.round(hoursAgo)
          });
          break;
        }

        // Check ALL battles on this page (no time filtering)
        const battleIds = battles.map(battle => battle.albionId);
        logger.debug('Batch checking battles in database', {
          page: page + 1,
          battleCount: battleIds.length
        });

        // Check for existing battles and existing MMR jobs in parallel
        const [existingBattles, existingMmrJobs] = await Promise.all([
          this.prisma.battle.findMany({
            where: { 
              albionId: { 
                in: battleIds 
              } 
            },
            select: { albionId: true }
          }),
          this.prisma.mmrCalculationJob.findMany({
            where: {
              battleId: {
                in: battleIds
              },
              status: { in: ['COMPLETED', 'PROCESSING'] }
            },
            select: { battleId: true }
          })
        ]);

        const existingBattleIds = new Set(existingBattles.map((b: any) => b.albionId));
        const existingMmrJobIds = new Set(existingMmrJobs.map((j: any) => j.battleId));
        
        logger.debug('Battle existence check results', {
          page: page + 1,
          totalBattles: battleIds.length,
          existingBattles: existingBattleIds.size,
          existingMmrJobs: existingMmrJobIds.size
        });

        // Check each battle for missing ones
        for (const battle of battles) {
          const battleStartTime = new Date(battle.startedAt);
          const battleHoursAgo = (currentTime.getTime() - battleStartTime.getTime()) / (1000 * 60 * 60);
          
          const battleExists = existingBattleIds.has(battle.albionId);
          const mmrJobExists = existingMmrJobIds.has(battle.albionId);
          
          if (!battleExists) {
            // This is a missing battle! Recover it
            logger.info('Found missing battle on API', {
              albionId: battle.albionId.toString(),
              startedAt: battle.startedAt,
              page: page + 1,
              hoursAgo: Math.round(battleHoursAgo),
              mmrJobExists
            });
            
            const recovered = await this.recoverBattle(battle);
            if (recovered) {
              totalRecovered++;
              logger.info('Recovered missing battle', {
                albionId: battle.albionId.toString(),
                startedAt: battle.startedAt,
                page: page + 1,
                hoursAgo: Math.round(battleHoursAgo),
                mmrJobExists
              });
            }
          } else if (mmrJobExists) {
            logger.debug('Battle exists and MMR already processed, skipping', {
              albionId: battle.albionId.toString(),
              page: page + 1,
              hoursAgo: Math.round(battleHoursAgo)
            });
          } else {
            logger.debug('Battle exists but no MMR processing detected', {
              albionId: battle.albionId.toString(),
              page: page + 1,
              hoursAgo: Math.round(battleHoursAgo)
            });
          }
        }

      } catch (error) {
        logger.warn('Failed to check page for missing battles', {
          page: page + 1,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        break; // Stop searching if we hit API issues
      }
    }

    logger.info('Comprehensive missing battle detection completed', {
      pagesChecked: maxPagesToCheck,
      battlesRecovered: totalRecovered,
      note: 'MMR duplicate processing prevention is active'
    });

    return totalRecovered;
  }

  /**
   * Get battles page from Albion API (reuse existing logic)
   */
  private async getBattlesPage(page: number, minPlayers: number): Promise<any[]> {
    const { getBattlesPage } = await import('../src/http/client.js');
    return await getBattlesPage(page, minPlayers);
  }

  /**
   * Recover a single missing battle (reuse existing logic)
   */
  private async recoverBattle(battle: any): Promise<boolean> {
    try {
      // Initialize battle notifier producer if needed
      if (!this.battleNotifierProducer) {
        const { BattleNotifierProducer } = await import('../src/workers/battleNotifier/producer.js');
        this.battleNotifierProducer = new BattleNotifierProducer();
      }

      // Check if this battle has already been processed for MMR to prevent duplicate processing
      const existingMmrJob = await this.prisma.mmrCalculationJob.findFirst({
        where: { 
          battleId: battle.albionId,
          status: { in: ['COMPLETED', 'PROCESSING'] }
        }
      });

      if (existingMmrJob) {
        logger.info('Battle already processed for MMR, skipping MMR-related jobs', {
          albionId: battle.albionId.toString(),
          mmrJobStatus: existingMmrJob.status
        });
        
        // Still upsert the battle data in case it's missing, but don't trigger MMR processing
        const upsertResult = await this.upsertBattle(battle);
        
        // Only enqueue notification job (not kills job which triggers MMR processing)
        if (upsertResult.wasCreated) {
          try {
            await this.battleNotifierProducer.enqueueBattleNotification(battle.albionId);
            logger.info('Enqueued notification job for recovered battle (MMR already processed)', {
              albionId: battle.albionId.toString()
            });
          } catch (error) {
            logger.warn('Failed to enqueue battle notification for recovered battle', {
              albionId: battle.albionId.toString(),
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
        
        return upsertResult.wasCreated;
      }

      // Upsert battle to database (reuse existing logic)
      const upsertResult = await this.upsertBattle(battle);
      
      if (upsertResult.wasCreated) {
        // Enqueue kill fetch job (which will trigger MMR processing)
        await this.enqueueKillsJob(battle.albionId);
        
        // Enqueue battle notification job
        try {
          await this.battleNotifierProducer.enqueueBattleNotification(battle.albionId);
          logger.info('Enqueued notification and kills jobs for new recovered battle', {
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
   * Upsert a battle to the database (reuse existing logic)
   */
  private async upsertBattle(battle: any) {
    const { executeWithRetry, getPrisma } = await import('../src/db/database.js');
    const { getBattleDetail } = await import('../src/http/client.js');
    
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
      
      // Use upsert to handle unique constraint automatically
      const result = await prisma.battle.upsert({
        where: { albionId: battle.albionId },
        update: battleData,
        create: battleData
      });
      
      // Check if this was a create or update by comparing timestamps
      const wasCreated = result.ingestedAt.getTime() === battleData.ingestedAt.getTime();
      
      logger.debug(wasCreated ? 'Created new battle in gap recovery' : 'Updated existing battle in gap recovery', {
        albionId: battle.albionId.toString(),
        wasCreated
      });
      
      return {
        battle: result,
        wasCreated
      };
    });
  }

  /**
   * Enqueue kills job for a battle (reuse existing logic)
   */
  private async enqueueKillsJob(battleId: bigint): Promise<void> {
    try {
      const { killsFetchQueue } = await import('../src/queue/queues.js');
      
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

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error('Error during cleanup', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

/**
 * Main execution function
 */
async function main() {
  const service = new DailyGapRecoveryService();
  
  try {
    await service.run();
    logger.info('Daily gap recovery service completed successfully');
  } catch (error) {
    logger.error('Daily gap recovery service failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  } finally {
    await service.cleanup();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in daily gap recovery service', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection in daily gap recovery service', {
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: promise.toString()
  });
  process.exit(1);
});

// Run the main function
main().catch((error) => {
  logger.error('Unhandled error in daily gap recovery service', {
    error: error instanceof Error ? error.message : 'Unknown error'
  });
  process.exit(1);
});
