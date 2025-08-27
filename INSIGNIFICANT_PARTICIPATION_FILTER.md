# 🚫 Insignificant Participation Filtering

## Overview

This document explains the new filtering system that prevents guilds with insignificant participation from receiving MMR changes. This addresses the issue of "rats" (players who just pass by or cause minor disturbances) and guilds that don't meaningfully participate in battles.

## ❌ **Previous Behavior**

Before this update, your MMR system processed **ALL guilds** in a battle, including:
- Guilds with 0 kills and 0 deaths
- Guilds that just "pass by" and get caught in the battle
- "Rats" with minimal participation (1 kill, very low fame)
- Guilds with no meaningful impact on the battle outcome

## ✅ **New Behavior**

The system now filters out guilds with insignificant participation based on these criteria:

### Minimum Participation Thresholds

```typescript
const MMR_CONSTANTS = {
  // ... existing constants ...
  
  // Minimum participation thresholds to filter out "rats" and insignificant participants
  MIN_GUILD_KILLS: 1, // Minimum kills for significant participation
  MIN_GUILD_DEATHS: 1, // Minimum deaths for significant participation
  MIN_GUILD_FAME_PARTICIPATION: 100000, // Minimum fame gained or lost for participation (100K)
  MIN_GUILD_PLAYERS: 1, // Minimum players for significant participation
} as const;
```

### Participation Criteria

A guild is considered to have **significant participation** if it meets **ALL** of these conditions:

1. **Kills OR Deaths**: Must have at least 1 kill **OR** 1 death
2. **Fame Participation**: Must have gained **OR** lost at least 100,000 fame
3. **Player Count**: Must have at least 1 player

### Filtering Logic

```typescript
static hasSignificantParticipation(guildStat: GuildBattleStats): boolean {
  // Must have at least some kills OR deaths
  const hasKillsOrDeaths = guildStat.kills >= MMR_CONSTANTS.MIN_GUILD_KILLS || 
                          guildStat.deaths >= MMR_CONSTANTS.MIN_GUILD_DEATHS;
  
  // Must have participated in fame (gained OR lost significant fame)
  const hasFameParticipation = guildStat.fameGained >= MMR_CONSTANTS.MIN_GUILD_FAME_PARTICIPATION || 
                              guildStat.fameLost >= MMR_CONSTANTS.MIN_GUILD_FAME_PARTICIPATION;
  
  // Must have at least some players
  const hasPlayers = guildStat.players >= MMR_CONSTANTS.MIN_GUILD_PLAYERS;
  
  // All conditions must be met
  return hasKillsOrDeaths && hasFameParticipation && hasPlayers;
}
```

## 📊 **Examples**

### ❌ **Filtered Out (Insignificant Participation)**

```typescript
// Guild that just passes by
{
  guildName: "PassingBy Guild",
  kills: 0,
  deaths: 0,
  fameGained: 0,
  fameLost: 0,
  players: 2
}
// Result: ❌ Filtered out (no kills/deaths, no fame participation)

// Rat guild with minimal impact
{
  guildName: "Rat Guild",
  kills: 1,
  deaths: 0,
  fameGained: 5000, // Very low fame
  fameLost: 0,
  players: 1
}
// Result: ❌ Filtered out (insufficient fame participation)
```

### ✅ **Included (Significant Participation)**

```typescript
// Real participant
{
  guildName: "Real Participant",
  kills: 5,
  deaths: 3,
  fameGained: 250000, // Significant fame
  fameLost: 150000,
  players: 8
}
// Result: ✅ Included (meets all criteria)
```

## 🔧 **Implementation**

### Where Filtering Happens

The filtering occurs in `src/services/battleAnalysis.ts` in the `extractGuildStats` method:

```typescript
// Filter out guilds with insignificant participation
console.log(`🏆 [BATTLE-ANALYSIS] Filtering guilds with insignificant participation`);
const { MmrService } = await import('./mmr.js');
const significantGuildStats = guildStats.filter(guildStat => {
  const hasSignificantParticipation = MmrService.hasSignificantParticipation(guildStat);
  if (!hasSignificantParticipation) {
    console.log(`⚠️ [BATTLE-ANALYSIS] Filtering out guild ${guildStat.guildName} - insignificant participation`);
  }
  return hasSignificantParticipation;
});
```

### Logging

The system logs when guilds are filtered out:

```
⚠️ [BATTLE-ANALYSIS] Filtering out guild PassingBy Guild - insignificant participation (0 kills, 0 deaths, 0 fame gained, 0 fame lost, 2 players)
```

## ⚙️ **Configuration**

You can adjust the thresholds by modifying the constants in `src/services/mmr.ts`:

```typescript
// Adjust these values based on your needs
MIN_GUILD_KILLS: 1, // Increase for stricter filtering
MIN_GUILD_DEATHS: 1, // Increase for stricter filtering
MIN_GUILD_FAME_PARTICIPATION: 100000, // Increase for stricter filtering (currently 100K)
MIN_GUILD_PLAYERS: 1, // Increase for stricter filtering
```

## 🧪 **Testing**

You can test the filtering logic using the example in `src/examples/mmrIntegrationExample.ts`:

```typescript
import { exampleFilterInsignificantParticipation } from './src/examples/mmrIntegrationExample.js';

// Run the example
await exampleFilterInsignificantParticipation();
```

## 📈 **Benefits**

1. **More Accurate MMR**: Only guilds that meaningfully participate get MMR changes
2. **Reduced Noise**: Eliminates "rats" and passing guilds from affecting rankings
3. **Better Rankings**: MMR reflects actual battle performance, not incidental participation
4. **Cleaner Data**: Battle statistics focus on real participants

## 🔄 **Migration**

This change is **backward compatible** and doesn't require any database migrations. The filtering happens during battle analysis, so existing MMR data remains unchanged.

## 📝 **Monitoring**

Monitor these log patterns to see the filtering in action:

- `"Filtering guilds with insignificant participation"` - Filtering process started
- `"Filtering out guild X - insignificant participation"` - Guild filtered out
- `"Successfully processed X guilds from battle data, Y with significant participation"` - Filtering results

## 🎯 **Future Enhancements**

Consider these potential improvements:

1. **Dynamic Thresholds**: Adjust thresholds based on battle size
2. **Time-Based Filtering**: Consider battle duration for participation
3. **Guild History**: Use guild's historical participation patterns
4. **Alliance Filtering**: Apply similar logic to alliance participation
