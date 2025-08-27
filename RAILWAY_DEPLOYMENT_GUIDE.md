# 🚀 Railway Deployment Guide for MMR System

## Overview

This guide explains how to deploy the MMR system to Railway as a new service alongside your existing Albion Aegis services.

## Current Railway Services

Your current Railway setup includes:
- **albion-scheduler** - Battle crawler
- **albion-kills** - Kills worker
- **albion-metrics** - Metrics server

## Adding MMR Service

### Step 1: Create New Railway Service

1. Go to your Railway project dashboard
2. Click **"New Service"** → **"GitHub Repo"**
3. Select your `albion-aegis` repository
4. Name the service: **`albion-mmr`**

### Step 2: Configure Environment Variables

The MMR service will use the same environment variables as your other services:

- `DATABASE_URL` - Your PostgreSQL database
- `REDIS_URL` - Your Redis instance
- `API_BASE_URL` - Albion Online API base URL
- `NODE_ENV` - Set to `production`

### Step 3: Deploy

1. Railway will automatically detect the Dockerfile
2. The service will build and deploy
3. The startup script will automatically run the MMR workers

## Service Configuration

### Railway Service Name

The service will automatically start the MMR workers because:
- `RAILWAY_SERVICE_NAME` will be set to `albion-mmr`
- The Dockerfile startup script will detect this and run `node dist/apps/mmr-worker.js`

### Resource Allocation

For the MMR service, consider:
- **CPU**: 0.5-1.0 cores (similar to kills worker)
- **Memory**: 512MB-1GB (MMR calculations can be memory-intensive)
- **Storage**: Minimal (uses shared database)

## Database Migration

The MMR system requires new database tables. The migration will run automatically when the service starts:

```sql
-- New tables created:
- Season
- PrimeTimeWindow  
- Guild
- GuildSeason
- MmrCalculationJob
```

## Monitoring

### Railway Logs

Monitor the MMR service through Railway logs:
- Look for "🏆 Starting MMR workers..." message
- Check for any database connection errors
- Monitor queue processing logs

### Health Checks

Use the management tool to check system health:

```bash
# Connect to Railway service and run health check
railway run --service albion-mmr yarn tsx apps/manage-mmr.ts health-check
```

## Management Commands

You can run management commands through Railway:

```bash
# List seasons
railway run --service albion-mmr yarn tsx apps/manage-mmr.ts list-seasons

# Create a season
railway run --service albion-mmr yarn tsx apps/manage-mmr.ts create-season "Season 1" "2024-01-01"

# Get statistics
railway run --service albion-mmr yarn tsx apps/manage-mmr.ts get-stats

# Process historical battles
railway run --service albion-mmr yarn tsx apps/manage-mmr.ts process-historical "2024-01-01" "2024-01-31" 50
```

## Integration with Existing Services

### Automatic Integration

The MMR system integrates automatically with your existing services:

1. **albion-scheduler** → Creates battles in database
2. **albion-kills** → Fetches kills and triggers MMR processing
3. **albion-mmr** → Processes MMR calculations asynchronously

### Queue System

The MMR system uses Redis queues that are shared with your existing services:
- `mmr-calculation` - Individual battle MMR jobs
- `mmr-batch` - Batch processing jobs

## Scaling Considerations

### Horizontal Scaling

You can scale the MMR service independently:
- **Multiple instances** - Run multiple MMR workers for higher throughput
- **Resource allocation** - Adjust CPU/memory based on load

### Performance Monitoring

Monitor these metrics:
- Queue lengths (mmr-calculation, mmr-batch)
- Processing times
- Database connection usage
- Memory consumption

## Troubleshooting

### Common Issues

1. **Database Migration Fails**
   - Check `DATABASE_URL` is correct
   - Ensure database has write permissions
   - Check logs for specific migration errors

2. **Redis Connection Issues**
   - Verify `REDIS_URL` is accessible
   - Check Redis instance is running
   - Ensure network connectivity

3. **MMR Workers Not Starting**
   - Check `RAILWAY_SERVICE_NAME` is set to `albion-mmr`
   - Verify all environment variables are set
   - Check startup logs for errors

### Debug Commands

```bash
# Check service status
railway status --service albion-mmr

# View logs
railway logs --service albion-mmr

# Connect to service shell
railway shell --service albion-mmr

# Run health check
railway run --service albion-mmr yarn tsx apps/manage-mmr.ts health-check
```

## Cost Optimization

### Resource Usage

The MMR service typically uses:
- **Low CPU** - Most work is I/O bound (database/Redis)
- **Moderate Memory** - 256-512MB for most workloads
- **Minimal Storage** - No persistent storage needed

### Scaling Down

For cost optimization:
- Start with minimal resources (0.5 CPU, 256MB RAM)
- Scale up based on actual usage
- Consider running MMR processing during off-peak hours

## Security Considerations

### Environment Variables

Ensure these are properly secured:
- `DATABASE_URL` - Contains database credentials
- `REDIS_URL` - Contains Redis credentials
- `API_BASE_URL` - Albion API endpoint

### Network Access

The MMR service needs:
- **Database access** - For battle and MMR data
- **Redis access** - For queue management
- **Internet access** - For AlbionBB guild search API

## Next Steps After Deployment

1. **Create First Season**
   ```bash
   railway run --service albion-mmr yarn tsx apps/manage-mmr.ts create-season "Season 1" "2024-01-01"
   ```

2. **Activate Season**
   ```bash
   railway run --service albion-mmr yarn tsx apps/manage-mmr.ts activate-season "your-season-id"
   ```

3. **Add Prime Time Windows**
   ```bash
   railway run --service albion-mmr yarn tsx apps/manage-mmr.ts add-prime-time "your-season-id" 20 21
   ```

4. **Process Historical Data** (Optional)
   ```bash
   railway run --service albion-mmr yarn tsx apps/manage-mmr.ts process-historical "2024-01-01" "2024-01-31" 50
   ```

5. **Monitor Performance**
   ```bash
   railway run --service albion-mmr yarn tsx apps/manage-mmr.ts get-stats
   ```

## Support

If you encounter issues:
1. Check Railway logs for error messages
2. Run health checks to identify problems
3. Verify all environment variables are set correctly
4. Ensure database and Redis are accessible

The MMR system is designed to be robust and self-healing, so most issues will resolve automatically or provide clear error messages for troubleshooting.
