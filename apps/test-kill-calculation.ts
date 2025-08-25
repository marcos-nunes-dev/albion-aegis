import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';

const logger = log.child({ component: 'test-kill-calculation' });
const prisma = new PrismaClient();

async function testKillCalculation() {
  try {
    logger.info('Testing kill calculation...');

    // Test with a recent battle
    const battleId = BigInt('1265138272');
    
    logger.info({
      message: 'Testing kill calculation for battle',
      battleId: battleId.toString()
    });

    // Get kill events from database for this battle
    const killEvents = await prisma.killEvent.findMany({
      where: { battleAlbionId: battleId },
      orderBy: { TimeStamp: 'asc' }
    });

    logger.info({
      message: 'Kill events found in database',
      count: killEvents.length,
      events: killEvents.map(ke => ({
        eventId: ke.EventId.toString(),
        killerGuild: ke.killerGuild,
        killerAlliance: ke.killerAlliance,
        victimGuild: ke.victimGuild,
        victimAlliance: ke.victimAlliance,
        timestamp: ke.TimeStamp
      }))
    });

    // Test calculation for PLVAS guild
    const entityName = 'PLVAS';
    const entityType = 'GUILD';
    
    let kills = 0;
    let deaths = 0;

    for (const killEvent of killEvents) {
      const killerEntity = entityType === 'GUILD' 
        ? killEvent.killerGuild 
        : killEvent.killerAlliance;
      
      const victimEntity = entityType === 'GUILD' 
        ? killEvent.victimGuild 
        : killEvent.victimAlliance;

      if (killerEntity === entityName) {
        kills++;
        logger.info({
          message: 'Kill found',
          eventId: killEvent.EventId.toString(),
          killer: killEvent.killerName,
          victim: killEvent.victimName
        });
      }
      if (victimEntity === entityName) {
        deaths++;
        logger.info({
          message: 'Death found',
          eventId: killEvent.EventId.toString(),
          killer: killEvent.killerName,
          victim: killEvent.victimName
        });
      }
    }

    logger.info({
      message: 'Kill calculation results',
      entityName,
      entityType,
      kills,
      deaths,
      isWin: kills > deaths
    });

    // Also test for alliance
    const allianceName = 'N0DE';
    const allianceType = 'ALLIANCE';
    
    let allianceKills = 0;
    let allianceDeaths = 0;

    for (const killEvent of killEvents) {
      const killerAlliance = killEvent.killerAlliance;
      const victimAlliance = killEvent.victimAlliance;

      if (killerAlliance === allianceName) {
        allianceKills++;
      }
      if (victimAlliance === allianceName) {
        allianceDeaths++;
      }
    }

    logger.info({
      message: 'Alliance kill calculation results',
      entityName: allianceName,
      entityType: allianceType,
      kills: allianceKills,
      deaths: allianceDeaths,
      isWin: allianceKills > allianceDeaths
    });

  } catch (error) {
    logger.error({
      message: 'Kill calculation test failed',
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    await prisma.$disconnect();
  }
}

testKillCalculation();
