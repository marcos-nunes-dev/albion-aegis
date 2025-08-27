# 🏆 Albion Online MMR System - Complete Integration Guide

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Core Services](#core-services)
5. [Queue System](#queue-system)
6. [MMR Algorithm](#mmr-algorithm)
7. [Season Management](#season-management)
8. [Prime Time Mass Tracking](#prime-time-mass-tracking)
9. [Quick Start](#quick-start)
10. [CLI Commands](#cli-commands)
11. [Integration Points](#integration-points)
12. [Monitoring & Health](#monitoring--health)
13. [Troubleshooting](#troubleshooting)
14. [Performance Optimization](#performance-optimization)

## 🎯 System Overview

The Albion Online MMR (Matchmaking Rating) system provides comprehensive guild ranking based on battle performance. It tracks guild performance across seasons, calculates sophisticated MMR scores, and provides detailed analytics for prime time mass tracking.

### Key Features

- **🎯 Sophisticated MMR Algorithm**: Multi-factor calculation considering win/loss, fame, player count, IP levels, battle size, K/D ratio, duration, and kill clustering
- **📅 Season Management**: Manual season creation with MMR carryover between seasons
- **⏰ Prime Time Tracking**: Per-prime-time mass tracking for detailed analytics
- **🔄 Asynchronous Processing**: Queue-based MMR calculations that don't block battle crawling
- **🏛️ Guild Management**: Automatic guild discovery and AlbionBB integration
- **📊 Comprehensive Analytics**: Detailed statistics and reporting capabilities

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Battle Data   │    │   Kill Events   │    │   MMR Queue     │
│   (Database)    │    │   (Database)    │    │   (Redis)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │  MMR Workers    │
                    │  (BullMQ)       │
                    └─────────────────┘
                                 │
                    ┌─────────────────┐
                    │  MMR Service    │
                    │  (Calculation)  │
                    └─────────────────┘
                                 │
                    ┌─────────────────┐
                    │  Database       │
                    │  (PostgreSQL)   │
                    └─────────────────┘
```

### Core Components

1. **Database Layer**: PostgreSQL with Prisma ORM
2. **Queue Layer**: Redis with BullMQ for job processing
3. **Service Layer**: TypeScript services for business logic
4. **Integration Layer**: Hooks into existing battle processing
5. **CLI Layer**: Management tools for system administration

## 🗄️ Database Schema

### Core Models

#### Season Management
```prisma
model Season {
  id          String   @id @default(cuid())
  name        String   @unique
  startDate   DateTime
  endDate     DateTime?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  guildSeasons GuildSeason[]
  primeTimeWindows PrimeTimeWindow[]
  mmrCalculationJobs MmrCalculationJob[]
}
```

#### Guild Management
```prisma
model Guild {
  id          String   @id // AlbionBB guild ID
  name        String   @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  guildSeasons GuildSeason[]
}
```

#### MMR Tracking
```prisma
model GuildSeason {
  id                    String   @id @default(cuid())
  guildId               String
  seasonId              String
  currentMmr            Float    @default(1000.0)
  previousSeasonMmr     Float?
  carryoverMmr          Float?   // 30% carryover to next season
  seasonEndMmr          Float?   // Final MMR when season ended
  totalBattles          Int      @default(0)
  wins                  Int      @default(0)
  losses                Int      @default(0)
  totalFameGained       BigInt   @default(0)
  totalFameLost         BigInt   @default(0)
  primeTimeBattles      Int      @default(0)
  lastBattleAt          DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  // Relations
  guild                 Guild    @relation(fields: [guildId], references: [id], onDelete: Cascade)
  season                Season   @relation(fields: [seasonId], references: [id], onDelete: Cascade)
  primeTimeMasses       GuildPrimeTimeMass[]

  @@unique([guildId, seasonId])
}
```

#### Prime Time Mass Tracking
```prisma
model GuildPrimeTimeMass {
  id                    String   @id @default(cuid())
  guildSeasonId         String
  primeTimeWindowId     String
  avgMass               Float    @default(0.0) // Average players during this prime time
  battleCount           Int      @default(0) // Number of battles in this prime time
  lastBattleAt          DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  // Relations
  guildSeason           GuildSeason @relation(fields: [guildSeasonId], references: [id], onDelete: Cascade)
  primeTimeWindow       PrimeTimeWindow @relation(fields: [primeTimeWindowId], references: [id], onDelete: Cascade)

  @@unique([guildSeasonId, primeTimeWindowId])
}
```

## 🔧 Core Services

### MMR Service (`src/services/mmr.ts`)

The core MMR calculation engine with sophisticated algorithms.

#### Key Methods

```typescript
// Calculate MMR for a battle
async calculateMmrForBattle(battleAnalysis: BattleAnalysis): Promise<Map<string, number>>

// Update guild season MMR
async updateGuildSeasonMmr(guildId: string, seasonId: string, mmrChange: number, battleStats: GuildBattleStats, battleAnalysis: BattleAnalysis): Promise<void>

// Process season end and calculate carryover
async processSeasonEnd(seasonId: string): Promise<void>

// Initialize new season with carryover MMR
async initializeNewSeason(newSeasonId: string, previousSeasonId: string): Promise<void>

// Get top guilds by MMR
async getTopGuildsByMmr(seasonId: string, limit: number = 100): Promise<GuildSeason[]>
```

#### MMR Calculation Factors

1. **Win/Loss (40% weight)**: Primary factor based on kill ratio
2. **Fame Differential (20% weight)**: Fame gained vs lost
3. **Player Count Advantage (10% weight)**: Numerical advantage/disadvantage
4. **IP Level Differences (10% weight)**: Equipment quality differences
5. **Battle Size (5% weight)**: Larger battles get more weight
6. **K/D Ratio (5% weight)**: Kill/death performance
7. **Battle Duration (5% weight)**: Quick wins get bonus
8. **Kill Clustering (5% weight)**: Coordinated attack detection
9. **Opponent MMR Strength (10% weight)**: Quality of opposition

### Season Service (`src/services/season.ts`)

Manages seasons, prime time windows, and season transitions.

#### Key Methods

```typescript
// Create a new season
async createSeason(name: string, startDate: Date, endDate?: Date): Promise<Season>

// Get active season
async getActiveSeason(): Promise<Season | null>

// End a season (with MMR carryover)
async endSeason(seasonId: string, endDate: Date): Promise<Season>

// Add prime time window
async addPrimeTimeWindow(seasonId: string, startHour: number, endHour: number, timezone?: string): Promise<PrimeTimeWindow>

// Initialize new season with carryover
async initializeNewSeasonWithCarryover(newSeasonId: string, previousSeasonId: string): Promise<void>
```

### Guild Service (`src/services/guild.ts`)

Handles guild discovery, creation, and management.

#### Key Methods

```typescript
// Get or create guild (with AlbionBB integration)
async getOrCreateGuild(guildName: string): Promise<Guild>

// Fetch guild ID from AlbionBB API
async fetchGuildId(guildName: string): Promise<string | null>

// Extract guilds from battle data
async processGuildsFromBattle(battleData: any, killsData: any[]): Promise<string[]>
```

### Battle Analysis Service (`src/services/battleAnalysis.ts`)

Transforms raw battle and kill data into MMR-ready format.

#### Key Methods

```typescript
// Create battle analysis for MMR calculation
async createBattleAnalysis(battleId: bigint, battleData: any, killsData: any[]): Promise<BattleAnalysis | null>

// Extract guild statistics from kills
private async extractGuildStats(battleId: bigint, killsData: any[], battleData: any): Promise<GuildBattleStats[]>

// Calculate kill clustering score
private calculateKillClustering(killsData: any[]): number
```

## 🔄 Queue System

### Queue Configuration (`src/queue/mmrQueue.ts`)

Two main queues for MMR processing:

1. **MMR Calculation Queue**: Individual battle MMR calculations
2. **MMR Batch Queue**: Bulk processing of multiple battles

#### Queue Features

- **Retry Logic**: Exponential backoff with configurable attempts
- **Priority Jobs**: High-priority jobs for important battles
- **Job Tracking**: Database tracking of job status and attempts
- **Fallback Mechanism**: Symbolic MMR changes on final failure
- **Concurrency Control**: Configurable worker concurrency

#### Job Types

```typescript
// Individual battle MMR calculation
CALCULATE_BATTLE_MMR: 'calculate-battle-mmr'

// Batch MMR processing
BATCH_MMR_UPDATE: 'batch-mmr-update'

// Retry failed jobs
RETRY_FAILED_MMR: 'retry-failed-mmr'
```

### Worker Configuration

```typescript
// MMR Calculation Worker
concurrency: 5 // Process 5 jobs concurrently
attempts: 3    // Retry up to 3 times
backoff: exponential // Exponential backoff

// MMR Batch Worker
concurrency: 2 // Process 2 batch jobs concurrently
attempts: 2    // Retry up to 2 times
backoff: exponential // Exponential backoff
```

## 🧮 MMR Algorithm

### Calculation Formula

The MMR algorithm uses a weighted combination of multiple factors:

```typescript
const MMR_CONSTANTS = {
  BASE_MMR: 1000.0,
  K_FACTOR: 32, // Maximum MMR change per battle
  WIN_LOSS_WEIGHT: 0.4,      // 40% weight for win/loss
  FAME_WEIGHT: 0.2,          // 20% weight for fame differential
  PLAYER_COUNT_WEIGHT: 0.1,  // 10% weight for player count advantage
  IP_WEIGHT: 0.1,            // 10% weight for IP level differences
  BATTLE_SIZE_WEIGHT: 0.05,  // 5% weight for battle size
  KD_RATIO_WEIGHT: 0.05,     // 5% weight for kill/death ratio
  BATTLE_DURATION_WEIGHT: 0.05, // 5% weight for battle duration
  KILL_CLUSTERING_WEIGHT: 0.05, // 5% weight for kill clustering
  OPPONENT_MMR_WEIGHT: 0.1,  // 10% weight for opponent MMR strength
  SEASON_CARRYOVER_RATIO: 0.3, // 30% of previous season MMR carries over
}
```

### Factor Calculations

#### Win/Loss Factor
- **Winner**: Guild with >30% of total kills
- **Loser**: Guild with deaths > 2x kills
- **Neutral**: All other cases

#### Fame Factor
- Based on fame gained vs lost ratio
- Normalized to -1 to 1 range

#### Player Count Factor
- **Advantage**: >1.5x average players (-0.5 factor)
- **Disadvantage**: <0.7x average players (+0.5 factor)
- **Fair**: Between 0.7x and 1.5x (0 factor)

#### Kill Clustering
- **Rapid Kills**: Kills within 30 seconds
- **Coordinated Attacks**: Multiple guilds killing in sequence
- **High-Value Kills**: Clusters of 100K+ fame kills
- **Kill Streaks**: Consecutive kills by same guild

### Battle Criteria

MMR is only calculated for battles meeting these criteria:
- **Minimum Players**: 25+ total players
- **Minimum Fame**: 2,000,000+ total fame

## 📅 Season Management

### Season Lifecycle

1. **Creation**: Manual season creation with start date
2. **Activation**: Set as active season (deactivates others)
3. **Operation**: MMR calculations during season
4. **Ending**: Set end date and process carryover
5. **Transition**: Initialize next season with carryover MMR

### MMR Carryover

When a season ends:
1. **Calculate Carryover**: 30% of final MMR (minimum 1000)
2. **Store Data**: Save carryover and final MMR values
3. **Initialize Next**: Create new season records with carryover MMR

### Prime Time Windows

Prime time windows define specific hours for mass tracking and are **global** (same for all seasons):
- **Same Day**: 20:00-22:00 (20:00 to 22:00)
- **Overnight**: 22:00-02:00 (22:00 to 02:00 next day)
- **Multiple Windows**: Can define multiple windows globally
- **Global Configuration**: Prime times apply to all seasons automatically

## ⏰ Prime Time Mass Tracking

### Per-Prime-Time Tracking

Instead of averaging across all prime times, the system tracks mass for each individual prime time window:

```
Guild A Prime Time Mass:
├── 20:00-21:00: 15.3 avg players (12 battles)
├── 21:00-22:00: 18.7 avg players (8 battles)
└── 22:00-23:00: 12.1 avg players (5 battles)
```

### Mass Calculation

- **Accurate Player Counts**: Uses battle data instead of kill events
- **Automatic Detection**: Determines which prime time window a battle falls into
- **Running Averages**: Updates averages with each new battle
- **Battle Count Tracking**: Tracks number of battles per prime time

### Data Structure

```typescript
interface GuildPrimeTimeMass {
  id: string;
  guildSeasonId: string;
  primeTimeWindowId: string;
  avgMass: number;        // Average players during this prime time
  battleCount: number;    // Number of battles in this prime time
  lastBattleAt: Date;     // Last battle in this prime time
}
```

## 🚀 Quick Start

### 1. Database Setup

```bash
# Run database migrations
npx prisma migrate dev --name add-mmr-system

# Generate Prisma client
npx prisma generate
```

### 2. Create Initial Season

```bash
# Create first season
yarn manage-mmr create-season "Season 1" 2024-01-01

# Add global prime time windows
yarn manage-mmr add-prime-time 20 22
yarn manage-mmr add-prime-time 21 23

# Activate season
yarn manage-mmr activate-season <seasonId>
```

### 3. Start MMR Workers

```bash
# Start MMR processing workers
yarn mmr-worker
```

### 4. Process Historical Data

```bash
# Process historical battles for current season
yarn manage-mmr process-historical 2024-01-01 2024-12-31
```

### 5. Monitor System

```bash
# Check system health
yarn manage-mmr health-check

# Get MMR statistics
yarn manage-mmr get-stats

# View top guilds
yarn manage-mmr top-guilds 100
```

## 🖥️ CLI Commands

### Season Management

```bash
# Create a new season
yarn manage-mmr create-season <name> <startDate> [endDate]

# List all seasons
yarn manage-mmr list-seasons

# Activate a season
yarn manage-mmr activate-season <seasonId>

# End a season
yarn manage-mmr end-season <seasonId> <endDate>

# Process season end and MMR carryover
yarn manage-mmr process-season-end <seasonId>

# Initialize new season with carryover
yarn manage-mmr initialize-season-with-carryover <newSeasonId> <previousSeasonId>
```

### Prime Time Management

```bash
# Add global prime time window
yarn manage-mmr add-prime-time <startHour> <endHour>

# List global prime time windows
yarn manage-mmr list-prime-times

# Remove global prime time window
yarn manage-mmr remove-prime-time <windowId>
```

### MMR Operations

```bash
# Process historical battles
yarn manage-mmr process-historical <startDate> <endDate> [batchSize]

# Get MMR processing statistics
yarn manage-mmr get-stats

# Check system health
yarn manage-mmr health-check

# Get top guilds by MMR
yarn manage-mmr top-guilds [limit] [seasonId]

# Get guild MMR
yarn manage-mmr guild-mmr <guildName> [seasonId]

# Get prime time mass data for a guild
yarn manage-mmr guild-prime-time-mass <guildId> <seasonId>
```

## 🔗 Integration Points

### Kills Worker Integration

The MMR system integrates with the existing kills worker:

```typescript
// In src/workers/killsFetcher/worker.ts
// After successfully fetching kills:

// Process battle for MMR calculation
try {
  await processBattleForMmr(albionId, killEvents);
} catch (error) {
  console.error(`⚠️ MMR processing failed for battle ${albionId}:`, error);
  // Don't throw - MMR processing failure shouldn't fail the kills job
}
```

### Automatic MMR Processing

1. **Battle Crawled**: Battle data saved to database
2. **Kills Fetched**: Kill events processed and saved
3. **MMR Triggered**: MMR calculation job added to queue
4. **MMR Processed**: Worker processes MMR calculation
5. **Results Saved**: MMR changes saved to database

### Queue Integration

```typescript
// Add MMR calculation job
await addMmrCalculationJob(battleAnalysis, priority);

// Add batch MMR job
await addBatchMmrJob(battleIds, seasonId, priority);

// Start workers
await startMmrWorkers();

// Stop workers
await stopMmrWorkers();
```

## 📊 Monitoring & Health

### Health Checks

```bash
# Check system health
yarn manage-mmr health-check
```

Health checks verify:
- Database connectivity
- Redis connectivity
- Queue worker status
- Season configuration
- Prime time window setup

### Queue Statistics

```typescript
// Get queue statistics
const stats = await getMmrQueueStats();
console.log('Queue Stats:', stats);
```

Statistics include:
- **Pending Jobs**: Jobs waiting to be processed
- **Active Jobs**: Currently processing jobs
- **Completed Jobs**: Successfully processed jobs
- **Failed Jobs**: Jobs that failed processing
- **Delayed Jobs**: Jobs scheduled for future processing

### Logging

The system uses structured logging with component identification:

```typescript
const logger = log.child({ component: 'mmr-service' });

logger.info('MMR calculation completed', {
  battleId: battleId.toString(),
  guildCount: guildStats.length,
  mmrChanges: Object.fromEntries(mmrChanges)
});
```

### Metrics

Key metrics to monitor:
- **MMR Calculation Rate**: Battles processed per hour
- **Queue Processing Time**: Average job processing time
- **Error Rate**: Failed MMR calculations
- **Guild Participation**: Number of unique guilds per season
- **Prime Time Activity**: Mass patterns during prime times

## 🔧 Troubleshooting

### Common Issues

#### 1. MMR Jobs Not Processing

**Symptoms**: Jobs stuck in queue, no MMR updates
**Solutions**:
```bash
# Check worker status
yarn manage-mmr health-check

# Restart workers
yarn mmr-worker

# Check Redis connectivity
redis-cli ping
```

#### 2. Database Connection Issues

**Symptoms**: MMR calculations failing with database errors
**Solutions**:
```bash
# Check database connectivity
npx prisma db push

# Verify schema
npx prisma generate

# Check connection string
echo $DATABASE_URL
```

#### 3. Season Configuration Issues

**Symptoms**: MMR calculations not finding active season
**Solutions**:
```bash
# Check active season
yarn manage-mmr list-seasons

# Activate season
yarn manage-mmr activate-season <seasonId>

# Verify prime time windows
yarn manage-mmr list-prime-times <seasonId>
```

#### 4. Guild Discovery Issues

**Symptoms**: Guilds not being created or found
**Solutions**:
```bash
# Check AlbionBB API connectivity
curl "https://api-next.albionbb.com/us/guilds/search?search=TEST"

# Verify guild creation
yarn manage-mmr guild-mmr <guildName>
```

### Debug Commands

```bash
# Check queue status
yarn manage-mmr get-stats

# View recent MMR calculations
yarn manage-mmr top-guilds 10

# Check specific guild
yarn manage-mmr guild-mmr <guildName>

# Verify prime time mass
yarn manage-mmr guild-prime-time-mass <guildId> <seasonId>
```

### Log Analysis

Key log patterns to monitor:

```bash
# Successful MMR calculations
grep "Successfully processed MMR calculation" logs/

# Failed MMR calculations
grep "Error processing MMR calculation" logs/

# Queue processing
grep "MMR calculation job completed" logs/

# Season transitions
grep "Processing MMR carryover" logs/
```

## ⚡ Performance Optimization

### Queue Optimization

1. **Concurrency Tuning**:
   ```typescript
   // Adjust based on server capacity
   concurrency: 5 // MMR calculation workers
   concurrency: 2 // Batch workers
   ```

2. **Job Prioritization**:
   ```typescript
   // High priority for important battles
   await addMmrCalculationJob(battleAnalysis, 10);
   
   // Lower priority for batch jobs
   await addBatchMmrJob(battleIds, seasonId, 1);
   ```

3. **Batch Processing**:
   ```typescript
   // Process multiple battles together
   await addBatchMmrJob(battleIds, seasonId);
   ```

### Database Optimization

1. **Indexing Strategy**:
   ```sql
   -- Ensure proper indexing
   CREATE INDEX idx_guild_season_mmr ON "GuildSeason"("seasonId", "currentMmr" DESC);
   CREATE INDEX idx_prime_time_mass ON "GuildPrimeTimeMass"("guildSeasonId", "avgMass" DESC);
   ```

2. **Query Optimization**:
   - Use specific season queries
   - Limit result sets
   - Use database pagination

3. **Connection Pooling**:
   - Configure appropriate pool size
   - Monitor connection usage

### Memory Optimization

1. **Job Cleanup**:
   ```typescript
   // Configure job retention
   removeOnComplete: 100, // Keep last 100 completed jobs
   removeOnFail: 50,      // Keep last 50 failed jobs
   ```

2. **Batch Size Limits**:
   ```typescript
   // Limit batch job size
   const MAX_BATCH_SIZE = 1000;
   ```

3. **Worker Memory**:
   - Monitor worker memory usage
   - Restart workers periodically if needed

### Scaling Considerations

1. **Horizontal Scaling**:
   - Multiple MMR worker instances
   - Load balancing across workers
   - Shared Redis for job distribution

2. **Database Scaling**:
   - Read replicas for analytics
   - Connection pooling
   - Query optimization

3. **Monitoring**:
   - Queue depth monitoring
   - Processing time tracking
   - Error rate monitoring

## 🎯 Conclusion

The Albion Online MMR system provides a comprehensive solution for guild ranking and performance tracking. With sophisticated algorithms, season management, and detailed analytics, it offers valuable insights into guild performance across different time periods and battle conditions.

The system is designed for production use with proper error handling, monitoring, and scalability considerations. The queue-based architecture ensures non-blocking operation while maintaining data consistency and reliability.

For deployment instructions, see the [Railway Deployment Guide](./RAILWAY_DEPLOYMENT_GUIDE.md).
