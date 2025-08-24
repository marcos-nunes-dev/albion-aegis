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
- **Request Tracking**: Monitors last 200 requests for rate limiting analysis

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

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- PostgreSQL database (Supabase recommended)
- Redis instance (Upstash, Redis Cloud, or self-hosted)

### Installation

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
```

3. **Database Setup**
```bash
# Run migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

4. **Build and Test**
```bash
npm run build
npm run start:scheduler
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

# API Configuration
API_BASE_URL=https://api-next.albionbb.com/us
USER_AGENT=albion-analytics-bot/1.0 (contact: your@email.com)
RATE_MAX_RPS=4

# Scheduling
CRAWL_INTERVAL_SEC=45
MAX_PAGES_PER_CRAWL=8
SOFT_LOOKBACK_MIN=180

# Deep Sweep Configuration
DEEP_SWEEP_HOURLY_PAGES=25
DEEP_SWEEP_HOURLY_LOOKBACK_H=12
DEEP_SWEEP_HOURLY_SLEEP_MS=60000
NIGHTLY_SWEEP_PAGES=50
NIGHTLY_SWEEP_LOOKBACK_H=24
NIGHTLY_SWEEP_SLEEP_MS=90000

# Worker Configuration
KILLS_WORKER_CONCURRENCY=3
DEBOUNCE_KILLS_MIN=10
RECHECK_DONE_BATTLE_HOURS=2
```

## 📈 Usage Examples

### Available Scripts

```bash
# Main services
npm run start:scheduler      # Start the main battle crawler scheduler
npm run start:kills          # Start the kills processing worker
npm run start:metrics        # Start the metrics HTTP server

# Deep sweep services
npm run start:sweep-hourly   # Run hourly deep sweep (12h lookback)
npm run start:sweep-nightly  # Run nightly deep sweep (24h lookback)

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

### Error Handling
```typescript
import { AlbionAPIError, RateLimitError } from './src/http/client.js';

try {
  const battles = await getBattlesPage(0, 10);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited, retry after ${error.retryAfter}ms`);
  } else if (error instanceof AlbionAPIError) {
    console.log(`API error: ${error.message}`);
  }
}
```

## 🧪 Testing

### Type Validation
```bash
npm run typecheck
```

### API Testing
```bash
# Test HTTP client with real API
npm run crawl:once
```

### Database Testing
```bash
# Test database connection
npx prisma studio
```

### Metrics Testing
```bash
# Start metrics server
npm run start:metrics

# Check metrics endpoint
curl http://localhost:8080/metrics

# Check health endpoint
curl http://localhost:8080/healthz
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

### 📋 Planned
- [ ] **Backfill Mode**: Historical data ingestion
- [ ] **Analytics Jobs**: Leaderboards and statistics
- [ ] **Discord Bot**: Real-time battle notifications
- [ ] **Dashboard**: Web interface for data exploration
- [ ] **Advanced Metrics**: Custom dashboards and alerting

## 🔍 API Coverage

The service currently supports all major Albion Online API endpoints:

1. **Battle List** (`/battles`)
   - Pagination and filtering
   - Battle summaries with alliance/guild data
   - Rate-limited and validated

2. **Battle Details** (`/battles/{id}`)
   - Player statistics and performance
   - Equipment and item power data
   - Kill/death fame tracking

3. **Kill Events** (`/battles/kills?ids={id}`)
   - Individual kill event details
   - Killer/victim information
   - Equipment and item power data
   - Timestamp and fame values

## 🚀 Deployment

### Production Deployment

1. **Environment Setup**
```bash
# Copy production environment template
cp .env.docker.example .env

# Fill in your production credentials
# - DATABASE_URL (Supabase/Neon/self-hosted PostgreSQL)
# - REDIS_URL (Upstash/Redis Cloud/self-hosted Redis)
# - API_BASE_URL and USER_AGENT
```

2. **Docker Deployment**
```bash
# Build and start all services
docker compose up --build -d

# Check service status
docker compose ps

# View logs
docker compose logs -f scheduler
docker compose logs -f kills
docker compose logs -f metrics
```

3. **Database Migration**
```bash
# Run migrations on production database
docker run --rm --env-file .env albion-ingestor:latest npx prisma migrate deploy
```

### Monitoring

- **Metrics**: `http://localhost:8080/metrics`
- **Health Check**: `http://localhost:8080/healthz`
- **Logs**: Structured JSON logs with component tracking
- **Queue Status**: BullMQ dashboard (optional)

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