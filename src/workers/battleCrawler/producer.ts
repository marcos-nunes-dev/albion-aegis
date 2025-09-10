import { getBattlesPage, getBattleDetail } from '../../http/client.js';
import { getPrisma, executeWithRetry } from '../../db/database.js';
import { killsFetchQueue } from '../../queue/queues.js';
import { setWatermark } from '../../services/watermark.js';
import { config } from '../../lib/config.js';
import type { BattleListItem, BattleDetail } from '../../types/albion.js';
import { battleLogger } from '../../log.js';
import { metrics } from '../../metrics.js';
import { BattleNotifierProducer } from '../battleNotifier/producer.js';
import redis from '../../queue/connection.js';

// Distributed lock for battle crawling
const CRAWL_LOCK_KEY = 'battle-crawl-lock';
const CRAWL_LOCK_TTL = 300; // 5 minutes

/**
 * Acquire a distributed lock for battle crawling
 */
async function acquireCrawlLock(): Promise<boolean> {
  try {
    const lockValue = `crawl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const result = await redis.set(CRAWL_LOCK_KEY, lockValue, 'EX', CRAWL_LOCK_TTL, 'NX');
    return result === 'OK';
  } catch (error) {
    battleLogger.error('Failed to acquire crawl lock', { error: error instanceof Error ? error.message : 'Unknown error' });
    return false;
  }
}

/**
 * Release the distributed lock for battle crawling
 */
async function releaseCrawlLock(): Promise<void> {
  try {
    await redis.del(CRAWL_LOCK_KEY);
  } catch (error) {
    battleLogger.error('Failed to release crawl lock', { error: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Upsert a battle to the database with complete data from API
 */
async function upsertBattle(battle: BattleListItem) {
  return await executeWithRetry(async () => {
    const prisma = getPrisma();
    
    // Fetch complete battle data from API to get full guild/alliance information
    let completeBattleData: BattleDetail | null = null;
    try {
      battleLogger.debug('Fetching complete battle data from API', {
        albionId: battle.albionId.toString()
      });
      completeBattleData = await getBattleDetail(battle.albionId);
    } catch (error) {
      battleLogger.warn('Failed to fetch complete battle data, using list data', {
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
    
    // Record metrics for battle upsert
    metrics.recordBattleUpsert();
    
    // Check if this was a create or update by comparing timestamps
    const wasCreated = result.ingestedAt.getTime() === battleData.ingestedAt.getTime();
    
    battleLogger.info(wasCreated ? 'Created new battle with complete data' : 'Updated existing battle with complete data', {
      albionId: battle.albionId.toString(),
      hasCompleteData: !!completeBattleData,
      guildCount: guildsData.length,
      allianceCount: alliancesData.length,
      totalPlayers: battle.totalPlayers,
      wasCreated
    });
    
    return { battle: result, wasCreated };
  });
}

/**
 * Determine if we should enqueue a kills fetch job for this battle
 * Implements improved logic for kill job enqueuing
 */
function shouldEnqueueKills(battle: BattleListItem, dbBattle: { killsFetchedAt: Date | null }): boolean {
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

/**
 * Run battle crawl with sliding time window to avoid missing late-listed battles
 * Uses soft cutoff instead of watermark to ensure comprehensive coverage
 */
export async function runBattleCrawl(): Promise<void> {
  // Try to acquire the crawl lock
  const lockAcquired = await acquireCrawlLock();
  if (!lockAcquired) {
    battleLogger.info('Another battle crawl is already running, skipping this execution');
    return;
  }

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
     // Release the crawl lock
     await releaseCrawlLock();
   }
}
