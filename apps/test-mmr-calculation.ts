#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import { MmrService } from "../src/services/mmr.js";
import { GuildService } from "../src/services/guild.js";
import { BattleAnalysisService } from "../src/services/battleAnalysis.js";
import { log } from "../src/log.js";
import { getBattleDetail, getKillsForBattle } from "../src/http/client.js";

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

// BattleAnalysis interface is imported from mmr service

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

async function fetchKillData(battleId: number): Promise<any[]> {
  try {
    const response = await getKillsForBattle(BigInt(battleId));
    return response || [];
  } catch (error) {
    logger.error("Error fetching kill data", {
      battleId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
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

async function processBattleData(battleData: BattleData): Promise<{
  guildStats: GuildBattleStats[];
  totalPlayers: number;
  totalFame: number;
  guildAlliances: Map<string, string>;
}> {
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

async function testMmrCalculation(battleId: number) {
  console.log(`🏆 Testing Complete MMR Calculation for Battle ${battleId}`);
  console.log("=" .repeat(70));
  
  try {
    // Initialize services
    const prisma = new PrismaClient();
    const guildService = new GuildService(prisma);
    const mmrService = new MmrService(prisma);
    const battleAnalysisService = new BattleAnalysisService(prisma);
    
    // Step 1: Fetch battle data from API
    console.log(`\n📡 Step 1: Fetching battle data from API...`);
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
    
    // Step 2: Fetch kill data from API
    console.log(`\n🗡️ Step 2: Fetching kill data from API...`);
    const killData = await fetchKillData(battleId);
    console.log(`✅ Kill data fetched successfully! (${killData.length} kills)`);
    
    // Step 3: Get current season
    const seasonId = await getCurrentSeason(prisma);
    console.log(`\n📅 Step 3: Using active season: ${seasonId}`);
    
    // Step 4: Process battle data and create guilds
    console.log(`\n🏆 Step 4: Processing battle data and creating guilds...`);
    const { guildStats: rawGuildStats, guildAlliances } = await processBattleData(battleData);
    
    // Create guilds in database
    const guildStats: GuildBattleStats[] = [];
    for (const guildStat of rawGuildStats) {
      if (guildStat.guildName !== "No Guild") {
        try {
          console.log(`   Creating/finding guild: ${guildStat.guildName}`);
          const guild = await guildService.getOrCreateGuild(guildStat.guildName);
          guildStat.guildId = guild.id;
          console.log(`   ✅ Guild ${guildStat.guildName} (ID: ${guild.id})`);
        } catch (error) {
          console.log(`   ⚠️ Error creating guild ${guildStat.guildName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue with placeholder ID
          guildStat.guildId = `placeholder_${guildStat.guildName}`;
        }
      } else {
        guildStat.guildId = "no_guild";
      }
      
      // Get current MMR for this guild
      const currentMmr = await getGuildCurrentMmr(prisma, guildStat.guildName, seasonId);
      guildStat.currentMmr = currentMmr;
      
      guildStats.push(guildStat);
    }
    
    // Step 4.5: Save battle data to database (required for prime time mass tracking)
    console.log(`\n💾 Step 4.5: Saving battle data to database...`);
    
    // Check if battle already exists in database
    let existingBattle = await prisma.battle.findUnique({
      where: { albionId: BigInt(battleId) }
    });
    
    if (!existingBattle) {
      // Create battle record in database
      existingBattle = await prisma.battle.create({
        data: {
          albionId: BigInt(battleId),
          startedAt: new Date(battleData.startedAt),
          totalFame: battleData.totalFame,
          totalKills: battleData.totalKills,
          totalPlayers: battleData.totalPlayers,
          alliancesJson: [], // Empty for now
          guildsJson: guildStats.map(guildStat => ({
            name: guildStat.guildName,
            kills: guildStat.kills,
            deaths: guildStat.deaths,
            killFame: guildStat.fameGained,
            players: guildStat.players,
            ip: guildStat.avgIP,
            albionId: guildStat.guildId
          }))
        }
      });
      console.log(`   ✅ Created battle record in database: ${existingBattle.albionId}`);
    } else {
      console.log(`   ℹ️  Battle already exists in database: ${existingBattle.albionId}`);
    }
    
    // Step 5: Create battle analysis using the service
    console.log(`\n🔍 Step 5: Creating battle analysis...`);
    
    // Transform battle data to include guildsJson (required by battle analysis service)
    const processedBattleData = {
      ...battleData,
      guildsJson: guildStats.map(guildStat => ({
        name: guildStat.guildName,
        kills: guildStat.kills,
        deaths: guildStat.deaths,
        killFame: guildStat.fameGained,
        players: guildStat.players,
        ip: guildStat.avgIP,
        albionId: guildStat.guildId
      }))
    };
    
    const battleAnalysis = await battleAnalysisService.createBattleAnalysis(
      BigInt(battleId),
      processedBattleData,
      killData
    );
    
    if (!battleAnalysis) {
      console.log("❌ Battle analysis could not be created. This might be due to:");
      console.log("   - Battle doesn't meet MMR criteria (25+ players, 2M+ fame)");
      console.log("   - No active season for the battle date");
      console.log("   - Not enough guilds with significant participation");
      return;
    }
    
    console.log(`✅ Battle analysis created successfully!`);
    console.log(`   Guilds in analysis: ${battleAnalysis.guildStats.length}`);
    console.log(`   Total Players: ${battleAnalysis.totalPlayers}`);
    console.log(`   Total Fame: ${battleAnalysis.totalFame.toLocaleString()}`);
    console.log(`   Is Prime Time: ${battleAnalysis.isPrimeTime ? 'Yes' : 'No'}`);
    
    // Step 6: Calculate MMR changes
    console.log(`\n📊 Step 6: Calculating MMR changes...`);
    const mmrResults = await mmrService.calculateMmrForBattle(battleAnalysis);
    
    console.log(`✅ MMR calculation completed!`);
    console.log(`   Guilds with MMR changes: ${mmrResults.size}`);
    
    // Step 7: Save MMR calculations to database
    console.log(`\n💾 Step 7: Saving MMR calculations to database...`);
    
    // Create MMR calculation job
    const mmrJob = await prisma.mmrCalculationJob.upsert({
      where: {
        battleId_seasonId: {
          battleId: BigInt(battleId),
          seasonId: battleAnalysis.seasonId
        }
      },
      update: {
        status: 'COMPLETED',
        processedAt: new Date(),
      },
      create: {
        battleId: BigInt(battleId),
        seasonId: battleAnalysis.seasonId,
        status: 'COMPLETED',
        processedAt: new Date(),
      }
    });
    
    console.log(`✅ Created MMR calculation job: ${mmrJob.id}`);
    
    // Save individual MMR calculation logs
    let savedLogs = 0;
    for (const guildStat of battleAnalysis.guildStats) {
      const result = mmrResults.get(guildStat.guildId);
      if (result) {
        try {
          await prisma.mmrCalculationLog.create({
            data: {
              battleId: BigInt(battleId),
              seasonId: battleAnalysis.seasonId,
              guildId: guildStat.guildId,
              guildName: guildStat.guildName,
              previousMmr: guildStat.currentMmr,
              mmrChange: result.mmrChange,
              newMmr: guildStat.currentMmr + result.mmrChange,
              kills: guildStat.kills,
              deaths: guildStat.deaths,
              fameGained: BigInt(guildStat.fameGained),
              fameLost: BigInt(guildStat.fameLost),
              players: guildStat.players,
              avgIP: guildStat.avgIP,
              isPrimeTime: battleAnalysis.isPrimeTime,
              totalBattlePlayers: battleAnalysis.totalPlayers,
              totalBattleFame: BigInt(battleAnalysis.totalFame),
              battleDuration: battleAnalysis.battleDuration,
              killClustering: guildStat.killClustering,
              isWin: guildStat.kills > guildStat.deaths,
              hasSignificantParticipation: true, // All guilds in battleAnalysis have significant participation
              allianceName: guildAlliances.get(guildStat.guildName) || null,
              opponentGuilds: battleAnalysis.guildStats
                .filter(g => g.guildId !== guildStat.guildId)
                .map(g => g.guildName),
              opponentMmrs: battleAnalysis.guildStats
                .filter(g => g.guildId !== guildStat.guildId)
                .map(g => g.currentMmr),
              antiFarmingFactor: result.antiFarmingFactor || null,
              calculationVersion: "1.0",
            }
          });
          savedLogs++;
        } catch (error) {
          console.log(`   ⚠️ Error saving MMR log for ${guildStat.guildName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }
    
    console.log(`✅ Saved ${savedLogs} MMR calculation logs`);
    
    // Step 8: Update guild season records using MMR service (this will trigger prime time mass tracking)
    console.log(`\n🔄 Step 8: Updating guild season records using MMR service...`);
    
    let updatedGuilds = 0;
    for (const guildStat of battleAnalysis.guildStats) {
      const result = mmrResults.get(guildStat.guildId);
      if (result && guildStat.guildName !== "No Guild") {
        try {
          // Use the MMR service to update guild season (this will trigger prime time mass tracking)
          await mmrService.updateGuildSeasonMmr(
            guildStat.guildId,
            battleAnalysis.seasonId,
            result.mmrChange,
            guildStat,
            battleAnalysis,
            result.antiFarmingFactor
          );
          
          console.log(`   ✅ Updated guild season for ${guildStat.guildName} using MMR service`);
          updatedGuilds++;
        } catch (error) {
          console.log(`   ⚠️ Error updating guild season for ${guildStat.guildName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }
    
    console.log(`✅ Updated ${updatedGuilds} guild season records using MMR service`);
    
    // Step 8.5: Check if prime time mass was tracked
    console.log(`\n⏰ Step 8.5: Checking Prime Time Mass Tracking...`);
    if (battleAnalysis.isPrimeTime) {
      console.log(`   🎯 This battle is in prime time (${battleAnalysis.isPrimeTime})`);
      console.log(`   📊 Prime time mass should have been tracked for eligible guilds`);
      
      // Check if any prime time mass records were created
      const primeTimeMassCheck = await prisma.guildPrimeTimeMass.findMany({
        take: 5,
        include: {
          guildSeason: {
            include: {
              guild: true,
              season: true
            }
          },
          primeTimeWindow: true
        }
      });
      
      if (primeTimeMassCheck.length > 0) {
        console.log(`   ✅ Found ${primeTimeMassCheck.length} prime time mass records:`);
        primeTimeMassCheck.forEach((mass, idx) => {
          console.log(`      ${idx + 1}. ${mass.guildSeason.guild.name} in ${mass.guildSeason.season.name}`);
          console.log(`         Window: ${mass.primeTimeWindow.startHour}:00-${mass.primeTimeWindow.endHour}:00`);
          console.log(`         Avg Mass: ${mass.avgMass.toFixed(1)} players (${mass.battleCount} battles)`);
        });
      } else {
        console.log(`   ℹ️  No prime time mass records found yet. This might be normal if:`);
        console.log(`      - Battle doesn't fall within any prime time window`);
        console.log(`      - Guilds don't meet MMR eligibility criteria`);
        console.log(`      - Prime time mass tracking is still being processed`);
      }
    } else {
      console.log(`   ℹ️  This battle is not in prime time, so no prime time mass tracking`);
    }
    
    // Step 9: Display results
    console.log(`\n📈 Step 9: MMR Calculation Results:`);
    console.log("=" .repeat(50));
    
    for (const guildStat of battleAnalysis.guildStats) {
      const result = mmrResults.get(guildStat.guildId);
      if (result) {
        const newMmr = guildStat.currentMmr + result.mmrChange;
        const changeSymbol = result.mmrChange >= 0 ? '+' : '';
        
        console.log(`${guildStat.guildName}:`);
        console.log(`  Players: ${guildStat.players}`);
        console.log(`  Kills/Deaths: ${guildStat.kills}/${guildStat.deaths}`);
        console.log(`  Fame: ${(guildStat.fameGained + guildStat.fameLost).toLocaleString()}`);
        console.log(`  Current MMR: ${guildStat.currentMmr.toFixed(1)}`);
        console.log(`  MMR Change: ${changeSymbol}${result.mmrChange.toFixed(2)}`);
        console.log(`  New MMR: ${newMmr.toFixed(1)}`);
        
        if (result.antiFarmingFactor !== undefined) {
          console.log(`  Anti-farming factor: ${result.antiFarmingFactor.toFixed(3)}`);
        }
        console.log('');
      }
    }
    
    // Step 10: Summary
    console.log(`\n📊 Summary:`);
    console.log("=" .repeat(50));
    console.log(`Battle ID: ${battleId}`);
    console.log(`Season ID: ${battleAnalysis.seasonId}`);
    console.log(`Total Guilds Processed: ${battleAnalysis.guildStats.length}`);
    console.log(`MMR Changes Calculated: ${mmrResults.size}`);
    console.log(`Guild Season Records Updated: ${updatedGuilds}`);
    console.log(`MMR Calculation Logs Saved: ${savedLogs}`);
    console.log(`Is Prime Time Battle: ${battleAnalysis.isPrimeTime ? 'Yes' : 'No'}`);
    console.log(`Battle Duration: ${battleAnalysis.battleDuration} minutes`);
    console.log(`Total Fame: ${battleAnalysis.totalFame.toLocaleString()}`);
    console.log(`Total Players: ${battleAnalysis.totalPlayers}`);
    
    console.log(`\n✅ Complete end-to-end MMR calculation process finished successfully!`);
    console.log(`   This battle has been fully processed and saved to the database.`);
    console.log(`   All guilds have been created/updated and MMR calculations are saved.`);
    
    await prisma.$disconnect();
    
  } catch (error) {
    console.error("❌ Error during MMR calculation test:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
      console.error("Stack trace:", error.stack);
    }
  }
}

// CLI argument handling
const battleId = process.argv[2];

if (!battleId) {
  console.log("Usage: yarn mmr:test <battleId>");
  console.log("Example: yarn mmr:test 1268814359");
  console.log("");
  console.log("This command will:");
  console.log("1. Fetch real battle data from Albion API");
  console.log("2. Fetch kill data from Albion API");
  console.log("3. Create guilds in the database (if they don't exist)");
  console.log("4. Process the battle analysis");
  console.log("5. Calculate MMR changes for all guilds");
  console.log("6. Save MMR calculations to the database");
  console.log("7. Update guild season records");
  console.log("8. Display detailed results");
  process.exit(1);
}

const battleIdNumber = parseInt(battleId, 10);
if (isNaN(battleIdNumber)) {
  console.log("❌ Invalid battle ID. Please provide a valid number.");
  process.exit(1);
}

// Run the test
testMmrCalculation(battleIdNumber).catch(console.error);
