import { 
  zBattleListItem, 
  zKillEvent, 
  parseBattleList, 
  parseKillEvents,
  safeParseBattleList,
  safeParseKillEvents
} from '../albion.js';

// Sample battle data for testing (matching actual API response)
const sampleBattleData = {
  albionId: 123456789,
  startedAt: "2024-01-15T10:30:00Z",
  endedAt: "2024-01-15T11:45:00Z",
  totalFame: 1500000,
  totalKills: 45,
  totalPlayers: 120,
  alliances: [
    {
      id: "alliance1",
      name: "Test Alliance",
      tag: "TEST",
      killFame: 800000,
      deathFame: 200000,
      players: 60
    }
  ],
  guilds: [
    {
      id: "guild1",
      name: "Test Guild",
      alliance: "TEST",
      killFame: 400000,
      deathFame: 100000,
      players: 30
    }
  ]
};

// Sample kill event data for testing (matching actual API response from /battles/kills)
const sampleKillEventData = {
  EventId: 987654321,
  TimeStamp: "2024-01-15T10:35:00Z",
  TotalVictimKillFame: 50000,
  Killer: {
    Id: "killer-id-123",
    Name: "KillerPlayer",
    GuildName: "KillerGuild",
    AllianceName: "KillerAlliance",
    AverageItemPower: 1200.5,
    Equipment: {
      MainHand: {
        Name: "MAIN_SWORD",
        Type: "T8_MAIN_SWORD@3",
        Quality: 4
      },
      Mount: {
        Name: "MOUNT_HORSE",
        Type: "T5_MOUNT_HORSE@1",
        Quality: 1
      }
    }
  },
  Victim: {
    Id: "victim-id-456",
    Name: "VictimPlayer",
    GuildName: "VictimGuild",
    AllianceName: "VictimAlliance",
    AverageItemPower: 1100.0,
    Equipment: {
      MainHand: {
        Name: "MAIN_SWORD",
        Type: "T7_MAIN_SWORD@2",
        Quality: 3
      },
      Mount: {
        Name: "MOUNT_HORSE",
        Type: "T4_MOUNT_HORSE@1",
        Quality: 1
      }
    }
  }
};

// Test battle list parsing
console.log('🧪 Testing Battle List Parsing...');

try {
  const battle = zBattleListItem.parse(sampleBattleData);
  console.log('✅ Battle parsing successful:', {
    id: battle.albionId.toString(),
    startTime: battle.startedAt,
    totalFame: battle.totalFame,
    totalKills: battle.totalKills
  });
} catch (error) {
  console.error('❌ Battle parsing failed:', error);
}

// Test kill event parsing
console.log('\n🧪 Testing Kill Event Parsing...');

try {
  const killEvent = zKillEvent.parse(sampleKillEventData);
  console.log('✅ Kill event parsing successful:', {
    id: killEvent.EventId.toString(),
    timestamp: killEvent.TimeStamp,
    fame: killEvent.TotalVictimKillFame,
    killer: killEvent.Killer.Name,
    victim: killEvent.Victim.Name
  });
} catch (error) {
  console.error('❌ Kill event parsing failed:', error);
}

// Test array parsing
console.log('\n🧪 Testing Array Parsing...');

try {
  const battles = parseBattleList([sampleBattleData]);
  console.log('✅ Battle list parsing successful:', battles.length, 'battles');
  
  const killEvents = parseKillEvents([sampleKillEventData]);
  console.log('✅ Kill events parsing successful:', killEvents.length, 'kills');
} catch (error) {
  console.error('❌ Array parsing failed:', error);
}

// Test safe parsing with invalid data
console.log('\n🧪 Testing Safe Parsing with Invalid Data...');

const invalidBattleData = {
  albionId: "invalid",
  startedAt: "not-a-date",
  totalFame: -1000, // Invalid negative value
  totalKills: "not-a-number", // Invalid type
  totalPlayers: 0 // Invalid zero value
};

try {
  const safeBattleResult = safeParseBattleList([invalidBattleData]);
  console.log('Safe battle parsing result:', safeBattleResult === null ? '✅ Failed (expected)' : '❌ Unexpected success');
} catch (error) {
  console.log('✅ Safe battle parsing failed as expected:', error.message);
}

const invalidKillData = {
  EventId: "invalid",
  TimeStamp: "not-a-date",
  TotalVictimKillFame: -50000, // Invalid negative value
  Killer: {
    Id: "killer-id",
    Name: "A".repeat(100), // Too long name
    GuildName: "B".repeat(100), // Too long guild name
    AverageItemPower: -100 // Invalid negative value
  },
  Victim: {
    Id: "victim-id",
    Name: "", // Empty name
    AverageItemPower: -100 // Invalid negative value
  }
};

try {
  const safeKillResult = safeParseKillEvents([invalidKillData]);
  console.log('Safe kill parsing result:', safeKillResult === null ? '✅ Failed (expected)' : '❌ Unexpected success');
} catch (error) {
  console.log('✅ Safe kill parsing failed as expected:', error.message);
}

console.log('\n🎉 All parse tests completed!');
