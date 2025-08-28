#!/usr/bin/env tsx

// import { runBattleCrawl } from '../src/workers/battleCrawler/producer.js';
import { getBattlesPage, getBattleDetail } from '../src/http/client.js';
import { prisma } from '../src/db/prisma.js';
import { killsFetchQueue } from '../src/queue/queues.js';
import { config } from '../src/lib/config.js';
import type { BattleListItem, BattleDetail } from '../src/types/albion.js';

// Parse command line arguments
function parseArgs(): { cutoff: string; pages: number; sleepMs: number } {
  const args = process.argv.slice(2);
  let cutoff = '';
  let pages = 50;
  let sleepMs = 60000;

  for (const arg of args) {
    if (arg.startsWith('--cutoff=')) {
      cutoff = arg.split('=')[1];
    } else if (arg.startsWith('--pages=')) {
      pages = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--sleepMs=')) {
      sleepMs = parseInt(arg.split('=')[1], 10);
    }
  }

  if (!cutoff) {
    console.error('❌ Error: --cutoff=ISO is required');
    console.error('Example: npm run backfill -- --cutoff=2024-08-01T00:00:00.000Z --pages=50 --sleepMs=60000');
    process.exit(1);
  }

  // Validate cutoff date
  const cutoffDate = new Date(cutoff);
  if (isNaN(cutoffDate.getTime())) {
    console.error('❌ Error: Invalid cutoff date format. Use ISO format (e.g., 2024-08-01T00:00:00.000Z)');
    process.exit(1);
  }

  return { cutoff, pages, sleepMs };
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Upsert a battle to the database with complete data from API
 */
async function upsertBattle(battle: BattleListItem) {
  const existingBattle = await prisma.battle.findUnique({
    where: { albionId: battle.albionId }
  });
  
  // Fetch complete battle data from API to get full guild/alliance information
  let completeBattleData: BattleDetail | null = null;
  try {
    console.log(`📊 Fetching complete battle data for ${battle.albionId}...`);
    completeBattleData = await getBattleDetail(battle.albionId);
  } catch (error) {
    console.warn(`⚠️ Failed to fetch complete battle data for ${battle.albionId}, using list data:`, error);
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
    const updatedBattle = await prisma.battle.update({
      where: { albionId: battle.albionId },
      data: battleData
    });
    console.log(`✅ Updated battle ${battle.albionId} with complete data (${guildsData.length} guilds, ${alliancesData.length} alliances)`);
    return { battle: updatedBattle, wasCreated: false };
  } else {
    const newBattle = await prisma.battle.create({
      data: battleData
    });
    console.log(`✅ Created battle ${battle.albionId} with complete data (${guildsData.length} guilds, ${alliancesData.length} alliances)`);
    return { battle: newBattle, wasCreated: true };
  }
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
    console.warn(`⚠️  Could not enqueue kills job for battle ${albionId}:`, error);
  }
}

/**
 * Run backfill crawl with custom parameters
 */
async function runBackfill(cutoffISO: string, maxPages: number, sleepMs: number): Promise<void> {
  console.log('🔄 Starting backfill crawl...');
  console.log(`📅 Cutoff: ${cutoffISO}`);
  console.log(`📄 Max pages: ${maxPages}`);
  console.log(`⏸️  Sleep between pages: ${sleepMs}ms`);
  
  const startTime = Date.now();
  const softCutoff = new Date(cutoffISO);
  
  let totalBattlesProcessed = 0;
  let totalBattlesUpserted = 0;
  let totalKillJobsEnqueued = 0;
  let pagesProcessed = 0;
  let allObjectsExistCount = 0;
  
  try {
    // Crawl pages until we hit the soft cutoff or max pages
    for (let page = 0; page < maxPages; page++) {
      pagesProcessed++;
      console.log(`\n📄 Processing page ${page + 1}/${maxPages}...`);
      
      // Fetch battles for this page
      const battles = await getBattlesPage(page, 10); // minPlayers = 10
      
      if (battles.length === 0) {
        console.log('📄 No more battles found, stopping backfill');
        break;
      }
      
      let allOlderThanCutoff = true;
      let pageBattlesUpserted = 0;
      let pageKillJobsEnqueued = 0;
      let pageAllObjectsExist = true;
      
      // Process each battle on this page
      for (const battle of battles) {
        const battleStartTime = new Date(battle.startedAt);
        totalBattlesProcessed++;
        
        // Check if this battle is newer than soft cutoff
        if (battleStartTime >= softCutoff) {
          allOlderThanCutoff = false;
        }
        
        // Upsert battle to database
        try {
          const upsertResult = await upsertBattle(battle);
          if (upsertResult.wasCreated) {
            pageBattlesUpserted++;
            totalBattlesUpserted++;
            pageAllObjectsExist = false;
          }
          
                     // Enqueue kill fetch job with improved logic
           const shouldEnqueue = shouldEnqueueKills(battle, upsertResult.battle);
           if (shouldEnqueue) {
             await enqueueKillsJob(battle.albionId);
             pageKillJobsEnqueued++;
             totalKillJobsEnqueued++;
           }
          
        } catch (error) {
          console.error(`❌ Failed to process battle ${battle.albionId}:`, error);
        }
      }
      
      console.log(`📄 Page ${page + 1} complete: ${pageBattlesUpserted} new battles, ${pageKillJobsEnqueued} kill jobs enqueued`);
      
      // Check if all objects already exist on this page
      if (pageAllObjectsExist) {
        allObjectsExistCount++;
        console.log(`📝 Page ${page + 1}: All battles already exist in database`);
      }
      
      // If all battles on this page are older than cutoff and all objects exist, stop backfill
      if (allOlderThanCutoff && pageAllObjectsExist) {
        console.log(`⏹️  All battles on page ${page + 1} are older than cutoff and already exist, stopping backfill`);
        break;
      }
      
      // Sleep between pages (except on the last page)
      if (page < maxPages - 1 && battles.length > 0) {
        console.log(`⏸️  Sleeping for ${sleepMs}ms before next page...`);
        await sleep(sleepMs);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`\n✅ Backfill completed in ${duration}ms:`);
    console.log(`  - Pages processed: ${pagesProcessed}`);
    console.log(`  - Battles processed: ${totalBattlesProcessed}`);
    console.log(`  - New battles: ${totalBattlesUpserted}`);
    console.log(`  - Kill jobs enqueued: ${totalKillJobsEnqueued}`);
    console.log(`  - Pages with all existing objects: ${allObjectsExistCount}`);
    console.log(`\n💡 Note: Live watermark was NOT advanced during backfill`);
    
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    // Parse command line arguments
    const { cutoff, pages, sleepMs } = parseArgs();
    
    console.log('🧪 Albion Backfill Tool');
    console.log('📊 Configuration:', {
      NODE_ENV: config.NODE_ENV,
      API_BASE_URL: config.API_BASE_URL,
      REDIS_URL: config.REDIS_URL ? '***configured***' : '❌ missing',
      DATABASE_URL: config.DATABASE_URL ? '***configured***' : '❌ missing',
    });
    
    // Test database connection
    console.log('\n🔗 Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connection successful');
    
    // Run the backfill
    console.log('\n🔄 Running backfill crawl...');
    await runBackfill(cutoff, pages, sleepMs);
    
  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  } finally {
    // Always disconnect from database
    await prisma.$disconnect();
    console.log('🔌 Database disconnected');
  }
}

// Run the backfill
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
