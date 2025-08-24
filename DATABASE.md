# Database Setup for Albion Aegis

This guide explains how to set up the PostgreSQL database using Supabase for the Albion Aegis service.

## Prerequisites

- Supabase account (free tier available)
- PostgreSQL database instance

## Quick Setup

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Note your database connection details

### 2. Get Database Connection String

From your Supabase dashboard:
- Go to Settings → Database
- Copy the connection string
- Format: `postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres`

### 3. Update Environment Variables

```bash
# Update your .env file
DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres?sslmode=require"
```

### 4. Run Database Migrations

```bash
# Run migrations
npm run prisma:migrate

# Or using Docker
docker run --rm --env-file .env albion-ingestor:latest npx prisma migrate deploy
```

## Database Schema

### ServiceState
Stores service configuration and state:
- `key`: Configuration key (primary key)
- `value`: Configuration value
- `updatedAt`: Last update timestamp

### Battle
Stores battle information:
- `albionId`: Albion battle ID (primary key)
- `startedAt`: Battle start time
- `totalFame`: Total fame earned
- `totalKills`: Total kills
- `totalPlayers`: Number of players
- `alliancesJson`: Alliances data (JSON)
- `guildsJson`: Guilds data (JSON)
- `ingestedAt`: When data was ingested
- `killsFetchedAt`: When kill data was fetched

### KillEvent
Stores individual kill events:
- `EventId`: Kill event ID (primary key)
- `TimeStamp`: When kill occurred
- `TotalVictimKillFame`: Fame from this kill
- `battleAlbionId`: Associated battle ID
- `killerName`: Killer's name
- `killerGuild`: Killer's guild
- `killerAlliance`: Killer's alliance
- `killerAvgIP`: Killer's average IP
- `victimName`: Victim's name
- `victimGuild`: Victim's guild
- `victimAlliance`: Victim's alliance
- `victimAvgIP`: Victim's average IP
- `killerEquip`: Killer's equipment (JSON)
- `victimEquip`: Victim's equipment (JSON)
- `ingestedAt`: When data was ingested

## Indexes

The following indexes are created for performance:
- `Battle.startedAt` - For time-based queries
- `KillEvent.TimeStamp` - For time-based queries
- `KillEvent.battleAlbionId` - For battle associations
- `KillEvent.killerAlliance` - For alliance queries
- `KillEvent.victimAlliance` - For alliance queries

## Usage

### Import Database Client

```typescript
import { prisma } from '../src/db/prisma.js';

// Example: Get all battles
const battles = await prisma.battle.findMany({
  where: {
    startedAt: {
      gte: new Date('2024-01-01')
    }
  }
});

// Example: Get kill events for a battle
const kills = await prisma.killEvent.findMany({
  where: {
    battleAlbionId: 123456789
  }
});
```

### Service State Management

```typescript
// Set a service state
await prisma.serviceState.upsert({
  where: { key: 'last_battle_id' },
  update: { value: '123456789' },
  create: { key: 'last_battle_id', value: '123456789' }
});

// Get a service state
const lastBattleId = await prisma.serviceState.findUnique({
  where: { key: 'last_battle_id' }
});
```

## Development

### Reset Database

```bash
# Reset database (WARNING: This deletes all data)
npx prisma migrate reset

# Or using Docker
docker run --rm --env-file .env albion-ingestor:latest npx prisma migrate reset
```

### View Database

```bash
# Open Prisma Studio
npx prisma studio

# Or using Docker
docker run --rm --env-file .env -p 5555:5555 albion-ingestor:latest npx prisma studio
```

### Generate Client

```bash
# Regenerate Prisma client after schema changes
npm run prisma:generate
```

## Production Considerations

1. **Connection Pooling**: Use connection pooling for production
2. **Backups**: Enable automatic backups in Supabase
3. **Monitoring**: Set up database monitoring
4. **Scaling**: Consider read replicas for heavy query loads
5. **Security**: Use row-level security (RLS) if needed

## Troubleshooting

### Connection Issues

```bash
# Test database connection
npx prisma db pull

# Check connection string format
echo $DATABASE_URL
```

### Migration Issues

```bash
# Reset migrations
npx prisma migrate reset

# Create new migration
npx prisma migrate dev --name migration_name
```

### Performance Issues

1. Check query performance with `EXPLAIN ANALYZE`
2. Ensure indexes are being used
3. Consider query optimization
4. Monitor connection pool usage
