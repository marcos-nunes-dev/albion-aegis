# 🏆 Albion Online Guild MMR System Integration Guide

## Overview

The Guild MMR (Matchmaking Rating) system provides a comprehensive ranking system for Albion Online guilds based on their battle performance. The system calculates MMR using multiple factors including win/loss ratios, fame differential, player counts, equipment levels, and more.

## 🚀 Quick Start

### 1. Database Migration

The MMR system requires new database tables. Run the migration:

```bash
npx prisma migrate dev --name add-mmr-system
```

### 2. Start MMR Workers

Start the MMR processing workers:

```bash
yarn tsx apps/mmr-worker.ts
```

### 3. Create Your First Season

Create and activate a season for MMR calculations:

```bash
# Create a season
yarn tsx apps/manage-mmr.ts create-season "Season 1" "2024-01-01"

# List seasons to get the season ID
yarn tsx apps/manage-mmr.ts list-seasons

# Activate the season (replace with your season ID)
yarn tsx apps/manage-mmr.ts activate-season "your-season-id"

# Add prime time windows (e.g., 20:00-21:00 UTC)
yarn tsx apps/manage-mmr.ts add-prime-time "your-season-id" 20 21
```

### 4. Process Historical Battles (Optional)

Backfill MMR for existing battles:

```bash
yarn tsx apps/manage-mmr.ts process-historical "2024-01-01" "2024-01-31" 50
```

## 📊 System Architecture

### Core Components

1. **Database Models**
   - `Season` - Time periods for MMR calculations
   - `PrimeTimeWindow` - Specific hours for mass calculations
   - `Guild` - Unique guild information with AlbionBB IDs
   - `GuildSeason` - MMR data per guild per season
   - `MmrCalculationJob` - Job tracking for MMR processing

2. **Services**
   - `GuildService` - Guild discovery and management
   - `SeasonService` - Season and prime time management
   - `MmrService` - Core MMR calculation logic
   - `BattleAnalysisService` - Battle data transformation
   - `MmrIntegrationService` - Main integration point

3. **Queue System**
   - `mmr-calculation` queue - Individual battle MMR jobs
   - `mmr-batch` queue - Batch processing jobs
   - Redis-based with BullMQ

### MMR Calculation Factors

The system considers multiple factors in MMR calculations:

- **Win/Loss Ratio** (40% weight) - Primary factor
- **Fame Differential** (20% weight) - Fame gained vs lost
- **Player Count Advantage** (10% weight) - Numbers advantage/disadvantage
- **Equipment/IP Level** (10% weight) - Average item power
- **Battle Size** (5% weight) - Small skirmish vs large zerg
- **K/D Ratio** (5% weight) - Kill/death efficiency
- **Battle Duration** (5% weight) - How fast battles are won
- **Kill Clustering** (5% weight) - Rapid successive kills
- **Opponent MMR Strength** (10% weight) - Quality of opponents

### Battle Criteria

MMR is only calculated for battles that meet these criteria:
- **Minimum 25 total players**
- **Minimum 2,000,000 total fame**

## 🛠️ Management Commands

### Season Management

```bash
# Create a new season
yarn tsx apps/manage-mmr.ts create-season "Season Name" "2024-01-01" "2024-02-01"

# List all seasons
yarn tsx apps/manage-mmr.ts list-seasons

# Activate a season
yarn tsx apps/manage-mmr.ts activate-season "season-id"

# End a season
yarn tsx apps/manage-mmr.ts end-season "season-id" "2024-02-01"
```

### Prime Time Management

```bash
# Add prime time window (20:00-21:00 UTC)
yarn tsx apps/manage-mmr.ts add-prime-time "season-id" 20 21

# List prime time windows
yarn tsx apps/manage-mmr.ts list-prime-times "season-id"
```

### Data Processing

```bash
# Process historical battles
yarn tsx apps/manage-mmr.ts process-historical "2024-01-01" "2024-01-31" 100

# Get processing statistics
yarn tsx apps/manage-mmr.ts get-stats

# Check system health
yarn tsx apps/manage-mmr.ts health-check
```

### MMR Queries

```bash
# Get top guilds by MMR
yarn tsx apps/manage-mmr.ts top-guilds 20

# Get specific guild MMR
yarn tsx apps/manage-mmr.ts guild-mmr "S L I C E D"
```

## 🔄 Integration with Existing System

### Automatic Integration

The MMR system is automatically integrated into your existing battle processing pipeline:

1. **Battle Crawler** → Creates battles in database
2. **Kills Fetcher** → Fetches kill events and triggers MMR processing
3. **MMR Workers** → Process MMR calculations asynchronously

### Manual Integration

If you need to manually trigger MMR processing:

```typescript
import { MmrIntegrationService } from './src/services/mmrIntegration.js';
import { prisma } from './src/db/prisma.js';

const mmrIntegration = new MmrIntegrationService(prisma);

// Process a single battle
await mmrIntegration.processBattleForMmr(battleId, battleData, killsData);

// Process multiple battles
await mmrIntegration.processBattlesForMmr(battles);

// Process historical battles
await mmrIntegration.processHistoricalBattlesForMmr(startDate, endDate, batchSize);
```

## 📈 Monitoring and Health

### System Health Check

```bash
yarn tsx apps/manage-mmr.ts health-check
```

This checks for:
- Active seasons
- Guild discovery status
- Failed MMR calculations
- Stuck jobs

### Statistics

```bash
yarn tsx apps/manage-mmr.ts get-stats
```

Shows:
- Total battles processed
- Total guilds tracked
- Active seasons
- Last processed battle

### Queue Monitoring

The MMR system uses Redis queues. Monitor them with:

```bash
# Check queue statistics
redis-cli LLEN mmr-calculation
redis-cli LLEN mmr-batch
```

## 🎯 MMR System Features

### Season Management
- **Manual Creation** - Create seasons with custom start/end dates
- **Partial Reset** - MMR partially carries over between seasons
- **Performance Bonus** - Guilds that performed well get a bonus in the next season

### Prime Time Mass Tracking
- **Configurable Windows** - Define multiple prime time periods
- **Average Mass** - Track average player count during prime times
- **MMR Impact** - Prime time battles have additional weight

### Friend Detection
- **Cross-Kill Analysis** - Detects guilds fighting together
- **Minimal Conflict** - Identifies allies based on kill patterns
- **Group Adjustments** - Adjusts MMR calculations for friend groups

### Error Handling
- **Retry Logic** - Failed calculations are retried automatically
- **Fallback MMR** - Symbolic MMR changes for permanently failed calculations
- **Graceful Degradation** - System continues working even with partial failures

## 🔧 Configuration

### Environment Variables

The MMR system uses your existing configuration:

- `REDIS_URL` - For queue management
- `DATABASE_URL` - For data storage
- `API_BASE_URL` - For AlbionBB guild search

### MMR Constants

Key MMR calculation constants (in `src/services/mmr.ts`):

```typescript
const MMR_CONSTANTS = {
  BASE_MMR: 1000.0,
  K_FACTOR: 32,
  WIN_LOSS_WEIGHT: 0.4,
  FAME_WEIGHT: 0.2,
  // ... more constants
};
```

## 🚨 Troubleshooting

### Common Issues

1. **No Active Seasons**
   - Create and activate a season
   - Check with `list-seasons` command

2. **Failed MMR Calculations**
   - Check system health with `health-check`
   - Review logs for specific errors
   - Ensure battles meet criteria (25+ players, 2M+ fame)

3. **Guild Not Found**
   - Guild discovery happens automatically
   - Check AlbionBB API connectivity
   - Verify guild names are exact (case-sensitive)

4. **Queue Issues**
   - Ensure Redis is running
   - Check MMR workers are started
   - Monitor queue lengths

### Log Analysis

Key log components to monitor:
- `mmr-integration` - Main integration logs
- `mmr-queue` - Queue processing logs
- `mmr-service` - MMR calculation logs
- `battle-analysis` - Battle data processing logs

## 📚 API Reference

### Core Services

#### MmrService
```typescript
// Calculate MMR for a battle
await mmrService.calculateMmrForBattle(battleAnalysis);

// Get guild season MMR
await mmrService.getGuildSeasonMmr(guildId, seasonId);

// Get top guilds
await mmrService.getTopGuildsByMmr(seasonId, limit);
```

#### SeasonService
```typescript
// Create season
await seasonService.createSeason(name, startDate, endDate);

// Get active season
await seasonService.getActiveSeason();

// Add prime time window
await seasonService.addPrimeTimeWindow(seasonId, startHour, endHour);
```

#### GuildService
```typescript
// Get or create guild
await guildService.getOrCreateGuild(guildName);

// Get guild by name
await guildService.getGuildByName(guildName);
```

## 🎉 Next Steps

1. **Start MMR Workers** - Begin processing MMR calculations
2. **Create First Season** - Set up your initial season
3. **Process Historical Data** - Backfill MMR for existing battles
4. **Monitor Performance** - Use health checks and statistics
5. **Customize Factors** - Adjust MMR calculation weights if needed

The MMR system is now fully integrated and ready to provide comprehensive guild rankings for your Albion Online battle tracking application!
