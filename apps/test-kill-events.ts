import { parseKillEvents, safeParseKillEvents } from '../src/types/albion.js';
import { log } from '../src/log.js';

const logger = log.child({ component: 'test-kill-events' });

async function testKillEvents() {
  logger.info('Testing kill events validation...');
  
  // The kill events payload from the user
  const killEventsPayload = [
    {
        "EventId": 1265121608,
        "TimeStamp": "2025-08-25T21:50:19.445Z",
        "TotalVictimKillFame": 0,
        "Killer": {
            "Id": "BuZspbXeSZ-4MeQEoAzcPg",
            "Name": "TranceNight",
            "GuildName": "I Not So Friendly I",
            "AllianceName": "ENTR",
            "AverageItemPower": 1088.16418,
            "Equipment": {
                "MainHand": {
                    "Name": "2H_DUALSWORD",
                    "Type": "T5_2H_DUALSWORD@1",
                    "Quality": 2
                },
                "Mount": {
                    "Name": "MOUNT_HORSE",
                    "Type": "T3_MOUNT_HORSE",
                    "Quality": 2
                }
            }
        },
        "Victim": {
            "Id": "CdFU94v5QRqhA0VaQviD7w",
            "Name": "Retnark",
            "GuildName": "4pm",
            "AllianceName": "4x7",
            "AverageItemPower": 0,
            "Equipment": {
                "MainHand": null,
                "Mount": null
            }
        }
    },
    {
        "EventId": 1265122450,
        "TimeStamp": "2025-08-25T21:52:09.204Z",
        "TotalVictimKillFame": 25296,
        "Killer": {
            "Id": "E4CgDnOgTgeXnEG_7jTc2Q",
            "Name": "Zetkko",
            "GuildName": "R E H A B",
            "AllianceName": "C0C",
            "AverageItemPower": 1069.71667,
            "Equipment": {
                "MainHand": {
                    "Name": "2H_CROSSBOWLARGE",
                    "Type": "T4_2H_CROSSBOWLARGE@1",
                    "Quality": 1
                },
                "Mount": {
                    "Name": "MOUNT_HORSE",
                    "Type": "T3_MOUNT_HORSE",
                    "Quality": 1
                }
            }
        },
        "Victim": {
            "Id": "BuZspbXeSZ-4MeQEoAzcPg",
            "Name": "TranceNight",
            "GuildName": "I Not So Friendly I",
            "AllianceName": "ENTR",
            "AverageItemPower": 1088.16418,
            "Equipment": {
                "MainHand": {
                    "Name": "2H_DUALSWORD",
                    "Type": "T5_2H_DUALSWORD@1",
                    "Quality": 2
                },
                "Mount": {
                    "Name": "MOUNT_HORSE",
                    "Type": "T3_MOUNT_HORSE",
                    "Quality": 2
                }
            }
        }
    }
  ];

  try {
    // Test with safe parse first
    logger.info('Testing safe parse...');
    const safeResult = safeParseKillEvents(killEventsPayload);
    
    if (safeResult) {
      logger.info({
        message: 'Safe parse successful',
        count: safeResult.length
      });
    } else {
      logger.error('Safe parse failed - no detailed error info');
    }

    // Test with regular parse to get detailed error
    logger.info('Testing regular parse...');
    const result = parseKillEvents(killEventsPayload);
    
    logger.info({
      message: 'Regular parse successful',
      count: result.length
    });

  } catch (error) {
    logger.error({
      message: 'Kill events validation failed',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

// Run the test
testKillEvents().catch(console.error);
