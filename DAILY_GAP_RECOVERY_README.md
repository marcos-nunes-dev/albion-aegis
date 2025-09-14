# Daily Battle Gap Recovery Service

This service runs daily at 7 AM Brazilian time (UTC-3, so 10 AM UTC) to recover battles that might have been missed during high-traffic periods.

## Features

- **Daily Execution**: Runs automatically every day at 7 AM Brazilian time
- **24-Hour Lookback**: Checks the last 24 hours of battles from Albion API
- **Batch Processing**: Checks 20 battles at a time for efficiency
- **Robust Recovery**: Uses existing battle gap recovery logic
- **Detailed Logging**: Comprehensive logging for monitoring and debugging

## How It Works

1. **Scheduled Execution**: Railway cron scheduler triggers the service daily at 10 AM UTC (7 AM Brazilian time)
2. **API Fetching**: Fetches recent battles from Albion API using existing HTTP client with rate limiting
3. **Database Comparison**: Batch checks 20 battles at a time against your database
4. **Gap Recovery**: Recovers any missing battles using the proven `BattleGapRecoveryService`
5. **Resource Cleanup**: Properly closes database connections and cleans up resources

## Railway Deployment

### 1. Create New Service in Railway

1. Go to your Railway project dashboard
2. Click "New Service" → "GitHub Repo"
3. Select your `albion-aegis` repository
4. Choose "Deploy from Dockerfile"

### 2. Configure Service Settings

1. **Service Name**: `daily-gap-recovery`
2. **Dockerfile Path**: `Dockerfile.daily-gap-recovery`
3. **Build Command**: (leave empty, uses Dockerfile)
4. **Start Command**: (leave empty, uses Dockerfile CMD)

### 3. Set Environment Variables

Copy all environment variables from your main service:
- `DATABASE_URL`
- `REDIS_URL`
- `API_BASE_URL`
- `USER_AGENT`
- All other configuration variables

### 4. Configure Cron Schedule

1. In Railway service settings, go to "Cron"
2. Set **Cron Schedule**: `0 10 * * *`
3. Set **Timezone**: `UTC`
4. Enable the cron job

### 5. Deploy

1. Click "Deploy" to build and deploy the service
2. Monitor the deployment logs to ensure successful build
3. Check the cron job is scheduled correctly

## Monitoring

### Logs

The service provides detailed logging:
- Start/completion times with Brazilian timezone
- Number of battles recovered
- Error handling and recovery
- Performance metrics (duration)

### Railway Dashboard

- Monitor service health in Railway dashboard
- Check cron job execution history
- View logs for each execution

## Configuration

The service uses the same configuration as your main service:
- `GAP_RECOVERY_PAGES_TO_CHECK`: Number of API pages to check (default: 20)
- `RATE_MAX_RPS`: API rate limiting (default: 8)
- All other existing configuration variables

## Troubleshooting

### Common Issues

1. **Service Not Running**: Check cron schedule and timezone settings
2. **Database Connection Errors**: Verify `DATABASE_URL` environment variable
3. **API Rate Limiting**: Service includes built-in rate limiting and retry logic
4. **Build Failures**: Check Dockerfile and build logs

### Manual Testing

You can test the service manually:
```bash
# Local testing
yarn start:daily-gap-recovery

# Or with tsx directly
tsx apps/daily-gap-recovery.ts
```

## Cost Considerations

- **Railway Cron**: Railway cron services are cost-efficient for scheduled tasks
- **Resource Usage**: Service runs once daily, minimal resource consumption
- **Database Queries**: Optimized batch processing minimizes database load

## Security

- **Non-root User**: Dockerfile runs as non-root user for security
- **Environment Variables**: All sensitive data stored in Railway environment variables
- **Resource Cleanup**: Proper cleanup prevents resource leaks

## Maintenance

- **Automatic Updates**: Service will automatically update when you push changes to the repository
- **Log Rotation**: Railway handles log rotation automatically
- **Health Monitoring**: Monitor service health through Railway dashboard
