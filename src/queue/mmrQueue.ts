import { Queue, Worker, Job } from 'bullmq';
import connection from './connection.js';
import { log } from '../log.js';
import { MmrService } from '../services/mmr.js';
import { GuildService } from '../services/guild.js';
import { SeasonService } from '../services/season.js';
import { BattleAnalysisService } from '../services/battleAnalysis.js';
import { prisma } from '../db/prisma.js';
import type { BattleAnalysis, GuildBattleStats } from '../services/mmr.js';
import type { MmrJobStatus } from '../types/mmr.js';

const logger = log.child({ component: 'mmr-queue' });

// Queue names
export const MMR_CALCULATION_QUEUE = 'mmr-calculation';
export const MMR_BATCH_QUEUE = 'mmr-batch';

// Job types
export const JOB_TYPES = {
  CALCULATE_BATTLE_MMR: 'calculate-battle-mmr',
  BATCH_MMR_UPDATE: 'batch-mmr-update',
  RETRY_FAILED_MMR: 'retry-failed-mmr'
} as const;

// Job data interfaces
export interface MmrCalculationJobData {
  battleId: string; // Changed from bigint to string for serialization
  seasonId: string;
  guildStats: GuildBattleStats[];
  totalPlayers: number;
  totalFame: number;
  battleDuration: number;
  isPrimeTime: boolean;
  killClustering: number;
  friendGroups: string[][];
  retryCount?: number;
}

export interface BatchMmrJobData {
  battleIds: string[]; // Changed from bigint[] to string[] for serialization
  seasonId: string;
  retryCount?: number;
}

// Create queues
export const mmrCalculationQueue = new Queue(MMR_CALCULATION_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: 100,
    removeOnFail: 50
  }
});

export const mmrBatchQueue = new Queue(MMR_BATCH_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: 50,
    removeOnFail: 25
  }
});

// Initialize services
const mmrService = new MmrService(prisma);
const guildService = new GuildService(prisma);
const seasonService = new SeasonService(prisma);
const battleAnalysisService = new BattleAnalysisService(prisma);

/**
 * Add MMR calculation job to queue
 */
export async function addMmrCalculationJob(
  battleAnalysis: BattleAnalysis,
  priority: number = 0
): Promise<Job<MmrCalculationJobData>> {
  try {
    // Check if battle meets MMR criteria
    if (!MmrService.shouldCalculateMmr(battleAnalysis.totalPlayers, battleAnalysis.totalFame)) {
      logger.debug('Battle does not meet MMR criteria, skipping', {
        battleId: battleAnalysis.battleId.toString(),
        totalPlayers: battleAnalysis.totalPlayers,
        totalFame: battleAnalysis.totalFame
      });
      throw new Error('Battle does not meet MMR calculation criteria');
    }

    // Create job data - convert BigInt to string for serialization
    const jobData: MmrCalculationJobData = {
      battleId: battleAnalysis.battleId.toString(),
      seasonId: battleAnalysis.seasonId,
      guildStats: battleAnalysis.guildStats,
      totalPlayers: battleAnalysis.totalPlayers,
      totalFame: battleAnalysis.totalFame,
      battleDuration: battleAnalysis.battleDuration,
      isPrimeTime: battleAnalysis.isPrimeTime,
      killClustering: battleAnalysis.killClustering,
      friendGroups: battleAnalysis.friendGroups
    };

    // Add job to queue
    const job = await mmrCalculationQueue.add(
      JOB_TYPES.CALCULATE_BATTLE_MMR,
      jobData,
      {
        priority,
        jobId: `mmr-${battleAnalysis.battleId.toString()}-${Date.now()}`,
        delay: 0 // Process immediately
      }
    );

    logger.info('Added MMR calculation job to queue', {
      jobId: job.id,
      battleId: battleAnalysis.battleId.toString(),
      guildCount: battleAnalysis.guildStats.length,
      priority
    });

    return job;
  } catch (error) {
    logger.error('Error adding MMR calculation job to queue', {
      battleId: battleAnalysis.battleId.toString(),
      totalPlayers: battleAnalysis.totalPlayers,
      totalFame: battleAnalysis.totalFame,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

/**
 * Add batch MMR calculation job
 */
export async function addBatchMmrJob(
  battleIds: bigint[],
  seasonId: string,
  priority: number = 0
): Promise<Job<BatchMmrJobData>> {
  try {
    const jobData: BatchMmrJobData = {
      battleIds: battleIds.map(id => id.toString()),
      seasonId
    };

    const job = await mmrBatchQueue.add(
      JOB_TYPES.BATCH_MMR_UPDATE,
      jobData,
      {
        priority,
        jobId: `batch-mmr-${Date.now()}`,
        delay: 0
      }
    );

    logger.info('Added batch MMR job to queue', {
      jobId: job.id,
      battleCount: battleIds.length,
      seasonId,
      priority
    });

    return job;
  } catch (error) {
    logger.error('Error adding batch MMR job to queue', {
      battleCount: battleIds.length,
      seasonId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Process MMR calculation job
 */
async function processMmrCalculationJob(job: Job<MmrCalculationJobData>): Promise<void> {
  const { battleId: battleIdStr, seasonId, guildStats, totalPlayers, totalFame, battleDuration, isPrimeTime, killClustering, friendGroups } = job.data;
  const battleId = BigInt(battleIdStr);
  
  try {
    logger.info('Processing MMR calculation job', {
      jobId: job.id,
      battleId: battleId.toString(),
      guildCount: guildStats.length
    });

    // Update job status to processing
    await updateMmrJobStatus(battleId, 'PROCESSING');

    // Validate season exists
    const season = await seasonService.getSeasonById(seasonId);
    if (!season) {
      throw new Error(`Season not found: ${seasonId}`);
    }

    // Ensure all guilds exist in database
    for (const guildStat of guildStats) {
      await guildService.getOrCreateGuild(guildStat.guildName);
    }

    // Get current MMR for all guilds
    const guildStatsWithMmr = await Promise.all(
      guildStats.map(async (guildStat) => {
        const guild = await guildService.getGuildByName(guildStat.guildName);
        if (!guild) {
          throw new Error(`Guild not found: ${guildStat.guildName}`);
        }

        const currentMmr = await mmrService.getGuildSeasonMmr(guild.id, seasonId);
        
        return {
          ...guildStat,
          guildId: guild.id,
          currentMmr: currentMmr?.currentMmr ?? 1000.0 // Default MMR
        };
      })
    );

    // Create battle analysis
    const battleAnalysis: BattleAnalysis = {
      battleId,
      seasonId,
      guildStats: guildStatsWithMmr,
      totalPlayers,
      totalFame,
      battleDuration,
      isPrimeTime,
      killClustering,
      friendGroups
    };

    // Calculate MMR changes
    const mmrChanges = await mmrService.calculateMmrForBattle(battleAnalysis);

    // Update MMR for each guild
    await Promise.all(
      guildStatsWithMmr.map(async (guildStat) => {
        const mmrChange = mmrChanges.get(guildStat.guildId) ?? 0;
        
        // Update guild season MMR
        await mmrService.updateGuildSeasonMmr(
          guildStat.guildId,
          seasonId,
          mmrChange,
          guildStat,
          battleAnalysis
        );
      })
    );

    // Update job status to completed
    await updateMmrJobStatus(battleId, 'COMPLETED');

    logger.info('Successfully processed MMR calculation job', {
      jobId: job.id,
      battleId: battleId.toString(),
      mmrChanges: Object.fromEntries(mmrChanges)
    });

  } catch (error) {
    logger.error('Error processing MMR calculation job', {
      jobId: job.id,
      battleId: battleId.toString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    // Update job status to failed
    await updateMmrJobStatus(battleId, 'FAILED');

    // Apply fallback MMR change if this is the final retry
    if (job.attemptsMade >= job.opts.attempts! - 1) {
      await applyFallbackMmrChange(battleId, seasonId, guildStats);
    }

    throw error;
  }
}

/**
 * Process batch MMR job
 */
async function processBatchMmrJob(job: Job<BatchMmrJobData>): Promise<void> {
  const { battleIds: battleIdStrs, seasonId } = job.data;

  try {
    logger.info('Processing batch MMR job', {
      jobId: job.id,
      battleCount: battleIdStrs.length,
      seasonId
    });

    // Process each battle individually
    for (const battleIdStr of battleIdStrs) {
      const battleId = BigInt(battleIdStr);
      try {
        // Fetch battle and kills data from database
        const battleData = await fetchBattleDataForMmr(battleId);
        if (!battleData) {
          logger.warn('Battle data not found for MMR calculation', {
            battleId: battleId.toString()
          });
          continue;
        }

        // Create battle analysis
        const battleAnalysis = await createBattleAnalysis(battleData);
        
        // Add individual MMR calculation job
        await addMmrCalculationJob(battleAnalysis, 1); // Lower priority for batch jobs

      } catch (error) {
        logger.error('Error processing battle in batch', {
          battleId: battleId.toString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Continue with other battles
      }
    }

    logger.info('Successfully processed batch MMR job', {
      jobId: job.id,
      battleCount: battleIdStrs.length
    });

  } catch (error) {
    logger.error('Error processing batch MMR job', {
      jobId: job.id,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Update MMR job status in database
 */
async function updateMmrJobStatus(battleId: bigint, status: MmrJobStatus): Promise<void> {
  try {
    // Get the active season for this battle
    const battle = await prisma.battle.findUnique({
      where: { albionId: battleId }
    });
    
    if (!battle) {
      logger.warn('Battle not found for MMR job status update', {
        battleId: battleId.toString()
      });
      return;
    }

    // Find the season that was active when this battle occurred
    const season = await prisma.season.findFirst({
      where: {
        startDate: { lte: battle.startedAt },
        OR: [
          { endDate: null },
          { endDate: { gte: battle.startedAt } }
        ]
      },
      orderBy: { startDate: 'desc' }
    });

    if (!season) {
      logger.warn('No season found for battle date', {
        battleId: battleId.toString(),
        battleDate: battle.startedAt
      });
      return;
    }

    // Update or create MMR calculation job record
    await prisma.mmrCalculationJob.upsert({
      where: { battleId_seasonId: { battleId, seasonId: season.id } },
      update: { 
        status,
        updatedAt: new Date(),
        ...(status === 'COMPLETED' && { processedAt: new Date() }),
        ...(status === 'FAILED' && { attempts: { increment: 1 } })
      },
      create: {
        battleId,
        seasonId: season.id,
        status,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    logger.info('Updated MMR job status', {
      battleId: battleId.toString(),
      seasonId: season.id,
      status
    });
  } catch (error) {
    logger.error('Error updating MMR job status', {
      battleId: battleId.toString(),
      status,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Apply fallback MMR change when calculation fails
 */
async function applyFallbackMmrChange(
  battleId: bigint, 
  seasonId: string, 
  guildStats: GuildBattleStats[]
): Promise<void> {
  try {
    logger.warn('Applying fallback MMR change', {
      battleId: battleId.toString(),
      seasonId,
      guildCount: guildStats.length
    });

    // Apply small symbolic MMR change to all guilds
    const fallbackChange = 1.0; // Small positive change

    for (const guildStat of guildStats) {
      const guild = await guildService.getGuildByName(guildStat.guildName);
      if (!guild) continue;

      const currentMmr = await mmrService.getGuildSeasonMmr(guild.id, seasonId);
      if (!currentMmr) continue;

      // Apply fallback change
      await prisma.guildSeason.update({
        where: { id: currentMmr.id },
        data: {
          currentMmr: currentMmr.currentMmr + fallbackChange,
          lastBattleAt: new Date()
        }
      });
    }

    logger.info('Applied fallback MMR changes', {
      battleId: battleId.toString(),
      fallbackChange
    });

  } catch (error) {
    logger.error('Error applying fallback MMR change', {
      battleId: battleId.toString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Fetch battle data for MMR calculation
 */
async function fetchBattleDataForMmr(battleId: bigint): Promise<{ battle: any; kills: any[] } | null> {
  return await battleAnalysisService.fetchBattleDataForMmr(battleId);
}

/**
 * Create battle analysis from battle data
 */
async function createBattleAnalysis(battleData: any): Promise<BattleAnalysis> {
  const { battle, kills } = battleData;
  // Extract battleId from battle data or use a placeholder
  const battleId = battle?.id ? BigInt(battle.id) : BigInt(0);
  const analysis = await battleAnalysisService.createBattleAnalysis(battleId, battle, kills);
  
  if (!analysis) {
    throw new Error('Failed to create battle analysis');
  }
  
  return analysis;
}

// Create workers
export const mmrCalculationWorker = new Worker(
  MMR_CALCULATION_QUEUE,
  async (job) => {
    if (job.name === JOB_TYPES.CALCULATE_BATTLE_MMR) {
      await processMmrCalculationJob(job);
    } else {
      throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 5, // Process 5 jobs concurrently
    autorun: false // Don't start automatically
  }
);

export const mmrBatchWorker = new Worker(
  MMR_BATCH_QUEUE,
  async (job) => {
    if (job.name === JOB_TYPES.BATCH_MMR_UPDATE) {
      await processBatchMmrJob(job);
    } else {
      throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: 2, // Process 2 batch jobs concurrently
    autorun: false // Don't start automatically
  }
);

// Error handling
mmrCalculationWorker.on('error', (error) => {
  logger.error('MMR calculation worker error', { error: error.message });
});

mmrBatchWorker.on('error', (error) => {
  logger.error('MMR batch worker error', { error: error.message });
});

// Job completion handling
mmrCalculationWorker.on('completed', (job) => {
  logger.info('MMR calculation job completed', { jobId: job.id });
});

mmrBatchWorker.on('completed', (job) => {
  logger.info('MMR batch job completed', { jobId: job.id });
});

// Job failure handling
mmrCalculationWorker.on('failed', (job, error) => {
  logger.error('MMR calculation job failed', {
    jobId: job?.id,
    error: error.message
  });
});

mmrBatchWorker.on('failed', (job, error) => {
  logger.error('MMR batch job failed', {
    jobId: job?.id,
    error: error.message
  });
});

/**
 * Start MMR workers
 */
export async function startMmrWorkers(): Promise<void> {
  try {
    await mmrCalculationWorker.run();
    await mmrBatchWorker.run();
    
    logger.info('MMR workers started successfully');
  } catch (error) {
    logger.error('Error starting MMR workers', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Stop MMR workers
 */
export async function stopMmrWorkers(): Promise<void> {
  try {
    await mmrCalculationWorker.close();
    await mmrBatchWorker.close();
    
    logger.info('MMR workers stopped successfully');
  } catch (error) {
    logger.error('Error stopping MMR workers', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Get queue statistics
 */
export async function getMmrQueueStats() {
  try {
    const [calculationStats, batchStats] = await Promise.all([
      mmrCalculationQueue.getJobCounts(),
      mmrBatchQueue.getJobCounts()
    ]);

    return {
      calculation: calculationStats,
      batch: batchStats
    };
  } catch (error) {
    logger.error('Error getting MMR queue stats', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}
