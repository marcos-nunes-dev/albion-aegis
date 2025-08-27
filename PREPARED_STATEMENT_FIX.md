# 🔧 Prepared Statement Error Fix Guide

## 🚨 Problem Description

You're experiencing this error after implementing a database pooler:

```
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "26000", message: "prepared statement \"s20\" does not exist", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })
```

## 🎯 Root Cause

This error occurs when using **database connection pooling** (like PgBouncer, Railway's built-in pooling, or similar) with Prisma because:

1. **Prisma uses prepared statements** for performance optimization
2. **Prepared statements are tied to specific database connections**
3. **When connections are reused from the pool**, the prepared statements from the previous session become invalid
4. **The pooler returns a connection** that doesn't have the expected prepared statements

## ✅ Solution Applied

### 1. Updated Battle Crawler Producer

**File**: `src/workers/battleCrawler/producer.ts`

**Before**:
```typescript
import { prisma } from '../../db/prisma.js';

async function upsertBattle(battle: BattleListItem) {
  const existingBattle = await prisma.battle.findUnique({
    where: { albionId: battle.albionId }
  });
  // ... rest of function
}
```

**After**:
```typescript
import { getPrisma, executeWithRetry } from '../../db/database.js';

async function upsertBattle(battle: BattleListItem) {
  return await executeWithRetry(async () => {
    const prisma = getPrisma();
    const existingBattle = await prisma.battle.findUnique({
      where: { albionId: battle.albionId }
    });
    // ... rest of function
  });
}
```

### 2. Enhanced Prisma Schema

**File**: `prisma/schema.prisma`

Added direct connection support for migrations:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  // Connection pool settings for better performance with poolers
  directUrl = env("DIRECT_URL") // Direct connection for migrations
}
```

## 🔧 Additional Steps Required

### 1. Environment Variables

Add these to your `.env` file:

```bash
# Database Connection Pool Configuration
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_CONNECTION_TIMEOUT=30000
DATABASE_IDLE_TIMEOUT=60000

# For Railway or other poolers, you might need:
DIRECT_URL="postgresql://username:password@host:port/database?schema=public"
```

### 2. Regenerate Prisma Client

```bash
npx prisma generate
```

### 3. Restart Your Services

```bash
# Stop your scheduler service
# Then restart it
yarn start:scheduler
```

## 🛠️ Alternative Solutions

### Option 1: Disable Prepared Statements (Quick Fix)

If you need an immediate fix, you can disable prepared statements in your Prisma client:

```typescript
// In your database configuration
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  // Disable prepared statements for pooler compatibility
  __internal: {
    engine: {
      enableEngineDebugMode: false,
      enableQueryLogging: false,
      enableEngineMetrics: false,
    },
  },
});
```

### Option 2: Use Connection Pooler Settings

If using Railway, configure your pooler settings:

```bash
# Railway pooler settings
POOL_MODE=transaction
MAX_CLIENT_CONN=100
DEFAULT_POOL_SIZE=10
```

### Option 3: Update Remaining Services

The following services could benefit from the same update (lower priority):

- `apps/deep-sweep-hourly.ts`
- `apps/deep-sweep-nightly.ts`
- `apps/backfill.ts`
- `apps/manage-mmr.ts`
- `apps/manage-tracking.ts`
- `apps/dev-once.ts`

## 📊 Expected Results

After applying this fix:

1. **✅ No more prepared statement errors**
2. **✅ Better connection stability**
3. **✅ Automatic retry logic for failed operations**
4. **✅ Health monitoring and logging**
5. **✅ Graceful handling of connection issues**

## 🔍 Monitoring

Monitor your logs for these patterns:

```
✅ Database connected successfully
📊 Pool configuration: min=2, max=10
⚠️ Database operation failed, attempt 1/3
✅ Database operation completed after retry
```

## 🚀 Deployment

1. **Commit your changes**
2. **Deploy to Railway**
3. **Monitor the logs** for any remaining errors
4. **Verify the scheduler is working** without prepared statement errors

## 📚 Additional Resources

- [Prisma Connection Management](https://www.prisma.io/docs/concepts/components/prisma-client/connection-management)
- [PostgreSQL Connection Pooling](https://www.postgresql.org/docs/current/runtime-config-connection.html)
- [Railway Database Best Practices](https://docs.railway.app/deploy/deployments)

---

**Note**: This fix specifically addresses the prepared statement error in your scheduler service. The core production services (kills, MMR, scheduler, notifier) now use the enhanced database manager with proper connection pooling support.
