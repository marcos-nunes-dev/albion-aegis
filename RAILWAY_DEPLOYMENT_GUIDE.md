# 🚀 Railway Deployment Guide - Albion Online MMR System

## 📋 Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Railway Setup](#railway-setup)
4. [Service Configuration](#service-configuration)
5. [Database Migration](#database-migration)
6. [Environment Variables](#environment-variables)
7. [Deployment Steps](#deployment-steps)
8. [Service Management](#service-management)
9. [Monitoring & Health](#monitoring--health)
10. [Troubleshooting](#troubleshooting)
11. [Scaling](#scaling)

## 🎯 Overview

This guide covers deploying the complete Albion Online MMR system to Railway, including the new `albion-mmr` service for MMR processing. The system consists of multiple services that work together to provide comprehensive guild ranking and performance tracking.

### Services Overview

- **albion-scheduler**: Battle crawling and scheduling
- **albion-kills**: Kill event processing
- **albion-metrics**: Metrics and monitoring
- **albion-mmr**: MMR calculation and processing (NEW)
- **albion-battlenotifier**: Battle notifications

## ✅ Prerequisites

Before deploying, ensure you have:

1. **Railway Account**: Active Railway account with billing set up
2. **GitHub Repository**: Your Albion Aegis repository connected to Railway
3. **Database**: PostgreSQL database (Railway provides this)
4. **Redis**: Redis instance for queue management (Railway provides this)
5. **Environment Variables**: All required environment variables configured

### Required Railway Resources

- **PostgreSQL Database**: For data storage
- **Redis Instance**: For job queues
- **Multiple Services**: For different application components

## 🏗️ Railway Setup

### 1. Create New Project

1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your Albion Aegis repository
5. Railway will automatically detect the Dockerfile

### 2. Add Database

1. In your Railway project, click "New"
2. Select "Database" → "PostgreSQL"
3. Railway will create a PostgreSQL database
4. Note the connection details for environment variables

### 3. Add Redis

1. In your Railway project, click "New"
2. Select "Database" → "Redis"
3. Railway will create a Redis instance
4. Note the connection details for environment variables

## ⚙️ Service Configuration

### Service Structure

The MMR system requires multiple Railway services:

```
Railway Project
├── albion-scheduler (Main service)
├── albion-kills (Kill processing)
├── albion-metrics (Metrics server)
├── albion-mmr (MMR processing) ← NEW
├── albion-battlenotifier (Notifications)
├── PostgreSQL Database
└── Redis Instance
```

### Creating Multiple Services

1. **Clone the Repository**: Create multiple services from the same repository
2. **Service Names**: Use the exact service names for proper routing
3. **Environment Variables**: Configure each service with appropriate variables

## 🗄️ Database Migration

### 1. Initial Migration

Before starting services, run the database migration:

```bash
# Connect to your Railway PostgreSQL database
railway connect

# Run Prisma migration
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

### 2. Verify Schema

Check that all MMR tables are created:

```sql
-- Check MMR-related tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%mmr%' 
OR table_name IN ('Season', 'Guild', 'GuildSeason', 'GuildPrimeTimeMass', 'PrimeTimeWindow');
```

Expected tables:
- `Season`
- `PrimeTimeWindow`
- `Guild`
- `GuildSeason`
- `GuildPrimeTimeMass`
- `MmrCalculationJob`

## 🔧 Environment Variables

### Required Environment Variables

Configure these in each Railway service:

```bash
# Database
DATABASE_URL="postgresql://username:password@host:port/database"

# Redis
REDIS_URL="redis://username:password@host:port"

# Railway Service Name (CRITICAL for routing)
RAILWAY_SERVICE_NAME="albion-mmr"

# API Configuration
API_BASE_URL="https://gameinfo.albiononline.com/api/gameinfo"
API_RATE_LIMIT=100
API_RATE_LIMIT_WINDOW=60000

# Logging
LOG_LEVEL="info"
NODE_ENV="production"

# MMR Configuration (optional - uses defaults)
MMR_BASE_RATING=1000
MMR_K_FACTOR=32
MMR_CARRYOVER_RATIO=0.3
```

### Service-Specific Variables

#### albion-mmr Service
```bash
RAILWAY_SERVICE_NAME="albion-mmr"
LOG_LEVEL="info"
NODE_ENV="production"
```

#### albion-scheduler Service
```bash
RAILWAY_SERVICE_NAME="albion-scheduler"
LOG_LEVEL="info"
NODE_ENV="production"
```

#### albion-kills Service
```bash
RAILWAY_SERVICE_NAME="albion-kills"
LOG_LEVEL="info"
NODE_ENV="production"
```

#### albion-metrics Service
```bash
RAILWAY_SERVICE_NAME="albion-metrics"
LOG_LEVEL="info"
NODE_ENV="production"
```

## 🚀 Deployment Steps

### Step 1: Deploy Base Services

1. **Deploy albion-scheduler**:
   ```bash
   # Set environment variables
   RAILWAY_SERVICE_NAME="albion-scheduler"
   
   # Deploy
   railway up
   ```

2. **Deploy albion-kills**:
   ```bash
   # Set environment variables
   RAILWAY_SERVICE_NAME="albion-kills"
   
   # Deploy
   railway up
   ```

3. **Deploy albion-metrics**:
   ```bash
   # Set environment variables
   RAILWAY_SERVICE_NAME="albion-metrics"
   
   # Deploy
   railway up
   ```

### Step 2: Deploy MMR Service

1. **Create albion-mmr Service**:
   ```bash
   # Clone repository for MMR service
   railway service create albion-mmr
   
   # Set environment variables
   RAILWAY_SERVICE_NAME="albion-mmr"
   
   # Deploy
   railway up
   ```

2. **Verify MMR Service**:
   ```bash
   # Check service logs
   railway logs --service albion-mmr
   
   # Should see: "🏆 Starting MMR workers..."
   ```

### Step 3: Initialize MMR System

1. **Create Initial Season**:
   ```bash
   # Connect to MMR service
   railway connect --service albion-mmr
   
   # Create season
   yarn manage-mmr create-season "Season 1" 2024-01-01
   
   # Add prime time windows
   yarn manage-mmr add-prime-time <seasonId> 20 22
   yarn manage-mmr add-prime-time <seasonId> 21 23
   
   # Activate season
   yarn manage-mmr activate-season <seasonId>
   ```

2. **Verify System Health**:
   ```bash
   # Check system health
   yarn manage-mmr health-check
   
   # Should show all systems healthy
   ```

### Step 4: Process Historical Data

```bash
# Process historical battles (optional)
yarn manage-mmr process-historical 2024-01-01 2024-12-31 100
```

## 🎛️ Service Management

### Starting Services

Services will start automatically based on the `RAILWAY_SERVICE_NAME` environment variable:

```bash
# The Dockerfile automatically routes to the correct service
case "$RAILWAY_SERVICE_NAME" in
  "albion-scheduler")
    exec node dist/apps/scheduler.js
    ;;
  "albion-kills")
    exec node dist/apps/kills-worker.js
    ;;
  "albion-metrics")
    exec node dist/apps/metrics-http.js
    ;;
  "albion-mmr")
    exec node dist/apps/mmr-worker.js
    ;;
  *)
    echo "❌ Unknown service: $RAILWAY_SERVICE_NAME"
    exit 1
    ;;
esac
```

### Service Monitoring

#### Check Service Status
```bash
# List all services
railway status

# Check specific service
railway status --service albion-mmr
```

#### View Service Logs
```bash
# View MMR service logs
railway logs --service albion-mmr

# Follow logs in real-time
railway logs --service albion-mmr --follow

# View all service logs
railway logs
```

#### Service Scaling
```bash
# Scale MMR service (if needed)
railway scale --service albion-mmr --count 2

# Check current scaling
railway scale --service albion-mmr
```

## 📊 Monitoring & Health

### Health Checks

1. **System Health**:
   ```bash
   # Connect to MMR service
   railway connect --service albion-mmr
   
   # Run health check
   yarn manage-mmr health-check
   ```

2. **Queue Status**:
   ```bash
   # Check queue statistics
   yarn manage-mmr get-stats
   ```

3. **Database Health**:
   ```bash
   # Test database connection
   npx prisma db push
   ```

### Key Metrics to Monitor

1. **MMR Processing Rate**:
   - Battles processed per hour
   - Queue depth and processing time

2. **Error Rates**:
   - Failed MMR calculations
   - Database connection errors
   - Redis connectivity issues

3. **System Resources**:
   - CPU and memory usage
   - Database connection pool usage
   - Redis memory usage

### Log Monitoring

Monitor these log patterns:

```bash
# Successful MMR calculations
grep "Successfully processed MMR calculation" logs/

# Failed calculations
grep "Error processing MMR calculation" logs/

# Queue processing
grep "MMR calculation job completed" logs/

# Season transitions
grep "Processing MMR carryover" logs/
```

## 🔧 Troubleshooting

### Common Issues

#### 1. Service Not Starting

**Symptoms**: Service fails to start or shows "Unknown service"
**Solutions**:
```bash
# Check environment variable
echo $RAILWAY_SERVICE_NAME

# Verify service name is correct
railway variables --service albion-mmr

# Check Dockerfile routing
cat Dockerfile | grep -A 10 "case.*RAILWAY_SERVICE_NAME"
```

#### 2. Database Connection Issues

**Symptoms**: MMR calculations failing with database errors
**Solutions**:
```bash
# Check database URL
railway variables --service albion-mmr | grep DATABASE_URL

# Test database connection
railway connect --service albion-mmr
npx prisma db push

# Verify schema
npx prisma generate
```

#### 3. Redis Connection Issues

**Symptoms**: Queue jobs not processing
**Solutions**:
```bash
# Check Redis URL
railway variables --service albion-mmr | grep REDIS_URL

# Test Redis connection
railway connect --service albion-mmr
redis-cli -u $REDIS_URL ping

# Check queue status
yarn manage-mmr get-stats
```

#### 4. MMR Jobs Not Processing

**Symptoms**: Jobs stuck in queue, no MMR updates
**Solutions**:
```bash
# Check worker status
yarn manage-mmr health-check

# Restart MMR service
railway restart --service albion-mmr

# Check service logs
railway logs --service albion-mmr
```

#### 5. Season Configuration Issues

**Symptoms**: MMR calculations not finding active season
**Solutions**:
```bash
# Check active season
yarn manage-mmr list-seasons

# Create and activate season
yarn manage-mmr create-season "Season 1" 2024-01-01
yarn manage-mmr activate-season <seasonId>

# Add prime time windows
yarn manage-mmr add-prime-time <seasonId> 20 22
```

### Debug Commands

```bash
# Check all service statuses
railway status

# View all logs
railway logs

# Check environment variables
railway variables --service albion-mmr

# Test database connectivity
railway connect --service albion-mmr
npx prisma db push

# Check queue statistics
yarn manage-mmr get-stats

# View top guilds
yarn manage-mmr top-guilds 10
```

### Emergency Procedures

#### Service Recovery
```bash
# Restart all services
railway restart

# Restart specific service
railway restart --service albion-mmr

# Redeploy service
railway up --service albion-mmr
```

#### Database Recovery
```bash
# Reset database (CAUTION: destroys data)
railway connect --service albion-mmr
npx prisma migrate reset

# Recreate schema
npx prisma migrate deploy
npx prisma generate
```

#### Queue Recovery
```bash
# Clear stuck jobs (CAUTION: loses queued work)
railway connect --service albion-mmr
redis-cli -u $REDIS_URL FLUSHALL

# Restart MMR service
railway restart --service albion-mmr
```

## 📈 Scaling

### Horizontal Scaling

1. **Multiple MMR Workers**:
   ```bash
   # Scale MMR service
   railway scale --service albion-mmr --count 3
   ```

2. **Load Balancing**:
   - Railway automatically load balances multiple instances
   - Redis ensures job distribution across workers

3. **Database Scaling**:
   - Railway PostgreSQL supports read replicas
   - Configure connection pooling for high load

### Performance Optimization

1. **Queue Tuning**:
   ```typescript
   // Adjust concurrency based on server capacity
   concurrency: 5 // MMR calculation workers
   concurrency: 2 // Batch workers
   ```

2. **Database Optimization**:
   ```sql
   -- Ensure proper indexing
   CREATE INDEX idx_guild_season_mmr ON "GuildSeason"("seasonId", "currentMmr" DESC);
   CREATE INDEX idx_prime_time_mass ON "GuildPrimeTimeMass"("guildSeasonId", "avgMass" DESC);
   ```

3. **Memory Management**:
   ```typescript
   // Configure job retention
   removeOnComplete: 100, // Keep last 100 completed jobs
   removeOnFail: 50,      // Keep last 50 failed jobs
   ```

### Monitoring Scaling

1. **Queue Depth Monitoring**:
   - Monitor queue lengths in Railway dashboard
   - Set up alerts for high queue depth

2. **Processing Time Tracking**:
   - Monitor job processing times
   - Scale up if processing times increase

3. **Resource Usage**:
   - Monitor CPU and memory usage
   - Scale based on resource utilization

## 🎯 Conclusion

The Albion Online MMR system is now fully deployed on Railway with multiple services working together to provide comprehensive guild ranking and performance tracking. The system includes:

- **Multiple Services**: Scheduler, kills processing, metrics, and MMR processing
- **Queue-Based Architecture**: Asynchronous MMR calculations
- **Season Management**: Manual season creation with MMR carryover
- **Prime Time Tracking**: Per-prime-time mass analytics
- **Comprehensive Monitoring**: Health checks and performance metrics

The system is production-ready with proper error handling, monitoring, and scalability considerations. All services are automatically managed by Railway with proper routing based on the `RAILWAY_SERVICE_NAME` environment variable.

For detailed system documentation, see the [MMR Integration Guide](./MMR_INTEGRATION_GUIDE.md).
