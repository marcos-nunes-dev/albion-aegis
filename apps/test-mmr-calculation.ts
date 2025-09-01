#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import { MmrService } from "../src/services/mmr.js";

import { SeasonService } from "../src/services/season.js";
import { log } from "../src/log.js";
import { getBattleDetail } from "../src/http/client.js";

const logger = log.child({ component: "test-mmr-calculation" });

interface BattleData {
  albionId: bigint;
  startedAt: string;
  finishedAt?: string;
  totalFame: number;
  totalKills: number;
  totalPlayers: number;
  players: PlayerData[];
}

interface PlayerData {
  name: string;
  guildName?: string;
  allianceName?: string;
  killFame: number;
  deathFame: number;
  kills: number;
  deaths: number;
  ip: number;
}

interface GuildBattleStats {
  guildName: string;
  guildId: string;
  kills: number;
  deaths: number;
  fameGained: number;
  fameLost: number;
  players: number;
  avgIP: number;
  isPrimeTime: boolean;
  currentMmr: number;
  killClustering: number;
}

interface BattleAnalysis {
  battleId: bigint;
  seasonId: string;
  guildStats: GuildBattleStats[];
  totalPlayers: number;
  totalFame: number;
  battleDuration: number;
  isPrimeTime: boolean;
  killClustering: number;
  friendGroups: string[][];
  guildAlliances?: Map<string, string>;
}

async function fetchBattleData(battleId: number): Promise<BattleData | null> {
  try {
    const response = await getBattleDetail(BigInt(battleId));
    
    if (!response || !response.albionId) {
      logger.error("Invalid battle data received", { battleId });
      return null;
    }
    
    return response as BattleData;
  } catch (error) {
    logger.error("Error fetching battle data", {
      battleId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

function processBattleData(battleData: BattleData): {
  guildStats: GuildBattleStats[];
  totalPlayers: number;
  totalFame: number;
  guildAlliances: Map<string, string>;
} {
  const guildMap = new Map<string, GuildBattleStats>();
  const guildAlliances = new Map<string, string>();
  
  // Process each player
  for (const player of battleData.players) {
    const guildName = player.guildName || "No Guild";
    const allianceName = player.allianceName || "No Alliance";
    
    // Store alliance mapping
    guildAlliances.set(guildName, allianceName);
    
    // Get or create guild stats
    let guildStat = guildMap.get(guildName);
    if (!guildStat) {
      guildStat = {
        guildName,
        guildId: guildName, // Using guild name as ID for this test
        kills: 0,
        deaths: 0,
        fameGained: 0,
        fameLost: 0,
        players: 0,
        avgIP: 0,
        isPrimeTime: false,
        currentMmr: 1000, // Default MMR for testing
        killClustering: 0,
      };
      guildMap.set(guildName, guildStat);
    }
    
    // Accumulate stats
    guildStat.kills += player.kills;
    guildStat.deaths += player.deaths;
    guildStat.fameGained += player.killFame;
    guildStat.fameLost += player.deathFame;
    guildStat.players += 1;
    guildStat.avgIP += player.ip;
  }
  
  // Calculate averages and convert to array
  const guildStats: GuildBattleStats[] = Array.from(guildMap.values()).map(guild => ({
    ...guild,
    avgIP: guild.avgIP / guild.players,
  }));
  
  const totalPlayers = battleData.players.length;
  const totalFame = battleData.totalFame;
  
  return { guildStats, totalPlayers, totalFame, guildAlliances };
}

async function getCurrentSeason(prisma: PrismaClient): Promise<string> {
  const activeSeason = await prisma.season.findFirst({
    where: { isActive: true },
    orderBy: { startDate: "desc" },
  });
  
  if (!activeSeason) {
    throw new Error("No active season found. Please create and activate a season first.");
  }
  
  return activeSeason.id;
}

async function getGuildCurrentMmr(prisma: PrismaClient, guildName: string, seasonId: string): Promise<number> {
  try {
    // First find the guild by name
    const guild = await prisma.guild.findUnique({
      where: { name: guildName },
    });
    
    if (!guild) {
      return 1000; // Default MMR for new guilds
    }
    
    // Then find the guild season record
    const guildSeason = await prisma.guildSeason.findUnique({
      where: {
        guildId_seasonId: {
          guildId: guild.id,
          seasonId,
        },
      },
    });
    
    return guildSeason?.currentMmr || 1000;
  } catch (error) {
    logger.warn("Error getting guild MMR, using default", { guildName, error });
    return 1000;
  }
}

async function testMmrCalculation(battleId: number) {
  console.log(`🏆 Testing MMR Calculation for Battle ${battleId}`);
  console.log("=" .repeat(60));
  
  try {
    // Initialize services
    const prisma = new PrismaClient();
    const seasonService = new SeasonService(prisma);
    const mmrService = new MmrService(prisma);
    
    // Fetch battle data from API
    console.log(`\n📡 Fetching battle data from API...`);
    const battleData = await fetchBattleData(battleId);
    
    if (!battleData) {
      console.log("❌ Failed to fetch battle data. Please check the battle ID.");
      return;
    }
    
    console.log(`✅ Battle data fetched successfully!`);
    console.log(`   Total Players: ${battleData.players.length}`);
    console.log(`   Total Fame: ${battleData.totalFame.toLocaleString()}`);
    console.log(`   Start Time: ${battleData.startedAt}`);
    console.log(`   End Time: ${battleData.finishedAt || 'Ongoing'}`);
    
    // Process battle data
    const { guildStats: rawGuildStats, totalPlayers, totalFame, guildAlliances } = processBattleData(battleData);
    
    // Get current season
    const seasonId = await getCurrentSeason(prisma);
    console.log(`\n📅 Using active season: ${seasonId}`);
    
    // Get current MMR for each guild
    console.log(`\n🔍 Fetching current MMR for guilds...`);
    const guildStats: GuildBattleStats[] = [];
    
    for (const guildStat of rawGuildStats) {
      const currentMmr = await getGuildCurrentMmr(prisma, guildStat.guildName, seasonId);
      guildStats.push({
        ...guildStat,
        currentMmr,
      });
    }
    
    // Create battle analysis
    const battleAnalysis: BattleAnalysis = {
      battleId: BigInt(battleId),
      seasonId,
      guildStats,
      totalPlayers,
      totalFame,
      battleDuration: battleData.finishedAt ? 
        Math.floor((new Date(battleData.finishedAt).getTime() - new Date(battleData.startedAt).getTime()) / 60000) : 0,
      isPrimeTime: await seasonService.isPrimeTime(seasonId, new Date(battleData.startedAt)),
      killClustering: 0, // Simplified for this test
      friendGroups: [],
      guildAlliances,
    };
    
    console.log(`\n🔍 Participation Analysis:`);
    console.log("=" .repeat(40));
    
    // Analyze participation for each guild
    const participationResults: Array<{
      guild: GuildBattleStats;
      hasSignificantParticipation: boolean;
      fameRatio: number;
      killsDeathsRatio: number;
      playerRatio: number;
      reasons: string[];
    }> = [];
    
    for (const guildStat of guildStats) {
      const hasSignificantParticipation = MmrService.hasSignificantParticipation(
        guildStat,
        battleAnalysis
      );
      
      const fameParticipation = guildStat.fameGained + guildStat.fameLost;
      const killsDeaths = guildStat.kills + guildStat.deaths;
      const fameRatio = (fameParticipation / totalFame) * 100;
      const killsDeathsRatio = (killsDeaths / (battleData.totalKills + 0)) * 100; // Using totalKills as proxy for total kills+deaths
      const playerRatio = (guildStat.players / totalPlayers) * 100;
      
      const reasons: string[] = [];
      if (!hasSignificantParticipation) {
        if (fameRatio < 10) reasons.push(`Fame ratio too low (${fameRatio.toFixed(1)}% < 10%)`);
        if (killsDeathsRatio < 10) reasons.push(`Kills/deaths ratio too low (${killsDeathsRatio.toFixed(1)}% < 10%)`);
        if (playerRatio < 10) reasons.push(`Player ratio too low (${playerRatio.toFixed(1)}% < 10%)`);
        if (guildStat.players <= 1 && killsDeaths < 8) reasons.push(`Single player needs 8+ kills/deaths (has ${killsDeaths})`);
        if (guildStat.players <= 1 && fameParticipation < 1000000) reasons.push(`Single player needs 1M+ fame (has ${fameParticipation.toLocaleString()})`);
        if (guildStat.kills === 0 && guildStat.deaths === 0) reasons.push(`No kills or deaths`);
      }
      
      participationResults.push({
        guild: guildStat,
        hasSignificantParticipation,
        fameRatio,
        killsDeathsRatio,
        playerRatio,
        reasons,
      });
    }
    
    // Display participation analysis
    for (const result of participationResults) {
      const { guild, hasSignificantParticipation, fameRatio, killsDeathsRatio, playerRatio, reasons } = result;
      
      console.log(`\n${guild.guildName}:`);
      console.log(`  Players: ${guild.players} (${playerRatio.toFixed(1)}% of total)`);
      console.log(`  Kills/Deaths: ${guild.kills}/${guild.deaths} (${guild.kills + guild.deaths} total, ${killsDeathsRatio.toFixed(1)}% of total)`);
      console.log(`  Fame: ${(guild.fameGained + guild.fameLost).toLocaleString()} (${fameRatio.toFixed(1)}% of total)`);
      console.log(`  Current MMR: ${guild.currentMmr.toFixed(1)}`);
      console.log(`  Significant Participation: ${hasSignificantParticipation ? '✅ YES' : '❌ NO'}`);
      
      if (!hasSignificantParticipation && reasons.length > 0) {
        console.log(`  ❌ REASONS: ${reasons.join(', ')}`);
      }
    }
    
    // Filter to only guilds with significant participation
    const significantGuilds = guildStats.filter(guildStat => 
      MmrService.hasSignificantParticipation(guildStat, battleAnalysis)
    );
    
    console.log(`\n🎯 MMR Calculation Results:`);
    console.log("=" .repeat(40));
    console.log(`Guilds with significant participation: ${significantGuilds.length}/${guildStats.length}`);
    
    if (significantGuilds.length === 0) {
      console.log(`\n⚠️  No guilds meet the participation criteria for MMR calculation.`);
      console.log(`   This battle will not affect any guild MMR.`);
      return;
    }
    
    // Calculate MMR changes
    const mmrResults = await mmrService.calculateMmrForBattle(battleAnalysis);
    
    console.log(`\n📊 MMR Changes:`);
    console.log("-" .repeat(40));
    
    for (const guildStat of significantGuilds) {
      const result = mmrResults.get(guildStat.guildId);
      if (result) {
        const newMmr = guildStat.currentMmr + result.mmrChange;
        const changeSymbol = result.mmrChange >= 0 ? '+' : '';
        
        console.log(`${guildStat.guildName}:`);
        console.log(`  Current MMR: ${guildStat.currentMmr.toFixed(1)}`);
        console.log(`  MMR Change: ${changeSymbol}${result.mmrChange.toFixed(2)}`);
        console.log(`  New MMR: ${newMmr.toFixed(1)}`);
        
        if (result.antiFarmingFactor !== undefined) {
          console.log(`  Anti-farming factor: ${result.antiFarmingFactor.toFixed(3)}`);
        }
        console.log('');
      }
    }
    
    // Summary
    console.log(`\n📈 Summary:`);
    console.log("=" .repeat(40));
    console.log(`Battle ID: ${battleId}`);
    console.log(`Total Guilds: ${guildStats.length}`);
    console.log(`Included in MMR: ${significantGuilds.length}`);
    console.log(`Excluded from MMR: ${guildStats.length - significantGuilds.length}`);
    
    const excludedGuilds = guildStats.filter(guildStat => 
      !MmrService.hasSignificantParticipation(guildStat, battleAnalysis)
    );
    
    if (excludedGuilds.length > 0) {
      console.log(`\n❌ Excluded Guilds:`);
      for (const guild of excludedGuilds) {
        const result = participationResults.find(r => r.guild.guildName === guild.guildName);
        if (result) {
          console.log(`  - ${guild.guildName}: ${result.reasons.join(', ')}`);
        }
      }
    }
    
    await prisma.$disconnect();
    
  } catch (error) {
    console.error("❌ Error during MMR calculation test:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
    }
  }
}

// CLI argument handling
const battleId = process.argv[2];

if (!battleId) {
  console.log("Usage: yarn tsx apps/test-mmr-calculation.ts <battleId>");
  console.log("Example: yarn tsx apps/test-mmr-calculation.ts 1268814359");
  process.exit(1);
}

const battleIdNumber = parseInt(battleId, 10);
if (isNaN(battleIdNumber)) {
  console.log("❌ Invalid battle ID. Please provide a valid number.");
  process.exit(1);
}

// Run the test
testMmrCalculation(battleIdNumber).catch(console.error);
