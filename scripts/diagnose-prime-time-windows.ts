#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Diagnose prime time window issues
 */
async function diagnosePrimeTimeWindows() {
  console.log('🔍 Diagnosing prime time window configuration...');
  
  try {
    // Get all prime time windows
    const primeTimeWindows = await prisma.primeTimeWindow.findMany({
      orderBy: { startHour: 'asc' }
    });
    
    console.log(`\n📋 Found ${primeTimeWindows.length} prime time windows:`);
    primeTimeWindows.forEach(window => {
      console.log(`   ${window.startHour}:00-${window.endHour}:00 UTC (ID: ${window.id})`);
    });
    
    // Test the matching logic for the specific battle times from the bug report
    const testTimes = [
      { time: "Sep 15, 2025, 01:17 AM GMT-3", utcHour: 4 },
      { time: "Sep 15, 2025, 01:06 AM GMT-3", utcHour: 4 },
      { time: "Sep 15, 2025, 01:03 AM GMT-3", utcHour: 4 },
      { time: "Sep 14, 2025, 01:53 AM GMT-3", utcHour: 4 }
    ];
    
    console.log(`\n🧪 Testing battle time matching:`);
    
    testTimes.forEach(test => {
      console.log(`\n   Battle: ${test.time} → UTC Hour: ${test.utcHour}`);
      
      const matchingWindow = primeTimeWindows.find((window) => {
        if (window.startHour <= window.endHour) {
          // Same day window (e.g., 20:00 to 22:00)
          return test.utcHour >= window.startHour && test.utcHour < window.endHour;
        } else {
          // Overnight window (e.g., 22:00 to 02:00)
          return test.utcHour >= window.startHour || test.utcHour < window.endHour;
        }
      });
      
      if (matchingWindow) {
        console.log(`   ✅ Matches window: ${matchingWindow.startHour}:00-${matchingWindow.endHour}:00 UTC`);
      } else {
        console.log(`   ❌ No matching window found!`);
      }
    });
    
    // Check for the specific guild mentioned in the bug report
    console.log(`\n🔍 Checking S L I C E D guild data...`);
    
    const slicedGuild = await prisma.guild.findFirst({
      where: {
        name: {
          contains: "S L I C E D",
          mode: 'insensitive'
        }
      }
    });
    
    if (slicedGuild) {
      console.log(`   Found guild: ${slicedGuild.name} (ID: ${slicedGuild.id})`);
      
      // Get current season
      const activeSeason = await prisma.season.findFirst({
        where: { isActive: true }
      });
      
      if (activeSeason) {
        console.log(`   Active season: ${activeSeason.name} (ID: ${activeSeason.id})`);
        
        // Get guild season
        const guildSeason = await prisma.guildSeason.findFirst({
          where: {
            guildId: slicedGuild.id,
            seasonId: activeSeason.id
          },
          include: {
            primeTimeMasses: {
              include: {
                primeTimeWindow: true
              }
            }
          }
        });
        
        if (guildSeason) {
          console.log(`   Guild season found (ID: ${guildSeason.id})`);
          console.log(`   Prime time mass records: ${guildSeason.primeTimeMasses.length}`);
          
          guildSeason.primeTimeMasses.forEach(mass => {
            console.log(`     ${mass.primeTimeWindow.startHour}:00-${mass.primeTimeWindow.endHour}:00 → avgMass: ${mass.avgMass}, battles: ${mass.battleCount}`);
          });
          
          // Check MMR calculation logs for this guild
          const mmrLogs = await prisma.mmrCalculationLog.findMany({
            where: {
              guildId: slicedGuild.id,
              seasonId: activeSeason.id,
              processedAt: {
                gte: new Date('2025-09-14T00:00:00Z'),
                lte: new Date('2025-09-16T00:00:00Z')
              }
            },
            include: {
              battle: true
            },
            orderBy: {
              processedAt: 'desc'
            },
            take: 10
          });
          
          console.log(`\n   Recent MMR calculation logs: ${mmrLogs.length}`);
          mmrLogs.forEach(log => {
            const battleHour = log.battle?.startedAt.getUTCHours();
            console.log(`     Battle ${log.battleId} → UTC Hour: ${battleHour}, Players: ${log.playerCount}, Processed: ${log.processedAt.toISOString()}`);
          });
          
        } else {
          console.log(`   ❌ No guild season found for active season`);
        }
      } else {
        console.log(`   ❌ No active season found`);
      }
    } else {
      console.log(`   ❌ Guild "S L I C E D" not found`);
    }
    
  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the diagnosis
diagnosePrimeTimeWindows()
  .then(() => {
    console.log('\n✅ Diagnosis completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Diagnosis failed:', error);
    process.exit(1);
  });

export { diagnosePrimeTimeWindows };
