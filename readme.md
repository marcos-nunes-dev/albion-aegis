# Albion Aegis

A robust, production-ready ingestion service for Albion Online battle data. Continuously collects public battle data from the Albion Online community API, stores it efficiently in PostgreSQL, and provides a foundation for analytics, rankings, and research.

## 🎯 Overview

Albion Aegis is designed to be:
- **Polite**: Rate-limited API ingestion with exponential backoff and adaptive slowdown
- **Idempotent**: No duplicate data, restart-safe operations with watermark tracking
- **Scalable**: Handles millions of battle records efficiently with BullMQ job queues
- **Observable**: Comprehensive structured logging and Prometheus metrics
- **Type-Safe**: Full TypeScript with Zod validation
- **Production-Ready**: Docker containerization with health checks

## 🏗️ Architecture

### Tech Stack
- **Language**: TypeScript (Node 20+)
- **Database**: PostgreSQL (Supabase) with Prisma ORM
- **Queue**: BullMQ on Redis for job processing
- **HTTP Client**: Undici + Bottleneck (rate limiting with adaptive slowdown)
- **Validation**: Zod schemas with type inference
- **Logging**: Pino with structured logging and component-specific loggers
- **Metrics**: Prometheus client with comprehensive metrics
- **Containerization**: Docker + Docker Compose with multi-stage builds

### Core Components

#### 1. **HTTP Client** (`src/http/client.ts`)
- **Rate Limiting**: Bottleneck-based with configurable RPS (4 req/s default)
- **Adaptive Slowdown**: Tracks 429 responses and applies 120s slowdown when ratio > 5%
- **Exponential Backoff**: Automatic retry for 429/5xx errors with jitter
- **Response Validation**: Zod schemas for all API responses
- **Error Handling**: Custom error classes with proper error wrapping

**Supported Endpoints:**
- `GET /battles` - Battle list with filtering and pagination
- `GET /battles/{id}` - Detailed battle information with player statistics
- `GET /battles/kills?ids={id}` - Detailed kill events for specific battles

#### 2. **Type System** (`src/types/albion.ts`)
- **BattleListItem**: Battle summaries from `/battles`
- **BattleDetail**: Detailed battle info with player stats
- **KillEvent**: Individual kill events with equipment data
- **Type-Safe Parsing**: Zod schemas with TypeScript inference

#### 3. **Database Layer** (`prisma/schema.prisma`)
- **Battle Table**: Core battle information and metadata
- **KillEvent Table**: Detailed kill events with player and equipment data
- **ServiceState Table**: Watermark tracking for restart safety
- **Optimized Indexes**: Performance-optimized for common queries

#### 4. **Job Queue System** (`src/queue/`)
- **BullMQ Integration**: Redis-based job queue for kill event processing
- **Battle Crawl Queue**: Enqueues battle processing jobs
- **Kills Fetch Queue**: Processes kill event collection
- **Graceful Shutdown**: Proper cleanup and job handling

#### 5. **Workers** (`src/workers/`)
- **Battle Crawler**: Fetches battles, upserts to database, enqueues kill jobs
- **Kills Fetcher**: Processes kill jobs, fetches and stores kill events
- **Sliding Window**: Uses soft cutoff to avoid missing late-listed battles
- **Watermark Management**: Tracks ingestion progress with clamping

#### 6. **Scheduler** (`src/scheduler/`)
- **Crawl Loop**: Periodic battle crawling with configurable intervals
- **Rate Limit Integration**: Uses adaptive slowdown from HTTP client
- **Error Recovery**: Continues operation despite individual failures
- **Graceful Shutdown**: Proper cleanup on termination

#### 7. **Logging & Metrics** (`src/log.ts`, `src/metrics.ts`)
- **Structured Logging**: Pino with component-specific loggers
- **Prometheus Metrics**: Request counts, error rates, entity upserts
- **HTTP Server**: Metrics endpoint on `/metrics` and health check on `/healthz`
- **Development Mode**: Pretty-printed logs, production JSON

#### 8. **Configuration** (`src/lib/config.ts`)
- **Environment Variables**: Zod-validated configuration
- **API Settings**: Base URL, rate limits, user agent
- **Database**: Connection strings and credentials
- **Scheduling**: Crawl intervals and deep sweep settings

## 📊 Data Model

### Battle Table
```sql
Battle {
  albionId: BigInt (Primary Key)
  startedAt: DateTime
  totalFame: Int
  totalKills: Int
  totalPlayers: Int
  alliancesJson: Json
  guildsJson: Json
  ingestedAt: DateTime
  killsFetchedAt: DateTime?
}
```

### KillEvent Table
```sql
KillEvent {
  EventId: BigInt (Primary Key)
  TimeStamp: DateTime
  TotalVictimKillFame: Int
  battleAlbionId: BigInt? (Foreign Key)
  
  -- Killer Information
  killerId: String
  killerName: String
  killerGuild: String?
  killerAlliance: String?
  killerAvgIP: Float
  
  -- Victim Information
  victimId: String
  victimName: String
  victimGuild: String?
  victimAlliance: String?
  victimAvgIP: Float
  
  -- Equipment (JSON)
  killerEquipment: Json?
  victimEquipment: Json?
  
  ingestedAt: DateTime
}
```

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL database (Supabase recommended)
- Redis instance (Upstash, Redis Cloud, or self-hosted)

### Local Development

1. **Clone and Install**
```bash
git clone <repository>
cd albion-aegis
npm install
```

2. **Environment Setup**
```bash
cp .env.example .env
# Edit .env with your database, Redis, and API settings
# See the .env.example file for all required variables
```

3. **Database Setup**
```bash
# Run migrations
npx prisma migrate deploy
npx prisma generate
```

4. **Start Services**
```bash
# Option 1: Full Docker development
npm run dev:scheduler    # Start scheduler with Redis
npm run dev:kills        # Start kills worker with Redis

# Option 2: Local development with Docker Redis
npm run redis:up         # Start Redis only
npm run start:scheduler  # Terminal 1
npm run start:kills      # Terminal 2
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker compose up --build

# Or run individual services
docker compose up scheduler
docker compose up kills
docker compose up metrics
```

## 🔧 Configuration

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
REDIS_URL=rediss://:password@host:port
API_BASE_URL=https://api-next.albionbb.com/us
USER_AGENT=albion-analytics-bot/1.0 (contact: your@email.com)

# API Configuration
RATE_MAX_RPS=4
CRAWL_INTERVAL_SEC=45
MAX_PAGES_PER_CRAWL=8
SOFT_LOOKBACK_MIN=180

# Worker Configuration
KILLS_WORKER_CONCURRENCY=3
DEBOUNCE_KILLS_MIN=10
RECHECK_DONE_BATTLE_HOURS=2

# Battle Notifier Configuration
BATTLE_NOTIFIER_CONCURRENCY=2

# Deep Sweep Configuration
DEEP_SWEEP_HOURLY_PAGES=25
DEEP_SWEEP_HOURLY_LOOKBACK_H=12
DEEP_SWEEP_HOURLY_SLEEP_MS=60000
NIGHTLY_SWEEP_PAGES=50
NIGHTLY_SWEEP_LOOKBACK_H=24
NIGHTLY_SWEEP_SLEEP_MS=90000
```

## 🚀 Railway Deployment

### Quick Setup (5 minutes)

1. **Create Railway Project**
   - Go to [Railway Dashboard](https://railway.app/dashboard)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your `albion-aegis` repository

2. **Add Infrastructure Services**
   - **PostgreSQL**: "New Service" → "Database" → "PostgreSQL" (name: `albion-postgres`)
   - **Redis**: "New Service" → "Database" → "Redis" (name: `albion-redis`)

3. **Deploy Application Services**
   - **Scheduler**: "New Service" → "GitHub Repo" (name: `albion-scheduler`)
   - **Kills Worker**: "New Service" → "GitHub Repo" (name: `albion-kills`)
   - **Metrics**: "New Service" → "GitHub Repo" (name: `albion-metrics`)

4. **Configure Environment Variables**
   - Copy the environment variables from the Configuration section above
   - Add `PORT=8080` for the metrics service
   - Set start commands:
     - Scheduler: `node dist/apps/scheduler.js`
     - Kills: `node dist/apps/kills-worker.js`
     - Metrics: `node dist/apps/metrics-http.js`

### Railway Redis Authentication Fix

If you get `NOAUTH Authentication required` errors:

1. **Check Redis URL Format**
   ```
   rediss://:password@hostname:port
   ```
   - Use `rediss://` (double 's') for SSL
   - Password goes after colon, before @
   - No username needed

2. **Common Issues**
   - ❌ Wrong: `redis://hostname:port`
   - ✅ Correct: `rediss://:password@hostname:port`

3. **Verify in Railway Dashboard**
   - Go to each service → "Variables" tab
   - Check `REDIS_URL` format
   - Redeploy services after fixing

## 🎯 Guild/Alliance Tracking Feature

### Overview
The tracking feature allows users to monitor specific guilds or alliances and receive real-time Discord notifications when battles meet their custom criteria. The system tracks W/L - KD - Winrate statistics and maintains historical periods.

### Features
- **Real-time Notifications**: Discord webhook notifications when battles meet criteria
- **Custom Criteria**: Set minimum totalFame, totalKills, and totalPlayers thresholds
- **Win/Loss Tracking**: Automatic determination based on kill/death analysis
- **Counter System**: W/L - KD - Winrate tracking with historical periods
- **CLI Management**: Command-line tools for managing subscriptions
- **Scalable**: Multiple users can track the same guild without performance impact

### Quick Start

1. **Create a Discord Webhook**
   - Go to your Discord server → Server Settings → Integrations → Webhooks
   - Create a new webhook and copy the URL

2. **Add a Tracking Subscription**
   ```bash
   npm run tracking:add user123 "My Guild" GUILD https://discord.com/api/webhooks/... 1000000 50 20
   ```

3. **Start the Battle Notifier Worker**
   ```bash
   npm run start:notifier
   ```

4. **Monitor Your Subscriptions**
   ```bash
   npm run tracking:list
   ```

### CLI Commands

```bash
# Add a new tracking subscription
npm run tracking:add <userId> <entityName> <entityType> <webhookUrl> [minFame] [minKills] [minPlayers]

# List all subscriptions
npm run tracking:list

# Reset counter for a subscription
npm run tracking:reset <subscriptionId>

# Test Discord webhook
npm run tracking:test <subscriptionId>

# Delete a subscription
npm run tracking:delete <subscriptionId>
```

### Examples

```bash
# Track a guild with minimum 1M fame, 50 kills, 20 players
npm run tracking:add user123 "My Guild" GUILD https://discord.com/api/webhooks/... 1000000 50 20

# Track an alliance with minimum 500K fame, 25 kills, 15 players
npm run tracking:add user456 "My Alliance" ALLIANCE https://discord.com/api/webhooks/... 500000 25 15

# Track any battle (no minimum criteria)
npm run tracking:add user789 "Any Battle" GUILD https://discord.com/api/webhooks/... 0 0 0
```

### Discord Notification Format

When a battle meets your criteria, you'll receive a Discord embed with:
- **Title**: Battle Alert with guild/alliance name
- **Description**: WIN/LOSS result
- **Fields**: Battle stats and entity performance
- **Footer**: Current W/L - KD - Winrate statistics
- **Link**: Direct link to AlbionBB battle details

### Counter System

The system maintains running statistics:
- **W/L**: Wins and losses for the current period
- **KD**: Total kills and deaths
- **Winrate**: Percentage of wins

You can reset counters to start new periods while preserving historical data.

## 📈 Usage Examples

### Available Scripts

```bash
# Main services
npm run start:scheduler      # Start the main battle crawler scheduler
npm run start:kills          # Start the kills processing worker
npm run start:notifier       # Start the battle notification worker
npm run start:metrics        # Start the metrics HTTP server

# Deep sweep services
npm run start:sweep-hourly   # Run hourly deep sweep (12h lookback)
npm run start:sweep-nightly  # Run nightly deep sweep (24h lookback)

# Tracking management
npm run tracking:add         # Add tracking subscription
npm run tracking:list        # List all subscriptions
npm run tracking:reset       # Reset counter
npm run tracking:test        # Test webhook
npm run tracking:delete      # Delete subscription

# Development and testing
npm run crawl:once          # Run a single battle crawl and exit
npm run backfill            # Backfill historical data
npm run dev                 # Development mode with hot reload
```

### Basic API Usage
```typescript
import { getBattlesPage, getBattleDetail, getKillsForBattle } from './src/http/client.js';

// Fetch recent battles
const battles = await getBattlesPage(0, 10);
console.log(`Found ${battles.length} battles`);

// Get detailed battle information
const battleDetail = await getBattleDetail(battles[0].albionId);
console.log(`Battle has ${battleDetail.players.length} players`);

// Fetch kill events
const killEvents = await getKillsForBattle(battles[0].albionId);
console.log(`Battle has ${killEvents.length} kill events`);
```

## 🧪 Testing & Monitoring

### Health Checks
```bash
# Test health endpoint
curl http://localhost:8080/healthz

# Check metrics
curl http://localhost:8080/metrics
```

### Database Testing
```bash
# Test database connection
npx prisma studio

# Run migrations
npx prisma migrate deploy
```

### Railway Service Verification

Each Railway service has its own domain:
- **Scheduler**: `https://albion-scheduler-*.up.railway.app` (background service)
- **Kills Worker**: `https://albion-kills-*.up.railway.app` (background service)
- **Metrics**: `https://albion-metrics-*.up.railway.app` (health: `/healthz`, metrics: `/metrics`)

## 🔍 Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify `DATABASE_URL` format
   - Check if PostgreSQL service is running
   - Ensure SSL is enabled in connection string

2. **Redis Connection Errors**
   - Verify `REDIS_URL` format (use `rediss://` for SSL)
   - Check if Redis service is running
   - Ensure authentication is properly configured

3. **Service Not Starting**
   - Check environment variables
   - Verify start commands
   - Check logs for missing dependencies

4. **Rate Limiting Issues**
   - Check API response logs for 429 errors
   - Verify `RATE_MAX_RPS` setting
   - Monitor adaptive slowdown behavior

### Development Tips

```bash
# Clean development environment
npm run dev:down
npm run redis:down
docker volume rm albion-aegis_redis-data

# Test with different configurations
CRAWL_INTERVAL_SEC=10 npm run start:scheduler
RATE_MAX_RPS=2 npm run start:scheduler

# View logs
docker compose logs -f scheduler
docker compose logs -f kills
```

## 📋 Development Status

### ✅ Completed
- [x] **HTTP Client**: Rate-limited API client with exponential backoff and adaptive slowdown
- [x] **Type System**: Complete Zod schemas for all API responses
- [x] **Database Schema**: Optimized tables with proper indexes
- [x] **Configuration**: Environment validation with Zod
- [x] **Docker Setup**: Multi-stage builds with Docker Compose
- [x] **API Integration**: All three Albion API endpoints working
- [x] **Error Handling**: Robust error handling and validation
- [x] **BullMQ Integration**: Job queue for kill event processing
- [x] **Scheduler Logic**: Automated battle polling with crawl loop
- [x] **Worker Implementation**: Kill event processing workers
- [x] **Logging**: Structured logging with Pino and component-specific loggers
- [x] **Metrics**: Prometheus metrics endpoint with comprehensive tracking
- [x] **Rate Limiting**: Adaptive slowdown based on 429 response tracking
- [x] **Deep Sweep Applications**: Hourly and nightly deep scanning
- [x] **Watermark Management**: Ingestion progress tracking with clamping
- [x] **Graceful Shutdown**: Proper cleanup for all components

### 🚧 In Progress
- [ ] **Production Monitoring**: Health checks and alerting
- [ ] **Performance Optimization**: Query optimization and caching

### ✅ Completed
- [x] **Guild/Alliance Tracking**: Real-time Discord notifications for tracked entities
- [x] **Battle Notifications**: Automated Discord webhook notifications when battles meet criteria
- [x] **Counter System**: W/L - KD - Winrate tracking with historical periods
- [x] **CLI Management**: Command-line tools for managing tracking subscriptions

### 📋 Planned
- [ ] **Backfill Mode**: Historical data ingestion
- [ ] **Analytics Jobs**: Leaderboards and statistics
- [ ] **Dashboard**: Web interface for data exploration
- [ ] **Advanced Metrics**: Custom dashboards and alerting

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper TypeScript types
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- **Albion Online Community**: For providing the battle data API
- **AlbionBB**: For maintaining the API infrastructure
- **Open Source Community**: For the excellent tools and libraries used

---

**Albion Aegis** - Building the future of Albion Online analytics, one battle at a time. ⚔️