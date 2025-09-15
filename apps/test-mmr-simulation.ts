#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import { MmrService } from "../src/services/mmr.js";
import { BattleAnalysisService } from "../src/services/battleAnalysis.js";
import { SeasonService } from "../src/services/season.js";
import { getBattleDetail, getKillsForBattle } from "../src/http/client.js";
import type { GuildBattleStats, BattleAnalysis } from "../src/services/mmr.js";

interface SimulationConfig {
  battleId: number;
  verbose: boolean;
  showParticipationDetails: boolean;
  showFactorBreakdown: boolean;
  showAntiFarmingDetails: boolean;
  showAllianceDetails: boolean;
}

interface SimulationResult {
  battleId: number;
  battleAnalysis: BattleAnalysis | null;
  mmrResults: Map<string, { mmrChange: number; antiFarmingFactor?: number }>;
  participationAnalysis: Array<{
    guildName: string;
    hasSignificantParticipation: boolean;
    participationDetails: any;
  }>;
  factorBreakdown: Array<{
    guildName: string;
    factors: any;
    totalMmrChange: number;
  }>;
  summary: {
    totalGuilds: number;
    eligibleGuilds: number;
    excludedGuilds: number;
    totalMmrChanges: number;
    averageMmrChange: number;
    isPrimeTime: boolean;
    battleDuration: number;
  };
}

class MmrSimulationService {
  private prisma: PrismaClient;
  private mmrService: MmrService;
  private battleAnalysisService: BattleAnalysisService;
  private seasonService: SeasonService;

  constructor() {
    this.prisma = new PrismaClient();
    this.mmrService = new MmrService(this.prisma);
    this.battleAnalysisService = new BattleAnalysisService(this.prisma);
    this.seasonService = new SeasonService(this.prisma);
  }

  async simulateBattleMmr(config: SimulationConfig): Promise<SimulationResult> {
    console.log(`🏆 MMR BATTLE SIMULATION - Battle ${config.battleId}`);
    console.log("=" .repeat(80));
    console.log(`Configuration: ${JSON.stringify(config, null, 2)}\n`);

    try {
      // Step 1: Fetch battle data from API
      console.log(`📡 Step 1: Fetching battle data from API...`);
      const battleData = await this.fetchBattleData(config.battleId);
      
      if (!battleData) {
        throw new Error("Failed to fetch battle data");
      }

      console.log(`✅ Battle data fetched successfully!`);
      this.logBattleOverview(battleData);

      // Step 2: Fetch kill data
      console.log(`\n🗡️ Step 2: Fetching kill data...`);
      const killData = await this.fetchKillData(config.battleId);
      console.log(`✅ Kill data fetched: ${killData.length} kill events`);

      // Step 3: Get current season
      console.log(`\n📅 Step 3: Getting active season...`);
      const season = await this.getCurrentSeason();
      console.log(`✅ Using season: ${season.name} (${season.id})`);

      // Step 4: Create battle analysis
      console.log(`\n🔍 Step 4: Creating battle analysis...`);
      
      // Transform battle data to include guildsJson if it doesn't exist
      const processedBattleData = this.transformBattleDataForAnalysis(battleData);
      
      const battleAnalysis = await this.battleAnalysisService.createBattleAnalysis(
        BigInt(config.battleId),
        processedBattleData,
        killData
      );

      if (!battleAnalysis) {
        console.log(`❌ Battle analysis failed - battle doesn't meet MMR criteria`);
        return this.createEmptyResult(config.battleId);
      }

      console.log(`✅ Battle analysis created successfully!`);
      this.logBattleAnalysis(battleAnalysis, config);

      // Step 5: Analyze participation for all guilds
      console.log(`\n📊 Step 5: Analyzing guild participation...`);
      const participationAnalysis = this.analyzeParticipation(battleAnalysis, config);

      // Step 6: Calculate MMR changes
      console.log(`\n🎯 Step 6: Calculating MMR changes...`);
      const mmrResults = await this.mmrService.calculateMmrForBattle(battleAnalysis);
      console.log(`✅ MMR calculation completed for ${mmrResults.size} guilds`);

      // Step 7: Detailed factor breakdown
      console.log(`\n🔬 Step 7: Analyzing factor breakdown...`);
      const factorBreakdown = await this.analyzeFactorBreakdown(battleAnalysis, mmrResults, config);

      // Step 8: Generate summary
      console.log(`\n📈 Step 8: Generating summary...`);
      const summary = this.generateSummary(battleAnalysis, mmrResults, participationAnalysis);

      // Step 9: Display results
      this.displayResults(battleAnalysis, mmrResults, participationAnalysis, factorBreakdown, summary, config);

      return {
        battleId: config.battleId,
        battleAnalysis,
        mmrResults,
        participationAnalysis,
        factorBreakdown,
        summary
      };

    } catch (error) {
      console.error(`❌ Simulation failed:`, error);
      throw error;
    }
  }

  private async fetchBattleData(battleId: number): Promise<any> {
    try {
      const response = await getBattleDetail(BigInt(battleId));
      if (!response || !response.albionId) {
        throw new Error("Invalid battle data received");
      }
      return response;
    } catch (error) {
      console.error(`Error fetching battle data:`, error);
      throw error;
    }
  }

  private async fetchKillData(battleId: number): Promise<any[]> {
    try {
      const response = await getKillsForBattle(BigInt(battleId));
      return response || [];
    } catch (error) {
      console.error(`Error fetching kill data:`, error);
      return [];
    }
  }

  private async getCurrentSeason(): Promise<any> {
    const season = await this.seasonService.getActiveSeason();
    if (!season) {
      throw new Error("No active season found");
    }
    return season;
  }

  private transformBattleDataForAnalysis(battleData: any): any {
    // If guildsJson already exists, return as is
    if (battleData.guildsJson && Array.isArray(battleData.guildsJson)) {
      return battleData;
    }

    // Transform guilds array to guildsJson format
    if (battleData.guilds && Array.isArray(battleData.guilds)) {
      console.log(`   🔄 Transforming guilds array to guildsJson format (${battleData.guilds.length} guilds)`);
      
      const guildsJson = battleData.guilds.map((guild: any) => ({
        name: guild.name || '',
        kills: guild.kills || 0,
        deaths: guild.deaths || 0,
        killFame: guild.killFame || 0,
        players: guild.players || 0,
        ip: guild.ip || 1000,
        albionId: guild.albionId || '',
        alliance: guild.alliance || ''
      }));

      return {
        ...battleData,
        guildsJson
      };
    }

    // If no guilds data available, try to extract from players array
    if (battleData.players && Array.isArray(battleData.players)) {
      console.log(`   🔄 Extracting guild data from players array (${battleData.players.length} players)`);
      
      const guildMap = new Map<string, any>();
      
      for (const player of battleData.players) {
        const guildName = player.guildName || 'No Guild';
        
        if (!guildMap.has(guildName)) {
          guildMap.set(guildName, {
            name: guildName,
            kills: 0,
            deaths: 0,
            killFame: 0,
            players: 0,
            ip: 0,
            albionId: '',
            alliance: player.allianceName || ''
          });
        }
        
        const guild = guildMap.get(guildName);
        guild.kills += player.kills || 0;
        guild.deaths += player.deaths || 0;
        guild.killFame += player.killFame || 0;
        guild.players += 1;
        guild.ip += player.ip || 1000;
      }

      // Calculate average IP for each guild
      for (const guild of guildMap.values()) {
        if (guild.players > 0) {
          guild.ip = guild.ip / guild.players;
        }
      }

      const guildsJson = Array.from(guildMap.values());
      console.log(`   ✅ Extracted ${guildsJson.length} guilds from players data`);

      return {
        ...battleData,
        guildsJson
      };
    }

    console.log(`   ⚠️ No guild data available in battle response`);
    return battleData;
  }

  private logBattleOverview(battleData: any): void {
    console.log(`   Battle ID: ${battleData.albionId}`);
    console.log(`   Total Players: ${battleData.totalPlayers}`);
    console.log(`   Total Fame: ${battleData.totalFame?.toLocaleString() || 'N/A'}`);
    console.log(`   Total Kills: ${battleData.totalKills || 'N/A'}`);
    console.log(`   Start Time: ${battleData.startedAt}`);
    console.log(`   End Time: ${battleData.finishedAt || 'Ongoing'}`);
    
    // Check MMR criteria
    const meetsCriteria = battleData.totalPlayers >= 25 && battleData.totalFame >= 2000000;
    console.log(`   Meets MMR Criteria: ${meetsCriteria ? '✅ YES' : '❌ NO'}`);
    if (!meetsCriteria) {
      console.log(`     - Players: ${battleData.totalPlayers}/25 required`);
      console.log(`     - Fame: ${battleData.totalFame?.toLocaleString() || 'N/A'}/2,000,000 required`);
    }
  }

  private logBattleAnalysis(battleAnalysis: BattleAnalysis, config: SimulationConfig): void {
    console.log(`   Season ID: ${battleAnalysis.seasonId}`);
    console.log(`   Total Guilds: ${battleAnalysis.guildStats.length}`);
    console.log(`   Total Players: ${battleAnalysis.totalPlayers}`);
    console.log(`   Total Fame: ${battleAnalysis.totalFame.toLocaleString()}`);
    console.log(`   Battle Duration: ${battleAnalysis.battleDuration} minutes`);
    console.log(`   Is Prime Time: ${battleAnalysis.isPrimeTime ? 'Yes' : 'No'}`);
    console.log(`   Friend Groups: ${battleAnalysis.friendGroups.length}`);
    
    // Show alliance information if available
    if (battleAnalysis.guildAlliances && battleAnalysis.guildAlliances.size > 0) {
      console.log(`   Alliances: ${battleAnalysis.guildAlliances.size} detected`);
      if (config.verbose) {
        const allianceMap = new Map<string, string[]>();
        for (const [guildName, allianceName] of battleAnalysis.guildAlliances.entries()) {
          if (!allianceMap.has(allianceName)) {
            allianceMap.set(allianceName, []);
          }
          allianceMap.get(allianceName)!.push(guildName);
        }
        
        console.log(`\n   Alliance Breakdown:`);
        for (const [allianceName, guilds] of allianceMap.entries()) {
          console.log(`     ${allianceName}: ${guilds.join(', ')}`);
        }
        
        // Show guilds without alliances
        const guildsWithoutAlliance = battleAnalysis.guildStats
          .filter(g => !battleAnalysis.guildAlliances?.has(g.guildName))
          .map(g => g.guildName);
        if (guildsWithoutAlliance.length > 0) {
          console.log(`     No Alliance: ${guildsWithoutAlliance.join(', ')}`);
        }
      }
    } else {
      console.log(`   Alliances: None detected`);
    }
    
    if (config.verbose) {
      console.log(`\n   Guild Overview:`);
      battleAnalysis.guildStats.forEach((guild, index) => {
        const allianceName = battleAnalysis.guildAlliances?.get(guild.guildName) || 'No Alliance';
        console.log(`     ${index + 1}. ${guild.guildName} (${allianceName})`);
        console.log(`        Players: ${guild.players}, Kills: ${guild.kills}, Deaths: ${guild.deaths}`);
        console.log(`        Fame: ${(guild.fameGained + guild.fameLost).toLocaleString()}, MMR: ${guild.currentMmr.toFixed(1)}`);
      });
    }
  }

  private analyzeParticipation(battleAnalysis: BattleAnalysis, config: SimulationConfig): Array<any> {
    const participationAnalysis: Array<any> = [];

    console.log(`   Analyzing participation for ${battleAnalysis.guildStats.length} guilds...`);

    for (const guildStat of battleAnalysis.guildStats) {
      const hasSignificantParticipation = MmrService.hasSignificantParticipation(guildStat, battleAnalysis);
      
      const participationDetails = this.calculateParticipationDetails(guildStat, battleAnalysis);
      
      participationAnalysis.push({
        guildName: guildStat.guildName,
        hasSignificantParticipation,
        participationDetails
      });

      if (config.showParticipationDetails) {
        this.logParticipationDetails(guildStat, hasSignificantParticipation, participationDetails);
      }
    }

    const eligibleCount = participationAnalysis.filter(p => p.hasSignificantParticipation).length;
    const excludedCount = participationAnalysis.length - eligibleCount;
    
    console.log(`   ✅ Participation Analysis Complete:`);
    console.log(`      Eligible for MMR: ${eligibleCount}/${participationAnalysis.length}`);
    console.log(`      Excluded: ${excludedCount}/${participationAnalysis.length}`);

    return participationAnalysis;
  }

  private calculateParticipationDetails(guildStat: GuildBattleStats, battleAnalysis: BattleAnalysis): any {
    const totalBattleFame = battleAnalysis.totalFame;
    const totalBattlePlayers = battleAnalysis.totalPlayers;
    const totalBattleKills = battleAnalysis.guildStats.reduce((sum, g) => sum + g.kills, 0);
    const totalBattleDeaths = battleAnalysis.guildStats.reduce((sum, g) => sum + g.deaths, 0);
    const totalBattleKillsDeaths = totalBattleKills + totalBattleDeaths;

    const guildFameParticipation = guildStat.fameGained + guildStat.fameLost;
    const guildKillsDeaths = guildStat.kills + guildStat.deaths;

    const fameRatio = totalBattleFame > 0 ? guildFameParticipation / totalBattleFame : 0;
    const killsDeathsRatio = totalBattleKillsDeaths > 0 ? guildKillsDeaths / totalBattleKillsDeaths : 0;
    const playerRatio = totalBattlePlayers > 0 ? guildStat.players / totalBattlePlayers : 0;

    return {
      fame: {
        guild: guildFameParticipation,
        total: totalBattleFame,
        ratio: fameRatio,
        percentage: (fameRatio * 100).toFixed(2) + '%',
        meetsThreshold: fameRatio >= 0.15 || guildFameParticipation >= 1000000
      },
      killsDeaths: {
        guild: guildKillsDeaths,
        total: totalBattleKillsDeaths,
        ratio: killsDeathsRatio,
        percentage: (killsDeathsRatio * 100).toFixed(2) + '%',
        meetsThreshold: killsDeathsRatio >= 0.15 || guildKillsDeaths >= 12
      },
      players: {
        guild: guildStat.players,
        total: totalBattlePlayers,
        ratio: playerRatio,
        percentage: (playerRatio * 100).toFixed(2) + '%',
        meetsThreshold: playerRatio >= 0.15 || guildStat.players >= 2
      },
      overall: {
        hasAnyKillsOrDeaths: guildStat.kills > 0 || guildStat.deaths > 0,
        isSinglePlayer: guildStat.players <= 1,
        isSmallGuild: guildStat.players <= 3
      }
    };
  }

  private logParticipationDetails(guildStat: GuildBattleStats, hasSignificantParticipation: boolean, details: any): void {
    console.log(`\n   📊 ${guildStat.guildName}:`);
    console.log(`      Status: ${hasSignificantParticipation ? '✅ ELIGIBLE' : '❌ EXCLUDED'}`);
    console.log(`      Fame: ${details.fame.guild.toLocaleString()} (${details.fame.percentage}) - ${details.fame.meetsThreshold ? '✅' : '❌'}`);
    console.log(`      K/D: ${details.killsDeaths.guild} (${details.killsDeaths.percentage}) - ${details.killsDeaths.meetsThreshold ? '✅' : '❌'}`);
    console.log(`      Players: ${details.players.guild} (${details.players.percentage}) - ${details.players.meetsThreshold ? '✅' : '❌'}`);
    console.log(`      Special: ${details.overall.isSinglePlayer ? 'Single Player' : details.overall.isSmallGuild ? 'Small Guild' : 'Normal'}`);
  }

  private async analyzeFactorBreakdown(battleAnalysis: BattleAnalysis, mmrResults: Map<string, any>, config: SimulationConfig): Promise<Array<any>> {
    const factorBreakdown: Array<any> = [];

    for (const guildStat of battleAnalysis.guildStats) {
      const result = mmrResults.get(guildStat.guildId);
      if (!result) continue;

      // Use the actual MMR service to calculate individual factors
      const factors = await this.calculateIndividualFactorsUsingMmrService(guildStat, battleAnalysis);
      
      factorBreakdown.push({
        guildName: guildStat.guildName,
        factors,
        totalMmrChange: result.mmrChange,
        antiFarmingFactor: result.antiFarmingFactor
      });

      if (config.showFactorBreakdown) {
        this.logFactorBreakdown(guildStat, factors, result);
      }
    }

    return factorBreakdown;
  }

  private async calculateIndividualFactorsUsingMmrService(guildStat: GuildBattleStats, battleAnalysis: BattleAnalysis): Promise<any> {
    // Use the actual MMR service to calculate factors with exact same logic as production
    return await this.mmrService.getGuildFactorBreakdown(guildStat, battleAnalysis);
  }


  private logFactorBreakdown(guildStat: GuildBattleStats, factors: any, result: any): void {
    console.log(`\n   🎯 ${guildStat.guildName} Factor Breakdown:`);
    console.log(`      Total MMR Change: ${result.mmrChange.toFixed(2)}`);
    if (result.antiFarmingFactor !== undefined) {
      console.log(`      Anti-farming Factor: ${result.antiFarmingFactor.toFixed(3)}`);
    }
    if (factors.isIpFarming) {
      console.log(`      🚨 IP FARMING DETECTED! Penalty Applied`);
    }
    console.log(`      Player Count Scaling: ${factors.playerCountScalingFactor.toFixed(3)}`);
    console.log(`      Pre-scaling MMR Change: ${factors.finalMmrChange.toFixed(2)}`);
    
    console.log(`      Individual Factors:`);
    Object.entries(factors.factors).forEach(([name, value]) => {
      const weight = factors.weights[name];
      const contribution = factors.contributions[name];
      console.log(`        ${name}: ${(value as number).toFixed(3)} (weight: ${(weight * 100).toFixed(0)}%, contribution: ${contribution.toFixed(3)})`);
    });
    
    console.log(`      Total Weighted Score: ${factors.totalWeightedScore.toFixed(3)}`);
  }

  private generateSummary(battleAnalysis: BattleAnalysis, mmrResults: Map<string, any>, participationAnalysis: Array<any>): any {
    const eligibleGuilds = participationAnalysis.filter(p => p.hasSignificantParticipation).length;
    const excludedGuilds = participationAnalysis.length - eligibleGuilds;
    
    const mmrChanges = Array.from(mmrResults.values()).map(r => r.mmrChange);
    const totalMmrChanges = mmrChanges.reduce((sum, change) => sum + Math.abs(change), 0);
    const averageMmrChange = mmrChanges.length > 0 ? totalMmrChanges / mmrChanges.length : 0;

    return {
      totalGuilds: battleAnalysis.guildStats.length,
      eligibleGuilds,
      excludedGuilds,
      totalMmrChanges: mmrResults.size,
      averageMmrChange,
      isPrimeTime: battleAnalysis.isPrimeTime,
      battleDuration: battleAnalysis.battleDuration
    };
  }

  private displayResults(battleAnalysis: BattleAnalysis, mmrResults: Map<string, any>, participationAnalysis: Array<any>, _factorBreakdown: Array<any>, summary: any, _config: SimulationConfig): void {
    console.log(`\n📊 SIMULATION RESULTS`);
    console.log("=" .repeat(80));

    // Summary
    console.log(`\n📈 Summary:`);
    console.log(`   Total Guilds: ${summary.totalGuilds}`);
    console.log(`   Eligible for MMR: ${summary.eligibleGuilds}`);
    console.log(`   Excluded: ${summary.excludedGuilds}`);
    console.log(`   MMR Changes Calculated: ${summary.totalMmrChanges}`);
    console.log(`   Average MMR Change: ${summary.averageMmrChange.toFixed(2)}`);
    console.log(`   Prime Time Battle: ${summary.isPrimeTime ? 'Yes' : 'No'}`);
    console.log(`   Battle Duration: ${summary.battleDuration} minutes`);

    // MMR Results
    console.log(`\n🎯 MMR Changes:`);
    for (const guildStat of battleAnalysis.guildStats) {
      const result = mmrResults.get(guildStat.guildId);
      if (result) {
        const newMmr = guildStat.currentMmr + result.mmrChange;
        const changeSymbol = result.mmrChange >= 0 ? '+' : '';
        
        console.log(`   ${guildStat.guildName}:`);
        console.log(`     Current MMR: ${guildStat.currentMmr.toFixed(1)}`);
        console.log(`     Change: ${changeSymbol}${result.mmrChange.toFixed(2)}`);
        console.log(`     New MMR: ${newMmr.toFixed(1)}`);
        if (result.antiFarmingFactor !== undefined) {
          console.log(`     Anti-farming: ${result.antiFarmingFactor.toFixed(3)}`);
        }
      }
    }

    // Excluded guilds
    const excludedGuilds = participationAnalysis.filter(p => !p.hasSignificantParticipation);
    if (excludedGuilds.length > 0) {
      console.log(`\n❌ Excluded Guilds:`);
      excludedGuilds.forEach(guild => {
        console.log(`   ${guild.guildName}: Insufficient participation`);
      });
    }

    console.log(`\n✅ Simulation completed successfully!`);
    console.log(`   No data was saved to the database.`);
  }

  private createEmptyResult(battleId: number): SimulationResult {
    return {
      battleId,
      battleAnalysis: null,
      mmrResults: new Map(),
      participationAnalysis: [],
      factorBreakdown: [],
      summary: {
        totalGuilds: 0,
        eligibleGuilds: 0,
        excludedGuilds: 0,
        totalMmrChanges: 0,
        averageMmrChange: 0,
        isPrimeTime: false,
        battleDuration: 0
      }
    };
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

// CLI argument handling
function parseArguments(): SimulationConfig {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log("Usage: yarn mmr:simulate <battleId> [options]");
    console.log("");
    console.log("Options:");
    console.log("  --verbose, -v              Show detailed guild information");
    console.log("  --participation, -p        Show detailed participation analysis");
    console.log("  --factors, -f              Show detailed factor breakdown");
    console.log("  --anti-farming, -a         Show anti-farming details");
    console.log("  --alliances, -l            Show alliance details");
    console.log("  --all                     Enable all detailed options");
    console.log("");
    console.log("Examples:");
    console.log("  yarn mmr:simulate 1268814359");
    console.log("  yarn mmr:simulate 1268814359 --verbose --factors");
    console.log("  yarn mmr:simulate 1268814359 --all");
    process.exit(1);
  }

  const battleId = parseInt(args[0], 10);
  if (isNaN(battleId)) {
    console.log("❌ Invalid battle ID. Please provide a valid number.");
    process.exit(1);
  }

  const options = args.slice(1);
  const verbose = options.includes('--verbose') || options.includes('-v') || options.includes('--all');
  const showParticipationDetails = options.includes('--participation') || options.includes('-p') || options.includes('--all');
  const showFactorBreakdown = options.includes('--factors') || options.includes('-f') || options.includes('--all');
  const showAntiFarmingDetails = options.includes('--anti-farming') || options.includes('-a') || options.includes('--all');
  const showAllianceDetails = options.includes('--alliances') || options.includes('-l') || options.includes('--all');

  return {
    battleId,
    verbose,
    showParticipationDetails,
    showFactorBreakdown,
    showAntiFarmingDetails,
    showAllianceDetails
  };
}

// Main execution
async function main() {
  const config = parseArguments();
  const simulationService = new MmrSimulationService();

  try {
    await simulationService.simulateBattleMmr(config);
    
    // You can add additional analysis here if needed
    console.log(`\n🔍 Additional Analysis Available:`);
    console.log(`   - Participation details for each guild`);
    console.log(`   - Factor breakdown for MMR calculations`);
    console.log(`   - Anti-farming analysis`);
    console.log(`   - Alliance relationships`);
    console.log(`   Use --all flag to see all details`);
    
  } catch (error) {
    console.error("❌ Simulation failed:", error);
    process.exit(1);
  } finally {
    await simulationService.disconnect();
  }
}

// Run the simulation
main().catch(console.error);
