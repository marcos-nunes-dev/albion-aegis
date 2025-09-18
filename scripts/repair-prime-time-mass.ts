#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Repair prime time mass data by recalculating from MMR calculation logs
 */
async function repairPrimeTimeMassData() {
  console.log('🔧 Starting prime time mass data repair...');
  
  try {
    // Get all prime time windows
    const primeTimeWindows = await prisma.primeTimeWindow.findMany({
      orderBy: { startHour: 'asc' }
    });
    
    console.log(`Found ${primeTimeWindows.length} prime time windows`);
    
    // Get all guild seasons with existing prime time mass data
    const guildSeasons = await prisma.guildSeason.findMany({
      where: {
        primeTimeMasses: {
          some: {}
        }
      },
      include: {
        guild: true,
        season: true,
        primeTimeMasses: {
          include: {
            primeTimeWindow: true
          }
        }
      }
    });
    
    console.log(`Found ${guildSeasons.length} guild seasons with prime time mass data`);
    
    let repairedCount = 0;
    let inconsistencyCount = 0;
    
    for (const guildSeason of guildSeasons) {
      console.log(`\n📊 Processing ${guildSeason.guild.name} in ${guildSeason.season.name}...`);
      
      for (const window of primeTimeWindows) {
        // Get MMR calculation logs for this guild and prime time window
        const mmrLogs = await prisma.mmrCalculationLog.findMany({
          where: {
            guildId: guildSeason.guildId,
            seasonId: guildSeason.seasonId,
            processedAt: {
              gte: guildSeason.season.startDate,
              lte: guildSeason.season.endDate || new Date()
            }
          }
        });
        
        // Get battle data for these logs to determine time windows
        const battleIds = [...new Set(mmrLogs.map(log => log.battleId))];
        const battles = await prisma.battle.findMany({
          where: {
            albionId: {
              in: battleIds
            }
          }
        });
        
        // Create a map of battleId to battle data
        const battleMap = new Map();
        battles.forEach(battle => {
          battleMap.set(battle.albionId.toString(), battle);
        });
        
        // Filter logs by prime time window
        const windowLogs = mmrLogs.filter(log => {
          const battle = battleMap.get(log.battleId.toString());
          if (!battle) return false;
          
          const battleHour = battle.startedAt.getUTCHours();
          
          if (window.endHour < window.startHour) {
            // Overnight window (e.g., 22:00 to 02:00)
            return battleHour >= window.startHour || battleHour < window.endHour;
          } else {
            // Same day window (e.g., 20:00 to 22:00)
            return battleHour >= window.startHour && battleHour < window.endHour;
          }
        });
        
        if (windowLogs.length === 0) continue;
        
        // Calculate the correct average mass and battle count
        const playerCounts = windowLogs.map(log => log.players);
          
        const correctAvgMass = playerCounts.reduce((sum, count) => sum + count, 0) / playerCounts.length;
        const correctBattleCount = windowLogs.length;
        const lastBattleAt = windowLogs
          .sort((a, b) => b.processedAt.getTime() - a.processedAt.getTime())[0]
          .processedAt;
        
        // Check existing prime time mass record
        const existingMass = guildSeason.primeTimeMasses.find(
          mass => mass.primeTimeWindowId === window.id
        );
        
        if (existingMass) {
          // Check for inconsistency
          const hasInconsistency = 
            Math.abs(existingMass.avgMass - correctAvgMass) > 0.1 ||
            existingMass.battleCount !== correctBattleCount;
            
          if (hasInconsistency) {
            console.log(`  ❌ Inconsistency found in ${window.startHour}:00-${window.endHour}:00:`);
            console.log(`     Current: avgMass=${existingMass.avgMass}, battles=${existingMass.battleCount}`);
            console.log(`     Correct: avgMass=${correctAvgMass.toFixed(1)}, battles=${correctBattleCount}`);
            
            // Update the record
            await prisma.guildPrimeTimeMass.update({
              where: { id: existingMass.id },
              data: {
                avgMass: correctAvgMass,
                battleCount: correctBattleCount,
                lastBattleAt: lastBattleAt
              }
            });
            
            console.log(`     ✅ Fixed!`);
            repairedCount++;
            inconsistencyCount++;
          }
        } else {
          // Create missing record
          console.log(`  ➕ Creating missing record for ${window.startHour}:00-${window.endHour}:00`);
          console.log(`     avgMass=${correctAvgMass.toFixed(1)}, battles=${correctBattleCount}`);
          
          await prisma.guildPrimeTimeMass.create({
            data: {
              guildSeasonId: guildSeason.id,
              primeTimeWindowId: window.id,
              avgMass: correctAvgMass,
              battleCount: correctBattleCount,
              lastBattleAt: lastBattleAt
            }
          });
          
          repairedCount++;
        }
      }
    }
    
    console.log(`\n🎉 Repair completed!`);
    console.log(`   Inconsistencies found: ${inconsistencyCount}`);
    console.log(`   Records repaired/created: ${repairedCount}`);
    
  } catch (error) {
    console.error('❌ Error during repair:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the repair
repairPrimeTimeMassData()
  .then(() => {
    console.log('✅ Prime time mass data repair completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Prime time mass data repair failed:', error);
    process.exit(1);
  });

export { repairPrimeTimeMassData };
