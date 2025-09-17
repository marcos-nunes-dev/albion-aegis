#!/usr/bin/env tsx

import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const prisma = new PrismaClient();

/**
 * Create a backup of prime time mass data before repair
 */
async function backupPrimeTimeData() {
  console.log('💾 Creating backup of prime time mass data...');
  
  try {
    // Get all prime time mass records
    const primeTimeMassRecords = await prisma.guildPrimeTimeMass.findMany({
      include: {
        guildSeason: {
          include: {
            guild: true,
            season: true
          }
        },
        primeTimeWindow: true
      },
      orderBy: [
        { guildSeason: { guild: { name: 'asc' } } },
        { primeTimeWindow: { startHour: 'asc' } }
      ]
    });
    
    console.log(`Found ${primeTimeMassRecords.length} prime time mass records`);
    
    // Get all prime time windows for reference
    const primeTimeWindows = await prisma.primeTimeWindow.findMany({
      orderBy: { startHour: 'asc' }
    });
    
    console.log(`Found ${primeTimeWindows.length} prime time windows`);
    
    // Create backup data structure
    const backupData = {
      timestamp: new Date().toISOString(),
      description: "Backup of prime time mass data before repair script",
      primeTimeWindows: primeTimeWindows.map(window => ({
        id: window.id,
        startHour: window.startHour,
        endHour: window.endHour,
        timezone: window.timezone
      })),
      primeTimeMassRecords: primeTimeMassRecords.map(record => ({
        id: record.id,
        guildId: record.guildSeason.guild.id,
        guildName: record.guildSeason.guild.name,
        seasonId: record.guildSeason.season.id,
        seasonName: record.guildSeason.season.name,
        primeTimeWindowId: record.primeTimeWindowId,
        windowTime: `${record.primeTimeWindow.startHour}:00-${record.primeTimeWindow.endHour}:00`,
        avgMass: record.avgMass,
        battleCount: record.battleCount,
        lastBattleAt: record.lastBattleAt?.toISOString(),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString()
      })),
      summary: {
        totalRecords: primeTimeMassRecords.length,
        totalWindows: primeTimeWindows.length,
        recordsPerWindow: primeTimeWindows.map(window => ({
          window: `${window.startHour}:00-${window.endHour}:00`,
          recordCount: primeTimeMassRecords.filter(r => r.primeTimeWindowId === window.id).length
        }))
      }
    };
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `prime-time-mass-backup-${timestamp}.json`;
    
    // Write backup file
    writeFileSync(filename, JSON.stringify(backupData, null, 2));
    
    console.log(`✅ Backup created successfully: ${filename}`);
    console.log(`📊 Backup summary:`);
    console.log(`   - Total records: ${backupData.summary.totalRecords}`);
    console.log(`   - Prime time windows: ${backupData.summary.totalWindows}`);
    
    backupData.summary.recordsPerWindow.forEach(window => {
      console.log(`   - ${window.window}: ${window.recordCount} records`);
    });
    
    return filename;
    
  } catch (error) {
    console.error('❌ Error creating backup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the backup
backupPrimeTimeData()
  .then((filename) => {
    console.log(`\n✅ Prime time mass data backup completed: ${filename}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Prime time mass data backup failed:', error);
    process.exit(1);
  });

export { backupPrimeTimeData };
