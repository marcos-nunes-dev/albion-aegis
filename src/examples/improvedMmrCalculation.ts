import { MmrService } from '../services/mmr.js';
import type { GuildBattleStats, BattleAnalysis } from '../services/mmr.js';

/**
 * Example demonstrating the improved MMR calculation
 * Using the battle data from the user's example (battle 1268814359)
 */
export async function demonstrateImprovedMmrCalculation() {
  console.log('🏆 Demonstrating Improved MMR Calculation');
  console.log('==========================================\n');

  // Battle data from the user's example
  const battleData = {
    battleId: 1268814359n,
    totalPlayers: 34,
    totalFame: 2152389,
    battleDuration: 5,
    isPrimeTime: false,
  };

  // Guild statistics from the logs
  const guildStats: GuildBattleStats[] = [
    {
      guildName: "The Plaga",
      guildId: "-Thgo8UoQy2Jai2d118uaQ",
      kills: 0,
      deaths: 0,
      fameGained: 55700,
      fameLost: 0,
      players: 2,
      avgIP: 1000,
      isPrimeTime: false,
      currentMmr: 1000,
      killClustering: 0,
    },
    {
      guildName: "IMP4CT",
      guildId: "ImJCoSE3TrCIFGCLuokEzg",
      kills: 0,
      deaths: 1,
      fameGained: 27850,
      fameLost: 140265,
      players: 1,
      avgIP: 1420,
      isPrimeTime: false,
      currentMmr: 1000,
      killClustering: 0,
    },
    {
      guildName: "Black Dragon Aeon",
      guildId: "WFuxq2k8QwKQFkRHuBhmCg",
      kills: 3,
      deaths: 5,
      fameGained: 278500,
      fameLost: 846342,
      players: 10,
      avgIP: 1402,
      isPrimeTime: false,
      currentMmr: 1000,
      killClustering: 8,
    },
    {
      guildName: "Anyway We Try",
      guildId: "0TxNgCqMQ0m-7HZFU1y2wg",
      kills: 3,
      deaths: 5,
      fameGained: 443848,
      fameLost: 775858,
      players: 6,
      avgIP: 1452,
      isPrimeTime: false,
      currentMmr: 1000,
      killClustering: 9,
    },
    {
      guildName: "Conflict",
      guildId: "f9etJ9tgTVW2LMsA3efITg",
      kills: 0,
      deaths: 0,
      fameGained: 125434,
      fameLost: 0,
      players: 1,
      avgIP: 1325,
      isPrimeTime: false,
      currentMmr: 1019.275547204,
      killClustering: 0,
    },
    {
      guildName: "Throwing Chair",
      guildId: "7ZgQYKz8RsCDraaLCduAuA",
      kills: 8,
      deaths: 3,
      fameGained: 1115087,
      fameLost: 389924,
      players: 12,
      avgIP: 1376,
      isPrimeTime: false,
      currentMmr: 963.642430850252,
      killClustering: 17,
    },
    {
      guildName: "The Lonely Men",
      guildId: "y7iOzKEDTLuTL9k5J17IDA",
      kills: 0,
      deaths: 0,
      fameGained: 78056,
      fameLost: 0,
      players: 1,
      avgIP: 1000,
      isPrimeTime: false,
      currentMmr: 1027.92787815631,
      killClustering: 0,
    },
  ];

  // Create battle analysis
  const battleAnalysis: BattleAnalysis = {
    battleId: battleData.battleId,
    seasonId: "cmetbyo560000i1481qkscxxf",
    guildStats,
    totalPlayers: battleData.totalPlayers,
    totalFame: battleData.totalFame,
    battleDuration: battleData.battleDuration,
    isPrimeTime: battleData.isPrimeTime,
    killClustering: 0,
    friendGroups: [],
  };

  console.log('📊 Battle Overview:');
  console.log(`Battle ID: ${battleData.battleId}`);
  console.log(`Total Players: ${battleData.totalPlayers}`);
  console.log(`Total Fame: ${battleData.totalFame.toLocaleString()}`);
  console.log(`Duration: ${battleData.battleDuration} minutes`);
  console.log(`Prime Time: ${battleData.isPrimeTime ? 'Yes' : 'No'}\n`);

  console.log('🔍 Participation Analysis:');
  console.log('==========================');

  // Analyze participation for each guild
  for (const guildStat of guildStats) {
    const hasSignificantParticipation = MmrService.hasSignificantParticipation(
      guildStat,
      battleAnalysis
    );

    const fameParticipation = guildStat.fameGained + guildStat.fameLost;
    const killsDeaths = guildStat.kills + guildStat.deaths;
    const fameRatio = (fameParticipation / battleData.totalFame * 100).toFixed(2);
    const playerRatio = (guildStat.players / battleData.totalPlayers * 100).toFixed(2);

    console.log(`\n${guildStat.guildName}:`);
    console.log(`  Players: ${guildStat.players} (${playerRatio}% of total)`);
    console.log(`  Kills/Deaths: ${guildStat.kills}/${guildStat.deaths} (${killsDeaths} total)`);
    console.log(`  Fame: ${fameParticipation.toLocaleString()} (${fameRatio}% of total)`);
    console.log(`  Significant Participation: ${hasSignificantParticipation ? '✅ YES' : '❌ NO'}`);
    
    if (!hasSignificantParticipation) {
      console.log(`  ❌ REASON: Insufficient participation - will be excluded from MMR calculation`);
    }
  }

  console.log('\n🎯 Improved MMR Calculation Results:');
  console.log('====================================');

  // Filter to only guilds with significant participation
  const significantGuilds = guildStats.filter(guildStat => 
    MmrService.hasSignificantParticipation(guildStat, battleAnalysis)
  );

  console.log(`\nGuilds with significant participation: ${significantGuilds.length}/${guildStats.length}`);

  // Calculate player count scaling factors
  for (const guildStat of significantGuilds) {
    // Simulate the scaling factor calculation
    const playerCount = guildStat.players;
    let scalingFactor = 1.0;
    
    if (playerCount >= 8) {
      scalingFactor = 1.0; // Full MMR for 8+ players
    } else if (playerCount <= 1) {
      scalingFactor = 0.1; // 10% MMR for single players
    } else {
      scalingFactor = Math.pow(playerCount / 8, 0.8);
      scalingFactor = Math.max(0.1, Math.min(1.0, scalingFactor));
    }

    console.log(`\n${guildStat.guildName}:`);
    console.log(`  Players: ${playerCount}`);
    console.log(`  Player Count Scaling Factor: ${scalingFactor.toFixed(3)}`);
    console.log(`  Estimated MMR Change: ${(guildStat.currentMmr * 0.1 * scalingFactor).toFixed(1)} points`);
    console.log(`  (This is proportional to their participation level)`);
  }

  console.log('\n📈 Key Improvements:');
  console.log('===================');
  console.log('1. ✅ Much stricter participation filtering:');
  console.log('   - Minimum 10% fame participation (was 0.5%)');
  console.log('   - Minimum 10% kills/deaths participation (was 1%)');
  console.log('   - Minimum 10% player participation (was 1%)');
  console.log('   - Higher absolute thresholds (500K fame, 5 kills/deaths, 3 players)');
  console.log('   - Single players need 8+ kills/deaths and 1M+ fame');
  
  console.log('\n2. ✅ Proportional MMR calculation:');
  console.log('   - Single players get only 10% of normal MMR changes');
  console.log('   - Small guilds (2-7 players) get scaled MMR changes');
  console.log('   - Full MMR changes for guilds with 8+ players');
  
  console.log('\n3. ✅ Fairer system:');
  console.log('   - "Conflict" (1 player) is excluded due to insufficient participation');
  console.log('   - "Throwing Chair" (12 players) would get full MMR change');
  console.log('   - Only guilds with 10%+ participation get MMR changes');

  console.log('\n🎯 Expected Results for Battle 1268814359:');
  console.log('==========================================');
  console.log('❌ EXCLUDED (insufficient participation):');
  console.log('   - The Plaga (0 kills, 0 deaths, low fame)');
  console.log('   - IMP4CT (0 kills, 1 death, low fame)');
  console.log('   - The Lonely Men (0 kills, 0 deaths, low fame)');
  console.log('   - Conflict (0 kills, 0 deaths, low fame)');
  
  console.log('\n✅ INCLUDED (significant participation):');
  console.log('   - Black Dragon Aeon (3 kills, 5 deaths, high fame)');
  console.log('   - Anyway We Try (3 kills, 5 deaths, high fame)');
  console.log('   - Throwing Chair (8 kills, 3 deaths, highest fame)');
  
  console.log('\n📊 Proportional MMR Changes:');
  console.log('   - Anyway We Try (6 players): ~75% of normal MMR change');
  console.log('   - Black Dragon Aeon (10 players): ~100% of normal MMR change');
  console.log('   - Throwing Chair (12 players): 100% of normal MMR change');
}

// Run the example
demonstrateImprovedMmrCalculation().catch(console.error);
