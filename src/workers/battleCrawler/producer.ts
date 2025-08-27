import { getBattlesPage } from '../../http/client.js';
import { getPrisma, executeWithRetry } from '../../db/database.js';
import { killsFetchQueue } from '../../queue/queues.js';
import { setWatermark } from '../../services/watermark.js';
import { config } from '../../lib/config.js';
import type { BattleListItem } from '../../types/albion.js';
import { battleLogger } from '../../log.js';
import { metrics } from '../../metrics.js';
import { BattleNotifierProducer } from '../battleNotifier/producer.js';

/**
 * Run battle crawl with sliding time window to avoid missing late-listed battles
 * Uses soft cutoff instead of watermark to ensure comprehensive coverage
 */
export async function runBattleCrawl(): Promise<void> {
  battleLogger.info('Starting battle crawl');
  
  const startTime = Date.now();
  const now = new Date();
  
  // Calculate soft cutoff (now - SOFT_LOOKBACK_MIN)
  const softCutoff = new Date(now.getTime() - (config.SOFT_LOOKBACK_MIN * 60 * 1000));
  battleLogger.info('Soft cutoff calculated', { 
    softCutoff: softCutoff.toISOString(), 
    lookbackMinutes: config.SOFT_LOOKBACK_MIN 
  });
  
  let totalBattlesProcessed = 0;
  let totalBattlesUpserted = 0;
  let totalKillJobsEnqueued = 0;
  let totalNotificationJobsEnqueued = 0;
  let maxStartedAtSeen: Date | null = null;
  
  // Initialize battle notifier producer
  const battleNotifierProducer = new BattleNotifierProducer();
  
  try {
    // Crawl pages until we hit the soft cutoff or max pages
    for (let page = 0; page < config.MAX_PAGES_PER_CRAWL; page++) {
      battleLogger.info('Processing page', { 
        page: page + 1, 
        maxPages: config.MAX_PAGES_PER_CRAWL 
      });
      
      // Fetch battles for this page
      const battles = await getBattlesPage(page, 10); // minPlayers = 10
      
      if (battles.length === 0) {
        battleLogger.info('No more battles found, stopping crawl');
        break;
      }
      
      let allOlderThanCutoff = true;
      let pageBattlesUpserted = 0;
      let pageKillJobsEnqueued = 0;
      
      // Process each battle on this page
      for (const battle of battles) {
        const battleStartTime = new Date(battle.startedAt);
        totalBattlesProcessed++;
        
        // Check if this battle is newer than soft cutoff
        if (battleStartTime >= softCutoff) {
          allOlderThanCutoff = false;
        }
        
        // Track the maximum startedAt we've seen
        if (!maxStartedAtSeen || battleStartTime > maxStartedAtSeen) {
          maxStartedAtSeen = battleStartTime;
        }
        
        // Upsert battle to database
        try {
          const upsertResult = await upsertBattle(battle);
          if (upsertResult.wasCreated) {
            pageBattlesUpserted++;
            totalBattlesUpserted++;
          }
          
                     // Enqueue kill fetch job with improved logic
           const shouldEnqueue = shouldEnqueueKills(battle, upsertResult.battle);
           if (shouldEnqueue) {
             await enqueueKillsJob(battle.albionId);
             pageKillJobsEnqueued++;
             totalKillJobsEnqueued++;
           }
           
           // Enqueue battle notification job for new battles
           if (upsertResult.wasCreated) {
             try {
               await battleNotifierProducer.enqueueBattleNotification(battle.albionId);
               totalNotificationJobsEnqueued++;
             } catch (error) {
               battleLogger.warn('Failed to enqueue battle notification job', {
                 albionId: battle.albionId.toString(),
                 error: error instanceof Error ? error.message : 'Unknown error'
               });
             }
           }
          
                 } catch (error) {
           battleLogger.error('Failed to process battle', { 
             albionId: battle.albionId.toString(), 
             error: error instanceof Error ? error.message : 'Unknown error' 
           });
         }
       }
       
       battleLogger.info('Page complete', { 
         page: page + 1, 
         battlesUpserted: pageBattlesUpserted, 
         killJobsEnqueued: pageKillJobsEnqueued 
       });
       
       // Record metrics
       metrics.recordPageScanned();
       
       // If all battles on this page are older than cutoff, stop crawling
       if (allOlderThanCutoff) {
         battleLogger.info('All battles older than cutoff, stopping crawl', { page: page + 1 });
         metrics.recordAllOlderPage();
         break;
       }
    }
    
         // Update watermark with clamping
     if (maxStartedAtSeen) {
       const clampedWatermark = new Date(Math.min(
         maxStartedAtSeen.getTime(),
         now.getTime() - (config.SOFT_LOOKBACK_MIN * 60 * 1000)
       ));
       
       await setWatermark(clampedWatermark.toISOString());
       battleLogger.info('Watermark updated', { watermark: clampedWatermark.toISOString() });
     }
     
     const duration = Date.now() - startTime;
     battleLogger.info('Battle crawl completed', {
       duration,
       battlesProcessed: totalBattlesProcessed,
       battlesUpserted: totalBattlesUpserted,
       killJobsEnqueued: totalKillJobsEnqueued,
       notificationJobsEnqueued: totalNotificationJobsEnqueued,
     });
     
   } catch (error) {
     battleLogger.error('Battle crawl failed', { 
       error: error instanceof Error ? error.message : 'Unknown error' 
     });
     throw error;
   } finally {
     // Clean up battle notifier producer
     await battleNotifierProducer.close();
   }
}

/**
 * Upsert a battle to the database
 */
async function upsertBattle(battle: BattleListItem) {
  return await executeWithRetry(async () => {
    const prisma = getPrisma();
    const existingBattle = await prisma.battle.findUnique({
      where: { albionId: battle.albionId }
    });
    
    const battleData = {
      albionId: battle.albionId,
      startedAt: new Date(battle.startedAt),
      totalFame: battle.totalFame,
      totalKills: battle.totalKills,
      totalPlayers: battle.totalPlayers,
      alliancesJson: battle.alliances,
      guildsJson: battle.guilds,
      ingestedAt: new Date(),
    };
    
    if (existingBattle) {
      // Update existing battle
      const updatedBattle = await prisma.battle.update({
        where: { albionId: battle.albionId },
        data: battleData
      });
      
      return { battle: updatedBattle, wasCreated: false };
    } else {
      // Create new battle
      const newBattle = await prisma.battle.create({
        data: battleData
      });
      
      // Record metrics for new battle
      metrics.recordBattleUpsert();
      
      return { battle: newBattle, wasCreated: true };
    }
  });
}

/**
 * Determine if we should enqueue a kills fetch job for this battle
 * Implements improved logic for kill job enqueuing
 */
function shouldEnqueueKills(battle: BattleListItem, dbBattle: any): boolean {
  const now = new Date();
  const battleStartTime = new Date(battle.startedAt);
  
  // If kills were never fetched, enqueue
  if (dbBattle.killsFetchedAt == null) {
    return true;
  }
  
  // If battle is old enough to be considered complete, skip
  const recheckHoursMs = config.RECHECK_DONE_BATTLE_HOURS * 60 * 60 * 1000;
  if (now.getTime() - battleStartTime.getTime() >= recheckHoursMs) {
    return false; // Consider complete; skip
  }
  
  // If kills were fetched recently, allow light recheck for ongoing fights
  const debounceMinutesMs = config.DEBOUNCE_KILLS_MIN * 60 * 1000;
  if (now.getTime() - dbBattle.killsFetchedAt.getTime() >= debounceMinutesMs) {
    return true; // Allow light recheck for ongoing fights
  }
  
  // Otherwise, skip (kills fetched too recently)
  return false;
}

/**
 * Enqueue a kills fetch job with idempotent behavior
 */
async function enqueueKillsJob(albionId: bigint): Promise<void> {
  try {
         await killsFetchQueue.add(
       'fetch-kills',
       { albionId: albionId.toString() },
       {
         jobId: `battle-${albionId}`,
         removeOnComplete: 10000,
         removeOnFail: 10000,
         attempts: 5,
         backoff: {
           type: 'exponential',
           delay: 5000,
         },
       }
     );
     } catch (error) {
     // Job might already exist (idempotent), log but don't throw
     battleLogger.warn('Could not enqueue kills job', { 
       albionId: albionId.toString(), 
       error: error instanceof Error ? error.message : 'Unknown error' 
     });
   }
}
