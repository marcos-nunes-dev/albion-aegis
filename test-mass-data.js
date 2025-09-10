import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkMassData() {
  try {
    console.log('🔍 Checking GuildPrimeTimeMass data...');
    
    // Check if there are any prime time windows
    const primeTimeWindows = await prisma.primeTimeWindow.findMany();
    console.log(`📊 Prime Time Windows: ${primeTimeWindows.length}`);
    primeTimeWindows.forEach(pt => {
      console.log(`  - ${pt.startHour}:00 - ${pt.endHour}:00 (${pt.timezone})`);
    });
    
    // Check if there are any guild prime time masses
    const guildMasses = await prisma.guildPrimeTimeMass.findMany({
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
    
    console.log(`📊 Guild Prime Time Masses: ${guildMasses.length}`);
    guildMasses.forEach(mass => {
      console.log(`  - Guild: ${mass.guildSeason.guild.name}, Season: ${mass.guildSeason.season.name}, Window: ${mass.primeTimeWindow.startHour}:00-${mass.primeTimeWindow.endHour}:00, Avg Mass: ${mass.avgMass}`);
    });
    
    // Check total count
    const totalMasses = await prisma.guildPrimeTimeMass.count();
    console.log(`📊 Total Guild Prime Time Masses: ${totalMasses}`);
    
    // Check if there are any guild seasons
    const guildSeasons = await prisma.guildSeason.findMany({
      take: 5,
      include: {
        guild: true,
        season: true,
        primeTimeMasses: true
      }
    });
    
    console.log(`📊 Guild Seasons: ${guildSeasons.length}`);
    guildSeasons.forEach(gs => {
      console.log(`  - Guild: ${gs.guild.name}, Season: ${gs.season.name}, Prime Time Masses: ${gs.primeTimeMasses.length}`);
    });
    
  } catch (error) {
    console.error('❌ Error checking mass data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkMassData();
