# 🕳️ Battle Gap Recovery System

A sophisticated system to detect and recover battles that were missed due to AlbionBB API processing delays.

## 🎯 Problem Statement

The AlbionBB API processes battles asynchronously, which can lead to battles appearing out of chronological order. This creates situations where battles that were processed later by the API are missed by the standard watermark-based crawling system.

### Example Scenario:
```
Fetch 1:
- Battle 12334 (most recent)
- Battle 22334
- Battle 42334

Fetch 2:
- Battle 02312 (most recent)
- Battle 12334
- Battle 22334
- Battle 31239 ← LATE ADDED! (wasn't in previous fetch)
- Battle 42334
```

## 🏗️ Solution Architecture

The Battle Gap Recovery System uses a direct API checking approach:

### 1. **API Page Scanning**
- Fetches recent battle pages from the AlbionBB API
- Checks each battle ID against the local database
- Identifies battles that exist in the API but not in the database

### 2. **Missing Battle Recovery**
- Recovers only truly missing battles (not in database)
- Fetches complete battle data from the API
- Enqueues kill fetching and notification jobs for recovered battles

### 3. **Performance Optimization**
- Configurable number of pages to check (default: 3 pages)
- Smart page limiting to avoid excessive API calls
- Integrated with existing queue system

## ⚙️ Configuration

Add these environment variables to configure the gap recovery system:

```bash
# Gap Recovery Configuration
GAP_RECOVERY_PAGES_TO_CHECK=3        # Number of API pages to check for missing battles
GAP_RECOVERY_INTERVAL_CRAWLS=10      # Run recovery every N crawls
```

### Configuration Details:

| Setting | Default | Description |
|---------|---------|-------------|
| `GAP_RECOVERY_PAGES_TO_CHECK` | 3 | Number of API pages to check for missing battles |
| `GAP_RECOVERY_INTERVAL_CRAWLS` | 10 | Run recovery every N crawls (with 30s intervals = ~5 minutes) |

## 🚀 Usage

### Automatic Integration
The gap recovery system is automatically integrated into the main scheduler:

```bash
# Start the scheduler (includes gap recovery)
yarn start:scheduler
```

Gap recovery runs automatically every 10 crawls (approximately every 5 minutes).

### Manual Execution
Run gap recovery manually for testing or immediate recovery:

```bash
# Run gap recovery once
yarn start:gap-recovery
```

### Docker Integration
Add to your docker-compose services:

```yaml
gap-recovery:
  build: .
  command: yarn start:gap-recovery
  environment:
    - DATABASE_URL=${DATABASE_URL}
    - REDIS_URL=${REDIS_URL}
    - GAP_RECOVERY_PAGES_TO_CHECK=3
  depends_on:
    - redis
    - postgres
```

## 📊 Monitoring & Logging

The system provides comprehensive logging:

### API Page Checking Logs
```
INFO: Detecting missing battles from recent API results
INFO: Checking page 1 for missing battles
INFO: Found missing battle on API
  albionId: "123456789"
  startedAt: "2024-01-15T12:45:00.000Z"
  page: 1
```

### Recovery Logs
```
INFO: Recovered missing battle
  albionId: "123456789"
  startedAt: "2024-01-15T12:45:00.000Z"
  page: 1

INFO: Missing battle detection completed
  pagesChecked: 3
  battlesRecovered: 2
```

## 🔧 Technical Implementation

### Core Components

1. **BattleGapRecoveryService** (`src/services/battleGapRecovery.ts`)
   - Main service for detecting and recovering missing battles
   - Fetches recent API pages and cross-references with database
   - Handles battle recovery and job enqueuing

2. **Configuration** (`src/lib/config.ts`)
   - `GAP_RECOVERY_PAGES_TO_CHECK`: Number of API pages to check
   - `GAP_RECOVERY_INTERVAL_CRAWLS`: How often to run recovery

3. **Integration** (`src/scheduler/crawlLoop.ts`)
   - Automatically runs gap recovery every N crawls
   - Integrated with main battle crawling system

### Key Methods

#### `detectAndRecoverMissingBattles()`
- Fetches recent battle pages from the API
- Checks each battle ID against the database
- Recovers missing battles and enqueues processing jobs

#### `recoverBattle(battle: BattleListItem)`
- Fetches complete battle data from the API
- Upserts battle to the database
- Enqueues kill fetching and notification jobs

## 🎯 How It Works

1. **Page Fetching**: The system fetches the most recent N pages from the `/battles` API endpoint
2. **Database Check**: For each battle on these pages, it checks if the battle ID exists in the local database
3. **Recovery**: If a battle exists in the API but not in the database, it's recovered
4. **Processing**: Recovered battles go through the same processing pipeline as regular battles

### Example Flow:
```
1. Fetch pages 0, 1, 2 from /battles API
2. Get battle IDs: [12334, 22334, 31239, 42334, ...]
3. Check database for each ID
4. Find missing: [31239] ← This battle was added late to API
5. Recover battle 31239 with full data
6. Enqueue kill fetching and notifications
```

## 🔍 Troubleshooting

### Common Issues

**No battles being recovered:**
- Check `GAP_RECOVERY_PAGES_TO_CHECK` setting
- Verify API connectivity and rate limits
- Check logs for API errors

**Too many API calls:**
- Reduce `GAP_RECOVERY_PAGES_TO_CHECK`
- Increase `GAP_RECOVERY_INTERVAL_CRAWLS`

**Performance issues:**
- Monitor database query performance
- Check Redis queue health
- Review battle processing pipeline

### Monitoring

The system logs detailed information about:
- Pages checked and battles found
- Missing battles detected and recovered
- API errors and recovery failures
- Processing times and performance metrics

## 🚀 Performance Considerations

- **API Rate Limiting**: Respects existing rate limiting configuration
- **Database Efficiency**: Uses efficient queries to check battle existence
- **Queue Integration**: Leverages existing queue system for processing
- **Configurable Scope**: Adjustable page count to balance coverage vs performance

This approach ensures you catch battles that were added late to the API, maintaining data completeness in your Albion Online battle tracking system!
