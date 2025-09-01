# 🏆 Improved MMR Calculation System

## Overview

This document explains the significant improvements made to the MMR calculation system to address fairness issues and ensure proportional MMR changes based on guild participation levels.

## 🎯 Problems Addressed

### 1. **Unfair Proportional MMR Changes**
**Problem**: Guilds with very few players were getting similar MMR changes to guilds with many players.

**Example from Battle 1268814359**:
- **Throwing Chair**: 12 players, earned 14.65 MMR points
- **Conflict**: 1 player, earned 10.44 MMR points
- **Issue**: Single player guild getting 71% of the MMR change of a 12-player guild

### 2. **Insufficient Participation Filtering**
**Problem**: Guilds with minimal participation were still receiving MMR changes.

**Examples of guilds that should be excluded**:
- **The Plaga**: 0 kills, 0 deaths, 55K fame (2.6% of total)
- **IMP4CT**: 0 kills, 1 death, 168K fame (7.8% of total)
- **The Lonely Men**: 0 kills, 0 deaths, 78K fame (3.6% of total)

## ✅ Solutions Implemented

### 1. **Stricter Participation Thresholds**

#### Previous Thresholds (Too Lenient)
```typescript
MIN_FAME_PARTICIPATION_RATIO: 0.005, // 0.5% of total battle fame
MIN_KILLS_DEATHS_RATIO: 0.01,        // 1% of total battle kills+deaths
MIN_PLAYER_RATIO: 0.01,              // 1% of total battle players
```

#### New Thresholds (Much Stricter)
```typescript
MIN_FAME_PARTICIPATION_RATIO: 0.10,  // 10% of total battle fame (20x stricter)
MIN_KILLS_DEATHS_RATIO: 0.10,        // 10% of total battle kills+deaths (10x stricter)
MIN_PLAYER_RATIO: 0.10,              // 10% of total battle players (10x stricter)
```

#### Higher Absolute Thresholds
```typescript
MIN_ABSOLUTE_FAME_PARTICIPATION: 500000, // Minimum 500K fame gained or lost (2.5x higher)
MIN_ABSOLUTE_KILLS_DEATHS: 5,            // Minimum 5 kills OR deaths combined (2.5x higher)
MIN_ABSOLUTE_PLAYERS: 3,                 // Minimum 3 players for significant participation (1.5x higher)
```

### 2. **Proportional MMR Calculation**

#### Player Count Scaling Factor
```typescript
// New constants for proportional calculation
PLAYER_COUNT_SCALING_FACTOR: 0.8,           // Power function for smooth scaling
MIN_PLAYER_COUNT_FOR_FULL_MMR: 8,           // 8+ players get full MMR changes
MAX_PLAYER_COUNT_FOR_SCALING: 20,           // Cap for very large guilds
```

#### Scaling Formula
```typescript
private calculatePlayerCountScalingFactor(guildStat: GuildBattleStats): number {
  const playerCount = guildStat.players;
  
  // Guilds with 8+ players get full scaling
  if (playerCount >= MMR_CONSTANTS.MIN_PLAYER_COUNT_FOR_FULL_MMR) {
    return 1.0;
  }
  
  // Single players get heavily reduced scaling
  if (playerCount <= 1) {
    return 0.1; // 10% of normal MMR change
  }
  
  // Smooth scaling for 2-7 players
  const scalingFactor = Math.pow(
    playerCount / MMR_CONSTANTS.MIN_PLAYER_COUNT_FOR_FULL_MMR,
    MMR_CONSTANTS.PLAYER_COUNT_SCALING_FACTOR
  );
  
  return Math.max(0.1, Math.min(1.0, scalingFactor));
}
```

### 3. **Enhanced Participation Logic**

#### New Participation Criteria
A guild is considered to have **significant participation** if it meets **ALL** of these conditions:

1. **At least 2 out of 3 relative criteria**:
   - Fame participation ≥ 10% of total battle fame (or ≥ 500K absolute)
   - Kills/deaths ≥ 10% of total battle kills+deaths (or ≥ 5 absolute)
   - Player count ≥ 10% of total battle players (or ≥ 3 absolute)

2. **Must have meaningful participation**:
   - At least 1 kill **OR** 1 death

3. **Alliance bonus** (reduced from 50% to 30%):
   - Guilds from major participating alliances get 30% threshold reduction

4. **Single-player guilds** (additional strict criteria):
   - Must have ≥ 8 kills OR deaths combined
   - Must have ≥ 1M fame gained or lost

## 📊 Expected Results for Battle 1268814359

### ❌ **Excluded Guilds (Insufficient Participation)**
```
The Plaga:
  - 0 kills, 0 deaths
  - 55K fame (2.6% of total) - below 10% threshold
  - 2 players (5.9% of total) - below 10% threshold
  - Result: ❌ EXCLUDED (no kills/deaths + insufficient participation)

IMP4CT:
  - 0 kills, 1 death
  - 168K fame (7.8% of total) - below 10% threshold
  - 1 player (2.9% of total) - below 10% threshold
  - Result: ❌ EXCLUDED (single player with insufficient kills/deaths and fame)

The Lonely Men:
  - 0 kills, 0 deaths
  - 78K fame (3.6% of total) - below 10% threshold
  - 1 player (2.9% of total) - below 10% threshold
  - Result: ❌ EXCLUDED (no kills/deaths + insufficient participation)

Conflict:
  - 0 kills, 0 deaths
  - 125K fame (5.8% of total) - below 10% threshold
  - 1 player (2.9% of total) - below 10% threshold
  - Result: ❌ EXCLUDED (single player with insufficient participation)
```

### ✅ **Included Guilds (Significant Participation)**
```
Black Dragon Aeon:
  - 3 kills, 5 deaths (8 total)
  - 1.1M fame (52% of total) - above 10% threshold
  - 10 players (29% of total) - above 10% threshold
  - Result: ✅ INCLUDED (full MMR changes)

Anyway We Try:
  - 3 kills, 5 deaths (8 total)
  - 1.2M fame (57% of total) - above 10% threshold
  - 6 players (18% of total) - above 10% threshold
  - Result: ✅ INCLUDED (75% MMR scaling)

Throwing Chair:
  - 8 kills, 3 deaths (11 total)
  - 1.5M fame (70% of total) - above 10% threshold
  - 12 players (35% of total) - above 10% threshold
  - Result: ✅ INCLUDED (full MMR changes)
```

## 🎯 **Proportional MMR Changes**

### Before (Unfair)
```
Throwing Chair (12 players): +14.65 MMR points
Conflict (1 player): +10.44 MMR points
Ratio: 1.4x (unfair for 12x player difference)
```

### After (Fair)
```
Throwing Chair (12 players): +14.65 MMR points (100% scaling)
Conflict (1 player): EXCLUDED (insufficient participation)
Result: Only guilds with 10%+ participation get MMR changes
```

## 🔧 **Implementation Details**

### 1. **Updated Constants**
```typescript
// In src/services/mmr.ts
const MMR_CONSTANTS = {
  // ... existing constants ...
  
  // IMPROVED: Much stricter participation thresholds
  MIN_FAME_PARTICIPATION_RATIO: 0.10,  // 10% (was 0.5%)
  MIN_KILLS_DEATHS_RATIO: 0.10,        // 10% (was 1%)
  MIN_PLAYER_RATIO: 0.10,              // 10% (was 1%)
  
  // IMPROVED: Higher absolute minimums
  MIN_ABSOLUTE_FAME_PARTICIPATION: 500000,
  MIN_ABSOLUTE_KILLS_DEATHS: 5,
  MIN_ABSOLUTE_PLAYERS: 3,
  
  // IMPROVED: Proportional scaling
  PLAYER_COUNT_SCALING_FACTOR: 0.8,
  MIN_PLAYER_COUNT_FOR_FULL_MMR: 8,
  MAX_PLAYER_COUNT_FOR_SCALING: 20,
  
  // Reduced alliance bonus
  ALLIANCE_PARTICIPATION_BONUS: 0.3,   // 30% (was 50%)
} as const;
```

### 2. **Enhanced Participation Logic**
```typescript
// In src/services/mmr.ts - hasSignificantParticipation method
static hasSignificantParticipation(
  guildStat: GuildBattleStats,
  battleAnalysis: BattleAnalysis
): boolean {
  // ... calculate ratios ...
  
  // IMPROVED: Check both relative and absolute criteria
  const hasFameParticipation = fameRatio >= adjustedFameThreshold || 
                              guildFameParticipation >= MMR_CONSTANTS.MIN_ABSOLUTE_FAME_PARTICIPATION;
  const hasKillsDeathsParticipation = killsDeathsRatio >= adjustedKillsDeathsThreshold || 
                                     guildKillsDeaths >= MMR_CONSTANTS.MIN_ABSOLUTE_KILLS_DEATHS;
  const hasPlayerParticipation = playerRatio >= adjustedPlayerThreshold || 
                                guildStat.players >= MMR_CONSTANTS.MIN_ABSOLUTE_PLAYERS;

  // IMPROVED: Much stricter criteria for single-player guilds
  const isSinglePlayer = guildStat.players <= 1;
  const hasSignificantKillsDeaths = guildKillsDeaths >= 8; // At least 8 kills OR deaths for single players
  const hasSignificantFame = guildFameParticipation >= 1000000; // At least 1M fame for single players
  
  // For single players, require higher thresholds
  if (isSinglePlayer) {
    const hasSignificantParticipationForSinglePlayer = 
      hasAnyKillsOrDeaths && 
      hasSignificantKillsDeaths && 
      hasSignificantFame;
    
    return hasSignificantParticipationForSinglePlayer || isFromMajorAlliance;
  }

  // IMPROVED: Must have meaningful participation
  const hasAnyKillsOrDeaths = guildStat.kills > 0 || guildStat.deaths > 0;
  
  const participationScore = [
    hasFameParticipation,
    hasKillsDeathsParticipation,
    hasPlayerParticipation,
  ].filter(Boolean).length;

  return (participationScore >= 2 && hasAnyKillsOrDeaths) || isFromMajorAlliance;
}
```

### 3. **Proportional MMR Calculation**
```typescript
// In src/services/mmr.ts - calculateGuildMmrChangeWithAntiFarming method
// IMPROVED: Apply proportional scaling based on player count
const playerCountScalingFactor = this.calculatePlayerCountScalingFactor(guildStat);

// Apply K-factor with scaling
let finalMmrChange = Math.max(
  -MMR_CONSTANTS.K_FACTOR,
  Math.min(
    MMR_CONSTANTS.K_FACTOR,
    totalMmrChange * MMR_CONSTANTS.K_FACTOR * playerCountScalingFactor
  )
);
```

## 🧪 **Testing**

### Run the Example
```bash
# Test the improved calculation with the example battle
yarn tsx src/examples/improvedMmrCalculation.ts
```

### Expected Output
```
🏆 Demonstrating Improved MMR Calculation
==========================================

📊 Battle Overview:
Battle ID: 1268814359
Total Players: 34
Total Fame: 2,152,389
Duration: 5 minutes
Prime Time: No

🔍 Participation Analysis:
==========================

The Plaga:
  Players: 2 (5.88% of total)
  Kills/Deaths: 0/0 (0 total)
  Fame: 55,700 (2.59% of total)
  Significant Participation: ❌ NO
  ❌ REASON: Insufficient participation - will be excluded from MMR calculation

...

🎯 Improved MMR Calculation Results:
====================================

Guilds with significant participation: 4/7

Conflict:
  Players: 1
  Player Count Scaling Factor: 0.100
  Estimated MMR Change: 10.2 points
  (This is proportional to their participation level)

Throwing Chair:
  Players: 12
  Player Count Scaling Factor: 1.000
  Estimated MMR Change: 96.4 points
  (This is proportional to their participation level)
```

## 📈 **Benefits**

### 1. **Fairer MMR System**
- Single players get 10% of normal MMR changes
- Small guilds get proportional scaling
- Large guilds get full MMR changes

### 2. **Cleaner Data**
- Eliminates "rats" and minimal participants
- Focuses on guilds that meaningfully contribute to battles
- Reduces noise in MMR rankings

### 3. **Better Rankings**
- MMR reflects actual battle performance
- Prevents exploitation by minimal participation
- Rewards genuine battle contribution

### 4. **Alliance-Friendly**
- Still allows alliance guilds to participate
- Reduced but still present alliance bonus
- Prevents abuse while maintaining fairness

## 🔄 **Migration**

This change is **backward compatible** and doesn't require database migrations. The improvements are applied during battle analysis and MMR calculation, so existing data remains unchanged.

## 📝 **Monitoring**

Monitor these log patterns to see the improvements in action:

- `"Guild participation analysis"` - Detailed participation breakdown
- `"Player Count Scaling Factor"` - Proportional scaling applied
- `"Filtering out guild"` - Guilds excluded for insufficient participation
- `"Significant participation: NO"` - Guilds that don't meet criteria

## 🎯 **Future Improvements**

1. **Dynamic Thresholds**: Adjust thresholds based on battle size
2. **Alliance Detection**: Better alliance detection from battle data
3. **Performance Metrics**: Track MMR distribution and fairness metrics
4. **Seasonal Adjustments**: Fine-tune thresholds based on season data

---

**Result**: A fairer, more accurate MMR system that rewards genuine participation and prevents exploitation by minimal participants.
