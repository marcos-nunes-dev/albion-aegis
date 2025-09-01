import { Worker } from 'bullmq';
import { getKillsForBattle } from '../../http/client.js';
import { getPrisma, executeWithRetry } from '../../db/database.js';
import { killsFetchQueue, cleanupOldJobs } from '../../queue/queues.js';
import { config } from '../../lib/config.js';
import type { KillEvent } from '../../types/albion.js';
import redis from '../../queue/connection.js';
import { MmrIntegrationService } from '../../services/mmrIntegration.js';
import { log } from '../../log.js';

const killsLogger = log.child({ component: 'kills-fetcher' });

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
      
             killsLogger.info('Processing kills for battle', { jobId, albionId });
      
      try {
                 // Fetch kill events from Albion API
         killsLogger.info('Fetching kills from API', { jobId, albionId });
         const killEvents = await getKillsForBattle(BigInt(albionId));
         
         killsLogger.info('Received kill events', { jobId, albionId, killCount: killEvents.length });
        
                 if (killEvents.length === 0) {
           killsLogger.info('No kill events found for battle', { jobId, albionId });
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
             killsLogger.error('Failed to upsert kill event', { 
               jobId, 
               albionId, 
               eventId: killEvent.EventId, 
               error: error instanceof Error ? error.message : 'Unknown error' 
             });
             // Continue processing other kill events
           }
        }
        
        // Mark battle as having kills fetched
        await markBattleKillsFetched(albionId);
        
                 // Process battle for MMR calculation
         try {
           killsLogger.info('Starting MMR processing for battle', { jobId, albionId });
           await processBattleForMmr(albionId, killEvents);
           killsLogger.info('MMR processing completed for battle', { jobId, albionId });
         } catch (error) {
           killsLogger.error('MMR processing failed for battle', { 
             jobId, 
             albionId, 
             error: error instanceof Error ? error.message : 'Unknown error' 
           });
           // Don't throw - MMR processing failure shouldn't fail the kills job
         }
        
                 const totalProcessed = insertedCount + updatedCount;
         killsLogger.info('Battle processing completed', { 
           jobId, 
           albionId, 
           totalProcessed, 
           insertedCount, 
           updatedCount 
         });
        
        return {
          processed: totalProcessed,
          inserted: insertedCount,
          updated: updatedCount
        };
        
             } catch (error) {
         killsLogger.error('Failed to process kills for battle', { 
           jobId, 
           albionId, 
           error: error instanceof Error ? error.message : 'Unknown error' 
         });
         throw error; // Re-throw to trigger job retry
       }
    },
    {
      connection: redis,
      concurrency: config.KILLS_WORKER_CONCURRENCY,
      removeOnComplete: { count: 50, age: 10 * 60 * 1000 },   // Keep last 50 or 10 minutes
      removeOnFail: { count: 25, age: 10 * 60 * 1000 },      // Keep last 25 or 10 minutes
    }
  );
  
     // Worker event handlers
   worker.on('completed', (job, result) => {
     if (job) {
       const { albionId } = job.data;
       killsLogger.info('Kills fetch completed for battle', { jobId: job.id, albionId, result });
     }
   });
   
   worker.on('failed', (job, err) => {
     if (job) {
       const { albionId } = job.data;
       killsLogger.error('Kills fetch failed for battle', { jobId: job.id, albionId, error: err.message });
     }
   });
   
   worker.on('error', (err) => {
     killsLogger.error('Kills fetcher worker error', { error: err.message });
   });
   
   worker.on('stalled', (jobId) => {
     killsLogger.warn('Kills fetcher job stalled', { jobId });
   });
  
  return worker;
}

/**
 * Upsert a kill event to the database with connection pooling and retry logic
 */
async function upsertKillEvent(killEvent: KillEvent, battleAlbionId: string) {
  return executeWithRetry(async () => {
    const prisma = getPrisma();
    
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
  });
}

/**
 * Process battle for MMR calculation with retry logic and connection pooling
 */
 async function processBattleForMmr(albionId: string, killEvents: KillEvent[]): Promise<void> {
   return executeWithRetry(async () => {
     killsLogger.info('Processing battle for MMR calculation', { albionId });
     
     const prisma = getPrisma();
     
     // Get battle data from database
     const battle = await prisma.battle.findUnique({
       where: { albionId: BigInt(albionId) }
     });
     
     if (!battle) {
       killsLogger.warn('Battle not found for MMR processing', { albionId });
       return;
     }
     
     killsLogger.info('Found battle for MMR processing', { 
       albionId, 
       totalPlayers: battle.totalPlayers, 
       totalFame: battle.totalFame 
     });
     
     // Initialize MMR integration service
     const mmrIntegration = new MmrIntegrationService(prisma);
     
     // Process battle for MMR
     await mmrIntegration.processBattleForMmr(
       BigInt(albionId),
       battle,
       killEvents
     );
     
     killsLogger.info('MMR processing queued for battle', { albionId });
   });
 }

/**
 * Mark a battle as having kills fetched with retry logic and connection pooling
 */
async function markBattleKillsFetched(albionId: string): Promise<void> {
  return executeWithRetry(async () => {
    const prisma = getPrisma();
    
    await prisma.battle.update({
      where: { albionId: BigInt(albionId) },
      data: { killsFetchedAt: new Date() }
    });
  });
}

/**
 * Start the kills fetcher worker
 */
 export function startKillsFetcherWorker(): Worker {
   killsLogger.info('Starting kills fetcher worker with enhanced database connection pooling');
   
   const worker = createKillsFetcherWorker();
   
   // Start automatic cleanup every 10 minutes
   const cleanupInterval = setInterval(async () => {
     try {
       killsLogger.info('Kills worker performing automatic cleanup');
       await cleanupOldJobs();
       killsLogger.info('Kills worker cleanup completed');
     } catch (error) {
       killsLogger.error('Kills worker cleanup failed', { 
         error: error instanceof Error ? error.message : 'Unknown error' 
       });
     }
   }, config.REDIS_WORKER_CLEANUP_INTERVAL_MIN * 60 * 1000);
   
   // Graceful shutdown
   process.on('SIGTERM', async () => {
     killsLogger.info('Shutting down kills fetcher worker');
     clearInterval(cleanupInterval);
     await worker.close();
   });
   
   process.on('SIGINT', async () => {
     killsLogger.info('Shutting down kills fetcher worker');
     clearInterval(cleanupInterval);
     await worker.close();
   });
   
   return worker;
 }
