# Battle Duplicate Processing Fix

## Problem Description

The battle tracking system was experiencing severe duplicate processing issues, where the same battle (e.g., battle 1268978723) was being processed 50+ times, causing spam notifications and excessive API calls.

## Root Causes Identified

1. **No Database-Level Duplicate Prevention**: The `BattleResult` table lacked a unique constraint to prevent duplicate records for the same subscription and battle.

2. **No Application-Level Idempotency**: The battle notifier producer didn't check if a job already existed before enqueueing, leading to multiple jobs for the same battle.

3. **Retry Mechanism Issues**: Failed jobs were retried up to 3 times with exponential backoff, but the system didn't properly handle duplicate prevention during retries.

4. **Multiple Processing Paths**: The same battle could be processed through multiple paths (battle crawler, gap recovery, etc.) without proper deduplication.

## Solutions Implemented

### 1. Database Schema Changes

**File**: `prisma/schema.prisma`

Added a unique constraint to prevent duplicate battle results:

```prisma
model BattleResult {
  // ... existing fields ...
  
  @@unique([subscriptionId, battleAlbionId], name: "subscription_battle_unique")
}
```

This ensures that:
- One subscription can only have one battle result per battle
- Different subscriptions can still have battle results for the same battle
- Database-level protection against duplicates

### 2. Application-Level Duplicate Prevention

**File**: `src/services/tracking.ts`

Added methods to check for existing battle results:

```typescript
async hasBattleBeenProcessed(subscriptionId: string, battleId: bigint): Promise<boolean>
```

Updated `recordBattleResult` to handle duplicates gracefully:

```typescript
// Check if this battle has already been processed for this subscription
const alreadyProcessed = await this.hasBattleBeenProcessed(subscriptionId, battleId);
if (alreadyProcessed) {
  logger.info('Battle already processed for subscription, skipping');
  return;
}

// Handle database constraint violations
if (error instanceof Error && error.message.includes('subscription_battle_unique')) {
  logger.info('Battle already processed for subscription (database constraint)');
  return;
}
```

### 3. Job Queue Idempotency

**File**: `src/workers/battleNotifier/producer.ts`

Added unique job IDs to prevent duplicate job enqueueing:

```typescript
const jobId = `battle-notification-${battleId}`;

const job = await this.queue.add('process-battle-notification', {
  battleId: battleId.toString()
}, {
  jobId: jobId, // This ensures only one job per battle
  // ... other options
});
```

Added graceful handling of duplicate job errors:

```typescript
if (error instanceof Error && error.message.includes('Job already exists')) {
  logger.debug('Battle notification job already exists, skipping');
  return;
}
```

### 4. Worker-Level Duplicate Prevention

**File**: `src/workers/battleNotifier/worker.ts`

Added in-memory cache to prevent immediate reprocessing:

```typescript
private processedBattles: Set<string> = new Set();

// Check if we've already processed this battle recently
if (this.processedBattles.has(battleId)) {
  logger.info('Battle already processed recently, skipping');
  return;
}

// Add to processed cache (keep for 5 minutes)
this.processedBattles.add(battleId);
setTimeout(() => {
  this.processedBattles.delete(battleId);
}, 5 * 60 * 1000);
```

Added subscription-level duplicate check:

```typescript
const alreadyProcessed = await this.trackingService.hasBattleBeenProcessed(
  subscription.id, 
  battleDetail.albionId
);

if (alreadyProcessed) {
  logger.info('Battle already processed for subscription, skipping notification');
  return;
}
```

## Implementation Steps

### 1. Apply Database Changes

```bash
# Apply the schema changes
npx prisma db push

# Generate updated Prisma client
npx prisma generate
```

### 2. Clean Up Existing Duplicates (Optional)

Run the cleanup script to remove existing duplicate battle results:

```bash
npx tsx scripts/cleanup-duplicate-battles.ts
```

### 3. Deploy Code Changes

The following files have been updated:
- `prisma/schema.prisma` - Added unique constraint
- `src/services/tracking.ts` - Added duplicate prevention methods
- `src/workers/battleNotifier/producer.ts` - Added job idempotency
- `src/workers/battleNotifier/worker.ts` - Added processing-level duplicate prevention

### 4. Monitor the System

After deployment, monitor the logs for:
- `"Battle already processed for subscription, skipping"` - Normal duplicate prevention
- `"Battle notification job already exists, skipping"` - Job-level duplicate prevention
- `"Battle already processed recently, skipping"` - Cache-level duplicate prevention

## Expected Results

1. **No More Duplicate Notifications**: Each battle will only be processed once per subscription
2. **Reduced API Calls**: Fewer redundant calls to the Albion API
3. **Better Performance**: Reduced database load and processing overhead
4. **Cleaner Logs**: Less spam in the logs from repeated processing

## Monitoring and Verification

### Check Queue Status

```bash
npx tsx apps/check-queue.ts
```

Look for:
- No failed jobs
- No duplicate battle IDs in recent jobs
- Reasonable job completion times

### Check Database for Duplicates

```bash
npx tsx scripts/check-duplicates.ts
```

Should show no duplicate battle results.

### Monitor Logs

Watch for these log patterns:
- ✅ `"Battle notification sent successfully"` - Normal processing
- ✅ `"Battle already processed for subscription, skipping"` - Duplicate prevention working
- ❌ `"Fetching battle details for battle X"` repeated many times - Indicates ongoing issues

## Troubleshooting

### If Duplicates Still Occur

1. **Check for Multiple Workers**: Ensure only one battle notifier worker is running
2. **Check for Multiple Crawlers**: Ensure only one battle crawler is running
3. **Check Redis Connections**: Ensure proper Redis connection pooling
4. **Check Database Constraints**: Verify the unique constraint is properly applied

### If Jobs Are Failing

1. **Check API Rate Limits**: Albion API might be rate limiting requests
2. **Check Database Connections**: Ensure proper connection pooling
3. **Check Discord Webhooks**: Ensure webhook URLs are valid
4. **Check Logs**: Look for specific error messages

## Performance Impact

The duplicate prevention measures add minimal overhead:
- Database queries: ~1ms per check
- In-memory cache: ~0.1ms per check
- Job ID generation: ~0.1ms per job

The overall impact is negligible compared to the benefits of preventing duplicate processing.

## Future Improvements

1. **Redis-Based Cache**: Replace in-memory cache with Redis for multi-instance deployments
2. **Batch Processing**: Process multiple battles in a single job for better efficiency
3. **Metrics Dashboard**: Add monitoring for duplicate prevention effectiveness
4. **Alerting**: Set up alerts for when duplicate processing is detected
