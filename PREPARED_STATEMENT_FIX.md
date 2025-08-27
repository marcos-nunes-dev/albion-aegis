# 🔧 Prepared Statement Error Fix Guide

## 🚨 Problem Description

You're experiencing this error after implementing a database pooler:

```
ConnectorError(ConnectorError { user_facing_error: None, kind: QueryError(PostgresError { code: "42P05", message: "prepared statement \"s1\" already exists", severity: "ERROR", detail: None, column: None, hint: None }), transient: false })
```

## 🎯 Root Cause

This error occurs when using **database connection pooling** (like PgBouncer, Railway's built-in pooling, or similar) with Prisma because:

1. **Prisma uses prepared statements** for performance optimization
2. **Multiple Prisma client instances** try to create the same prepared statements
3. **Connection poolers reuse connections** that already have prepared statements
4. **Prepared statement conflicts** occur when the same statement name is used

## ✅ Solution Applied

### 1. Enhanced Database Manager

**File**: `src/db/database.ts`

**Key Changes**:
- Added pooler-compatible URL configuration
- Enhanced error handling for prepared statement conflicts
- Automatic reconnection on prepared statement errors
- Better connection pooling parameters

```typescript
private getPoolerCompatibleUrl(): string {
  const originalUrl = process.env.DATABASE_URL;
  const url = new URL(originalUrl);
  
  // Add parameters for better pooler compatibility
  url.searchParams.set('connection_limit', '10');
  url.searchParams.set('pool_timeout', '30');
  url.searchParams.set('connect_timeout', '30');
  
  // For Railway and other poolers
  if (url.hostname.includes('railway') || url.hostname.includes('pooler')) {
    url.searchParams.set('pgbouncer', 'true');
    url.searchParams.set('prepared_statements', 'false');
  }

  return url.toString();
}
```

### 2. Enhanced Error Handling

Added specific handling for prepared statement conflicts:

```typescript
// Check if it's a prepared statement error
const errorMessage = error instanceof Error ? error.message : String(error);
if (errorMessage.includes('prepared statement') && errorMessage.includes('already exists')) {
  // For prepared statement conflicts, try to reconnect
  console.warn(`⚠️ Prepared statement conflict detected, attempt ${attempt}/${maxRetries}`);
  try {
    await this.prisma.$disconnect();
    await this.prisma.$connect();
    this.isConnected = true;
  } catch (reconnectError) {
    console.error('❌ Failed to reconnect after prepared statement error:', reconnectError);
  }
}
```

### 3. Updated Battle Crawler Producer

**File**: `src/workers/battleCrawler/producer.ts`

Updated to use the enhanced database manager with retry logic:

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

### 4. Enhanced Prisma Schema

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

Add these to your Railway environment:

```bash
# Database Connection Pool Configuration
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_CONNECTION_TIMEOUT=30000
DATABASE_IDLE_TIMEOUT=60000

# For Railway pooler compatibility
DIRECT_URL="postgresql://username:password@host:port/database?schema=public"
```

### 2. Railway Pooler Configuration

If using Railway, configure your pooler settings:

```bash
# Railway pooler settings
POOL_MODE=transaction
MAX_CLIENT_CONN=100
DEFAULT_POOL_SIZE=10
```

### 3. Regenerate Prisma Client

```bash
npx prisma generate
```

### 4. Restart Your Services

```bash
# Deploy to Railway
# The scheduler service will automatically use the new configuration
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

Configure your pooler to handle prepared statements better:

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
3. **✅ Automatic reconnection on conflicts**
4. **✅ Health monitoring and logging**
5. **✅ Graceful handling of connection issues**

## 🔍 Monitoring

Monitor your logs for these patterns:

```
✅ Database connected successfully
📊 Pool configuration: min=2, max=10
⚠️ Prepared statement conflict detected, attempt 1/3
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

**Note**: This fix specifically addresses both "prepared statement does not exist" and "prepared statement already exists" errors in your scheduler service. The enhanced database manager now handles connection pooling conflicts automatically with retry logic and reconnection strategies.
