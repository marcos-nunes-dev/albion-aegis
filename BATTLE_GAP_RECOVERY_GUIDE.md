# 🕳️ Battle Gap Recovery System

A sophisticated system to detect and recover battles that were missed due to AlbionBB API processing delays.

## 🎯 Problem Statement

The AlbionBB API processes battles asynchronously, which can lead to battles appearing out of chronological order. This creates gaps in battle data where battles that were processed later by the API are missed by the standard watermark-based crawling system.

### Example Scenario:
```
First Run:
- Battle 4 (watermark set here)
- Battle 2  
- Battle 1

Next Run:
- Battle 6 (watermark advances here)
- Battle 5
- Battle 4
- Battle 3 ← MISSED! (was behind Battle 4 watermark)
- Battle 2
- Battle 1
```

## 🏗️ Solution Architecture

The Battle Gap Recovery System uses a multi-layered approach:

### 1. **Gap Detection**
- Analyzes battle timestamps in the database
- Identifies gaps larger than a configurable threshold (default: 30 minutes)
- Calculates estimated missing battles based on average battle frequency

### 2. **Intelligent Recovery**
- Searches AlbionBB API in identified gap periods
- Cross-references with existing database records
- Recovers only truly missing battles
- Enqueues kill fetching and notification jobs for recovered battles

### 3. **Performance Optimization**
- Configurable lookback period (default: 6 hours)
- Smart page limiting to avoid excessive API calls
- Early termination when gaps are fully searched
- Integrated with existing queue system

## ⚙️ Configuration

Add these environment variables to configure the gap recovery system:

```bash
# Gap Recovery Configuration
GAP_RECOVERY_LOOKBACK_HOURS=6        # How far back to look for gaps
GAP_RECOVERY_MAX_GAP_MINUTES=30      # Minimum gap size to trigger recovery
GAP_RECOVERY_INTERVAL_CRAWLS=10      # Run recovery every N crawls
```

### Configuration Details:

| Setting | Default | Description |
|---------|---------|-------------|
| `GAP_RECOVERY_LOOKBACK_HOURS` | 6 | Hours to look back for gaps |
| `GAP_RECOVERY_MAX_GAP_MINUTES` | 30 | Minimum gap size (minutes) to trigger recovery |
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
    - GAP_RECOVERY_LOOKBACK_HOURS=6
    - GAP_RECOVERY_MAX_GAP_MINUTES=30
  depends_on:
    - redis
    - postgres
```

## 📊 Monitoring & Logging

The system provides comprehensive logging:

### Gap Detection Logs
```
INFO: Detecting battle gaps
  startTime: "2024-01-15T10:00:00.000Z"
  endTime: "2024-01-15T16:00:00.000Z"
  maxGapMinutes: 30

INFO: Battle gap detected
  gapStart: "2024-01-15T12:30:00.000Z"
  gapEnd: "2024-01-15T13:15:00.000Z"
  gapMinutes: 45
  estimatedMissingBattles: 3
```

### Recovery Logs
```
INFO: Recovering battles in gap
  gapStart: "2024-01-15T12:30:00.000Z"
  gapEnd: "2024-01-15T13:15:00.000Z"
  estimatedMissingBattles: 3

INFO: Recovered missing battle
  albionId: "123456789"
  startedAt: "2024-01-15T12:45:00.000Z"
  gapStart: "2024-01-15T12:30:00.000Z"
  gapEnd: "2024-01-15T13:15:00.000Z"

INFO: Gap recovery completed
  gapStart: "2024-01-15T12:30:00.000Z"
  gapEnd: "2024-01-15T13:15:00.000Z"
  battlesRecovered: 2
```

## 🔧 Technical Implementation

### Core Components

1. **BattleGapRecoveryService** (`src/services/battleGapRecovery.ts`)
   - Main service for gap detection and recovery
   - Integrates with existing battle crawling logic
   - Handles database operations and API calls

2. **Enhanced Scheduler** (`src/scheduler/crawlLoop.ts`)
   - Automatically runs gap recovery at configurable intervals
   - Integrated with existing crawl loop
   - Graceful error handling

3. **Configuration** (`src/lib/config.ts`)
   - Configurable parameters for fine-tuning
   - Environment variable support
   - Type-safe configuration

### Database Integration
- Uses existing Prisma models
- No additional database schema required
- Leverages existing battle and kill event tables

### Queue Integration
- Enqueues kill fetching jobs for recovered battles
- Enqueues battle notification jobs
- Uses existing BullMQ infrastructure

## 📈 Performance Considerations

### API Rate Limiting
- Respects existing rate limiting
- Configurable page limits to avoid excessive calls
- Early termination when gaps are fully searched

### Database Performance
- Efficient queries with proper indexing
- Minimal database impact
- Reuses existing connection pooling

### Memory Usage
- Streaming processing for large datasets
- Configurable batch sizes
- Automatic cleanup of temporary data

## 🛠️ Troubleshooting

### Common Issues

1. **No gaps detected**
   - Check `GAP_RECOVERY_MAX_GAP_MINUTES` setting
   - Verify battle data exists in the time range
   - Check logs for gap detection details

2. **Recovery not finding battles**
   - Verify AlbionBB API connectivity
   - Check rate limiting status
   - Review gap search parameters

3. **Performance issues**
   - Reduce `GAP_RECOVERY_LOOKBACK_HOURS`
   - Increase `GAP_RECOVERY_INTERVAL_CRAWLS`
   - Monitor API rate limiting

### Debug Commands
```bash
# Check current configuration
yarn start:gap-recovery

# Monitor logs for gap detection
tail -f logs/app.log | grep "gap"

# Check battle data distribution
# (Use your database client to query battle timestamps)
```

## 🔮 Future Enhancements

### Potential Improvements
1. **Machine Learning Gap Prediction**
   - Analyze historical patterns
   - Predict likely gap locations
   - Proactive recovery

2. **Advanced Gap Analysis**
   - Battle size correlation
   - Time-of-day patterns
   - Server-specific delays

3. **Real-time Gap Detection**
   - Stream processing
   - Immediate recovery
   - Webhook notifications

4. **Performance Optimization**
   - Parallel gap processing
   - Caching strategies
   - Adaptive search algorithms

## 📚 Related Documentation

- [MMR Integration Guide](./MMR_INTEGRATION_GUIDE.md)
- [Performance Optimization Guide](./PERFORMANCE_OPTIMIZATION_GUIDE.md)
- [Database Connection Guide](./DATABASE_CONNECTION_GUIDE.md)
- [Railway Deployment Guide](./RAILWAY_DEPLOYMENT_GUIDE.md)
