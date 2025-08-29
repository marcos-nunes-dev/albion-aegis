import { prisma } from '../src/db/prisma.js';
import { MmrIntegrationService } from '../src/services/mmrIntegration.js';
import { SeasonService } from '../src/services/season.js';
import { GuildService } from '../src/services/guild.js';
import { MmrService } from '../src/services/mmr.js';

const mmrIntegration = new MmrIntegrationService(prisma);
const seasonService = new SeasonService(prisma);
const guildService = new GuildService(prisma);
const mmrService = new MmrService(prisma);

console.log('🏆 Albion MMR Management Tool');

// Get command line arguments
const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  try {
    await prisma.$connect();
    console.log('✅ Database connection successful');

    switch (command) {
      case 'create-season':
        await createSeason(args);
        break;
      case 'list-seasons':
        await listSeasons();
        break;
      case 'activate-season':
        await activateSeason(args);
        break;
      case 'end-season':
        await endSeason(args);
        break;
      case 'add-prime-time':
        await addPrimeTime(args);
        break;
      case 'list-prime-times':
        await listPrimeTimes();
        break;
      case 'process-historical':
        await processHistorical(args);
        break;
      case 'process-season-end':
        await processSeasonEnd(args);
        break;
      case 'initialize-season-with-carryover':
        await initializeSeasonWithCarryover(args);
        break;
      case 'get-stats':
        await getStats();
        break;
      case 'health-check':
        await healthCheck();
        break;
      case 'top-guilds':
        await getTopGuilds(args);
        break;
      case 'guild-mmr':
        await getGuildMmr(args);
        break;
      case 'guild-prime-time-mass':
        await getGuildPrimeTimeMass(args);
        break;
      case 'test-anti-farming':
        await testAntiFarming(args);
        break;
      default:
        showHelp();
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function createSeason(args: string[]) {
  if (args.length < 2) {
    console.log('Usage: create-season <name> <startDate> [endDate]');
    console.log('Example: create-season "Season 1" "2024-01-01" "2024-02-01"');
    return;
  }

  const [name, startDateStr, endDateStr] = args;
  const startDate = new Date(startDateStr);
  const endDate = endDateStr ? new Date(endDateStr) : undefined;

  await seasonService.createSeason(name, startDate, endDate);
  console.log('✅ Season created successfully');
}

async function listSeasons() {
  const seasons = await seasonService.getAllSeasons();
  console.log('📋 Seasons:');
  seasons.forEach(season => {
    console.log(`  ${season.id}: ${season.name} (${season.startDate.toISOString()} - ${season.endDate?.toISOString() || 'ongoing'}) ${season.isActive ? '🟢 ACTIVE' : '🔴 INACTIVE'}`);
  });
}

async function activateSeason(args: string[]) {
  if (args.length < 1) {
    console.log('Usage: activate-season <seasonId>');
    return;
  }

  const seasonId = args[0];
  await seasonService.activateSeason(seasonId);
  console.log('✅ Season activated:', seasonId);
}

async function endSeason(args: string[]) {
  if (args.length < 1) {
    console.log('Usage: end-season <seasonId> [endDate]');
    console.log('Example: end-season "season-1" "2024-02-01"');
    return;
  }

  const [seasonId, endDateStr] = args;
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  
  await seasonService.endSeason(seasonId, endDate);
  console.log('✅ Season ended:', seasonId, 'at', endDate.toISOString());
}

async function addPrimeTime(args: string[]) {
  if (args.length < 2) {
    console.log('Usage: add-prime-time <startHour> <endHour>');
    console.log('Example: add-prime-time 20 21');
    return;
  }

  const [startHourStr, endHourStr] = args;
  const startHour = parseInt(startHourStr);
  const endHour = parseInt(endHourStr);

  await seasonService.addPrimeTimeWindow(startHour, endHour);
  console.log('✅ Global prime time window added:', { startHour, endHour });
}

async function listPrimeTimes() {
  const windows = await seasonService.getPrimeTimeWindows();
  console.log('📋 Global prime time windows:');
  if (windows.length === 0) {
    console.log('  No prime time windows configured');
  } else {
    windows.forEach((window, index) => {
      console.log(`  ${index + 1}. ${window.startHour}:00 - ${window.endHour}:00 UTC (ID: ${window.id})`);
    });
  }
}

async function processHistorical(args: string[]) {
  if (args.length < 2) {
    console.log('Usage: process-historical <startDate> <endDate> [batchSize]');
    console.log('Example: process-historical "2024-01-01" "2024-01-31" 100');
    return;
  }

  const [startDateStr, endDateStr, batchSizeStr] = args;
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  const batchSize = batchSizeStr ? parseInt(batchSizeStr) : 100;

  console.log('🔄 Processing historical battles...');
  await mmrIntegration.processHistoricalBattlesForMmr(startDate, endDate, batchSize);
  console.log('✅ Historical processing completed');
}

async function processSeasonEnd(args: string[]) {
  if (args.length < 1) {
    console.log('Usage: process-season-end <seasonId>');
    return;
  }

  const seasonId = args[0];
  console.log(`🏁 Processing season end and MMR carryover for season ${seasonId}...`);
  await mmrService.processSeasonEnd(seasonId);
  console.log('✅ Season end processing completed');
}

async function initializeSeasonWithCarryover(args: string[]) {
  if (args.length < 2) {
    console.log('Usage: initialize-season-with-carryover <newSeasonId> <previousSeasonId>');
    return;
  }

  const [newSeasonId, previousSeasonId] = args;
  console.log(`🆕 Initializing new season ${newSeasonId} with carryover from ${previousSeasonId}...`);
  await mmrService.initializeNewSeason(newSeasonId, previousSeasonId);
  console.log('✅ New season initialization completed');
}

async function getStats() {
  const stats = await mmrIntegration.getMmrProcessingStats();
  console.log('📊 MMR Processing Statistics:');
  console.log(`  Total battles processed: ${stats.totalBattlesProcessed}`);
  console.log(`  Total guilds tracked: ${stats.totalGuildsTracked}`);
  console.log(`  Active seasons: ${stats.activeSeasons}`);
  if (stats.lastProcessedBattle) {
    console.log(`  Last processed battle: ${stats.lastProcessedBattle.toISOString()}`);
  }
}

async function healthCheck() {
  const health = await mmrIntegration.validateMmrSystemHealth();
  console.log('🏥 MMR System Health Check:');
  console.log(`  Status: ${health.isHealthy ? '🟢 HEALTHY' : '🔴 UNHEALTHY'}`);
  
  if (health.issues.length > 0) {
    console.log('  Issues:');
    health.issues.forEach(issue => console.log(`    ❌ ${issue}`));
  }
  
  if (health.recommendations.length > 0) {
    console.log('  Recommendations:');
    health.recommendations.forEach(rec => console.log(`    💡 ${rec}`));
  }
}

async function getTopGuilds(args: string[]) {
  const limit = args.length > 0 ? parseInt(args[0]) : 10;
  const seasonId = args.length > 1 ? args[1] : undefined;

  let season;
  if (seasonId) {
    season = await seasonService.getSeasonById(seasonId);
  } else {
    season = await seasonService.getActiveSeason();
  }

  if (!season) {
    console.log('❌ No season found');
    return;
  }

  const topGuilds = await mmrService.getTopGuildsByMmr(season.id, limit);
  console.log(`🏆 Top ${limit} Guilds in ${season.name}:`);
  
  // Fetch guild names for display
  for (let i = 0; i < topGuilds.length; i++) {
    const guildSeason = topGuilds[i];
    const guild = await guildService.getGuildById(guildSeason.guildId);
    const guildName = guild?.name || `Unknown Guild (${guildSeason.guildId})`;
    console.log(`  ${i + 1}. ${guildName}: ${guildSeason.currentMmr.toFixed(1)} MMR`);
  }
}

async function getGuildMmr(args: string[]) {
  if (args.length < 1) {
    console.log('Usage: guild-mmr <guildName> [seasonId]');
    return;
  }

  const [guildName, seasonId] = args;
  const guild = await guildService.getGuildByName(guildName);
  
  if (!guild) {
    console.log('❌ Guild not found:', guildName);
    return;
  }

  let season;
  if (seasonId) {
    season = await seasonService.getSeasonById(seasonId);
  } else {
    season = await seasonService.getActiveSeason();
  }

  if (!season) {
    console.log('❌ No season found');
    return;
  }

  const guildSeason = await mmrService.getGuildSeasonMmr(guild.id, season.id);
  if (guildSeason) {
    console.log(`🏆 ${guildName} MMR in ${season.name}:`);
    console.log(`  Current MMR: ${guildSeason.currentMmr.toFixed(1)}`);
    console.log(`  Last battle: ${guildSeason.lastBattleAt?.toISOString() || 'Never'}`);
  } else {
    console.log(`❌ No MMR data found for ${guildName} in ${season.name}`);
  }
}

async function getGuildPrimeTimeMass(args: string[]) {
  if (args.length < 2) {
    console.log('Usage: guild-prime-time-mass <guildId> <seasonId>');
    return;
  }

  const [guildId, seasonId] = args;
  const guildSeason = await mmrService.getGuildSeasonMmr(guildId, seasonId);

  if (!guildSeason) {
    console.log('❌ Guild season not found');
    return;
  }

  const primeTimeMassData = await mmrService.getGuildPrimeTimeMass(guildSeason.id);
  if (primeTimeMassData.length > 0) {
    console.log('✅ Prime time mass data:');
    primeTimeMassData.forEach((mass: any) => {
      console.log(`  - ${mass.primeTimeWindow.startHour}:00-${mass.primeTimeWindow.endHour}:00: ${mass.avgMass.toFixed(1)} avg players (${mass.battleCount} battles)`);
    });
  } else {
    console.log('ℹ️  No prime time mass data available yet (requires database migration and Prisma client regeneration)');
  }
}

async function testAntiFarming(args: string[]) {
  if (args.length < 2) {
    console.log('Usage: test-anti-farming <guildName> <opponentGuildName>');
    console.log('Example: test-anti-farming "Guild A" "Guild B"');
    return;
  }

  const [guildName, opponentGuildName] = args;
  
  console.log(`🔍 Testing anti-farming system for ${guildName} vs ${opponentGuildName}`);
  
  // Get current active season
  const season = await seasonService.getActiveSeason();
  if (!season) {
    console.log('❌ No active season found');
    return;
  }
  
  // Get guild
  const guild = await guildService.getGuildByName(guildName);
  if (!guild) {
    console.log(`❌ Guild not found: ${guildName}`);
    return;
  }
  
  console.log(`📊 Testing anti-farming factor for guild ${guildName} (ID: ${guild.id}) in season ${season.name}`);
  
  // Test the anti-farming calculation
  const antiFarmingFactor = await mmrService['calculateAntiFarmingFactor'](
    guild.id,
    season.id,
    [opponentGuildName],
    true // isWin = true
  );
  
  console.log(`🎯 Anti-farming factor: ${antiFarmingFactor.toFixed(3)}`);
  
  if (antiFarmingFactor < 1.0) {
    console.log(`⚠️  Anti-farming is active! MMR gains will be reduced by ${((1 - antiFarmingFactor) * 100).toFixed(1)}%`);
  } else {
    console.log(`✅ No anti-farming reduction applied`);
  }
  
  // Show recent wins against this opponent
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - 30);
  
  const recentWins = await prisma.mmrCalculationLog.findMany({
    where: {
      guildId: guild.id,
      seasonId: season.id,
      isWin: true,
      processedAt: {
        gte: lookbackDate
      },
      opponentGuilds: {
        has: opponentGuildName
      }
    },
    select: {
      battleId: true,
      processedAt: true,
      opponentGuilds: true
    },
    orderBy: {
      processedAt: 'desc'
    }
  });
  
  console.log(`📈 Recent wins against ${opponentGuildName} in the last 30 days: ${recentWins.length}`);
  
  if (recentWins.length > 0) {
    console.log('📋 Recent battles:');
    recentWins.slice(0, 5).forEach((win, index) => {
      console.log(`  ${index + 1}. Battle ${win.battleId} - ${win.processedAt.toISOString()}`);
    });
  }
}

function showHelp() {
  console.log(`
🏆 Albion MMR Management Tool

Commands:
  create-season <name> <startDate> [endDate]     Create a new season
  list-seasons                                    List all seasons
  activate-season <seasonId>                     Activate a season
  end-season <seasonId> [endDate]                End a season
  add-prime-time <seasonId> <startHour> <endHour> Add prime time window
  list-prime-times <seasonId>                    List prime time windows
  process-historical <startDate> <endDate> [batchSize] Process historical battles
  process-season-end <seasonId>                  Process season end and MMR carryover
  initialize-season-with-carryover <newSeasonId> <previousSeasonId> Initialize new season with carryover
  get-stats                                       Get MMR processing statistics
  health-check                                    Check MMR system health
  top-guilds [limit] [seasonId]                  Get top guilds by MMR
  guild-mmr <guildName> [seasonId]               Get guild MMR
  guild-prime-time-mass <guildId> <seasonId>    Get prime time mass data for a guild
  test-anti-farming <guildName> <opponentGuildName> Test anti-farming system

Examples:
  yarn tsx apps/manage-mmr.ts create-season "Season 1" "2024-01-01"
  yarn tsx apps/manage-mmr.ts process-historical "2024-01-01" "2024-01-31" 50
  yarn tsx apps/manage-mmr.ts top-guilds 20
  yarn tsx apps/manage-mmr.ts guild-mmr "S L I C E D"
`);
}

main().catch(console.error);
