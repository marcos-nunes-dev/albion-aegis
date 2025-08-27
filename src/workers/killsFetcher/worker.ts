import { Worker } from 'bullmq';
import { getKillsForBattle } from '../../http/client.js';
import { prisma } from '../../db/prisma.js';
import { killsFetchQueue } from '../../queue/queues.js';
import { config } from '../../lib/config.js';
import type { KillEvent } from '../../types/albion.js';
import redis from '../../queue/connection.js';
import { MmrIntegrationService } from '../../services/mmrIntegration.js';

/**
 * Kills fetcher worker - processes jobs from killsFetchQueue
 * Fetches kill events for battles and stores them in the database
 */
export function createKillsFetcherWorker(): Worker {
  const worker = new Worker(
    killsFetchQueue.name,
    async (job) => {
      const { albionId } = job.data;
      const jobId = job.id;
      
      console.log(`🔪 [${jobId}] Processing kills for battle ${albionId}...`);
      
      try {
        // Fetch kill events from Albion API
        console.log(`🌐 [${jobId}] Fetching kills from /battles/kills?ids=${albionId}...`);
        const killEvents = await getKillsForBattle(BigInt(albionId));
        
        console.log(`📊 [${jobId}] Received ${killEvents.length} kill events`);
        
        if (killEvents.length === 0) {
          console.log(`📭 [${jobId}] No kill events found for battle ${albionId}`);
          await markBattleKillsFetched(albionId);
          return { processed: 0, inserted: 0, updated: 0 };
        }
        
        // Process each kill event
        let insertedCount = 0;
        let updatedCount = 0;
        
        for (const killEvent of killEvents) {
          try {
            const result = await upsertKillEvent(killEvent, albionId);
            if (result.wasCreated) {
              insertedCount++;
            } else {
              updatedCount++;
            }
          } catch (error) {
            console.error(`❌ [${jobId}] Failed to upsert kill event ${killEvent.EventId}:`, error);
            // Continue processing other kill events
          }
        }
        
        // Mark battle as having kills fetched
        await markBattleKillsFetched(albionId);
        
        // Process battle for MMR calculation
        try {
          await processBattleForMmr(albionId, killEvents);
        } catch (error) {
          console.error(`⚠️ [${jobId}] MMR processing failed for battle ${albionId}:`, error);
          // Don't throw - MMR processing failure shouldn't fail the kills job
        }
        
        const totalProcessed = insertedCount + updatedCount;
        console.log(`✅ [${jobId}] Battle ${albionId} completed:`);
        console.log(`   - Kill events processed: ${totalProcessed}`);
        console.log(`   - New kill events: ${insertedCount}`);
        console.log(`   - Updated kill events: ${updatedCount}`);
        
        return {
          processed: totalProcessed,
          inserted: insertedCount,
          updated: updatedCount
        };
        
      } catch (error) {
        console.error(`❌ [${jobId}] Failed to process kills for battle ${albionId}:`, error);
        throw error; // Re-throw to trigger job retry
      }
    },
    {
      connection: redis,
      concurrency: config.KILLS_WORKER_CONCURRENCY,
      removeOnComplete: { count: 1000 },  // Keep last 1000 completed jobs
      removeOnFail: { count: 500 },       // Keep last 500 failed jobs
    }
  );
  
  // Worker event handlers
  worker.on('completed', (job, result) => {
    if (job) {
      const { albionId } = job.data;
      console.log(`🎉 [${job.id}] Kills fetch completed for battle ${albionId}:`, result);
    }
  });
  
  worker.on('failed', (job, err) => {
    if (job) {
      const { albionId } = job.data;
      console.error(`💥 [${job.id}] Kills fetch failed for battle ${albionId}:`, err.message);
    }
  });
  
  worker.on('error', (err) => {
    console.error('🚨 Kills fetcher worker error:', err);
  });
  
  worker.on('stalled', (jobId) => {
    console.warn(`⚠️  Kills fetcher job ${jobId} stalled`);
  });
  
  return worker;
}

/**
 * Upsert a kill event to the database
 */
async function upsertKillEvent(killEvent: KillEvent, battleAlbionId: string) {
  const existingKillEvent = await prisma.killEvent.findUnique({
    where: { EventId: killEvent.EventId }
  });
  
  const killEventData = {
    EventId: killEvent.EventId,
    TimeStamp: new Date(killEvent.TimeStamp),
    TotalVictimKillFame: killEvent.TotalVictimKillFame,
    battleAlbionId: BigInt(battleAlbionId),
    
    // Killer information
    killerId: killEvent.Killer.Id,
    killerName: killEvent.Killer.Name,
    killerGuild: killEvent.Killer.GuildName || null,
    killerAlliance: killEvent.Killer.AllianceName || null,
    killerAvgIP: killEvent.Killer.AverageItemPower,
    killerEquipment: killEvent.Killer.Equipment ? JSON.parse(JSON.stringify(killEvent.Killer.Equipment)) : null,
    
    // Victim information
    victimId: killEvent.Victim.Id,
    victimName: killEvent.Victim.Name,
    victimGuild: killEvent.Victim.GuildName || null,
    victimAlliance: killEvent.Victim.AllianceName || null,
    victimAvgIP: killEvent.Victim.AverageItemPower,
    victimEquipment: killEvent.Victim.Equipment ? JSON.parse(JSON.stringify(killEvent.Victim.Equipment)) : null,
    
    ingestedAt: new Date(),
  };
  
  if (existingKillEvent) {
    // Update existing kill event
    const updatedKillEvent = await prisma.killEvent.update({
      where: { EventId: killEvent.EventId },
      data: killEventData
    });
    
    return { killEvent: updatedKillEvent, wasCreated: false };
  } else {
    // Create new kill event
    const newKillEvent = await prisma.killEvent.create({
      data: killEventData
    });
    
    return { killEvent: newKillEvent, wasCreated: true };
  }
}

/**
 * Process battle for MMR calculation
 */
async function processBattleForMmr(albionId: string, killEvents: KillEvent[]): Promise<void> {
  try {
    // Get battle data from database
    const battle = await prisma.battle.findUnique({
      where: { albionId: BigInt(albionId) }
    });
    
    if (!battle) {
      console.log(`⚠️ Battle ${albionId} not found for MMR processing`);
      return;
    }
    
    // Initialize MMR integration service
    const mmrIntegration = new MmrIntegrationService(prisma);
    
    // Process battle for MMR
    await mmrIntegration.processBattleForMmr(
      BigInt(albionId),
      battle,
      killEvents
    );
    
    console.log(`🏆 MMR processing queued for battle ${albionId}`);
  } catch (error) {
    console.error(`❌ MMR processing failed for battle ${albionId}:`, error);
    throw error;
  }
}

/**
 * Mark a battle as having kills fetched
 */
async function markBattleKillsFetched(albionId: string): Promise<void> {
  try {
    await prisma.battle.update({
      where: { albionId: BigInt(albionId) },
      data: { killsFetchedAt: new Date() }
    });
  } catch (error) {
    console.error(`❌ Failed to mark battle ${albionId} as kills fetched:`, error);
    // Don't throw - this is not critical for the main job
  }
}

/**
 * Start the kills fetcher worker
 */
export function startKillsFetcherWorker(): Worker {
  console.log(`🔪 Starting kills fetcher worker with concurrency: ${config.KILLS_WORKER_CONCURRENCY}`);
  
  const worker = createKillsFetcherWorker();
  
  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down kills fetcher worker...');
    await worker.close();
  });
  
  process.on('SIGINT', async () => {
    console.log('🛑 Shutting down kills fetcher worker...');
    await worker.close();
  });
  
  return worker;
}
