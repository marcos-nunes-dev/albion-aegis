# 🏆 Albion Aegis - Albion Online Battle Tracking & MMR System

A comprehensive battle tracking and guild ranking system for Albion Online, featuring sophisticated MMR calculations, season management, and detailed analytics.

## 🎯 Features

### 🥇 MMR System (NEW)
- **Sophisticated MMR Algorithm**: Multi-factor calculation considering win/loss, fame, player count, IP levels, battle size, K/D ratio, duration, and kill clustering
- **Season Management**: Manual season creation with 30% MMR carryover between seasons
- **Prime Time Mass Tracking**: Per-prime-time mass analytics for detailed guild performance insights
- **Queue-Based Processing**: Asynchronous MMR calculations that don't block battle crawling
- **Guild Management**: Automatic guild discovery and AlbionBB integration

### 🗡️ Battle Tracking
- **Real-time Battle Crawling**: Automatic battle discovery and processing
- **Battle Gap Recovery**: Intelligent detection and recovery of missed battles due to API delays
- **Kill Event Processing**: Detailed kill event tracking and analysis
- **Guild Tracking**: Monitor specific guilds and send battle notifications
- **Metrics & Analytics**: Comprehensive battle statistics and reporting

### 🏗️ Architecture
- **Microservices**: Multiple Railway services for different components
- **Queue System**: Redis-based job queues with BullMQ
- **Database**: PostgreSQL with Prisma ORM
- **TypeScript**: Full type safety and modern development experience

## 🚀 Quick Start

### 1. Database Setup
```bash
# Run database migrations
npx prisma migrate dev --name add-mmr-system

# Generate Prisma client
npx prisma generate
```

### 2. Create Initial Season
```bash
# Create first season
yarn manage-mmr create-season "Season 1" 2024-01-01

# Add prime time windows
yarn manage-mmr add-prime-time <seasonId> 20 22
yarn manage-mmr add-prime-time <seasonId> 21 23

# Activate season
yarn manage-mmr activate-season <seasonId>
```

### 3. Start MMR Workers
```bash
# Start MMR processing workers
yarn mmr-worker
```

### 4. Monitor System
```bash
# Check system health
yarn manage-mmr health-check

# Get MMR statistics
yarn manage-mmr get-stats

# View top guilds
yarn manage-mmr top-guilds 100
```

## 📚 Documentation

- **[Battle Gap Recovery Guide](./BATTLE_GAP_RECOVERY_GUIDE.md)**: Intelligent battle recovery system
- **[MMR Integration Guide](./MMR_INTEGRATION_GUIDE.md)**: Complete MMR system documentation
- **[Railway Deployment Guide](./RAILWAY_DEPLOYMENT_GUIDE.md)**: Production deployment instructions
- **[Database Connection Guide](./DATABASE_CONNECTION_GUIDE.md)**: Connection pooling and database optimization
- **[Performance Optimization Guide](./PERFORMANCE_OPTIMIZATION_GUIDE.md)**: Performance optimizations and tuning
- **[API Documentation](./docs/api.md)**: API endpoints and usage

## 🏗️ System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Battle Data   │    │   Kill Events   │    │   MMR Queue     │
│   (Database)    │    │   (Database)    │    │   (Redis)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │  MMR Workers    │
                    │  (BullMQ)       │
                    └─────────────────┘
                                 │
                    ┌─────────────────┐
                    │  MMR Service    │
                    │  (Calculation)  │
                    └─────────────────┘
                                 │
                    ┌─────────────────┐
                    │  Database       │
                    │  (PostgreSQL)   │
                    └─────────────────┘
```

## 🎮 MMR Algorithm

The MMR system uses a sophisticated multi-factor algorithm:

- **Win/Loss (40%)**: Primary factor based on kill ratio
- **Fame Differential (20%)**: Fame gained vs lost
- **Player Count Advantage (10%)**: Numerical advantage/disadvantage
- **IP Level Differences (10%)**: Equipment quality differences
- **Battle Size (5%)**: Larger battles get more weight
- **K/D Ratio (5%)**: Kill/death performance
- **Battle Duration (5%)**: Quick wins get bonus
- **Kill Clustering (5%)**: Coordinated attack detection
- **Opponent MMR Strength (10%)**: Quality of opposition

### Battle Criteria
MMR is only calculated for battles with:
- **25+ total players**
- **2,000,000+ total fame**

## 📅 Season Management

### Season Lifecycle
1. **Creation**: Manual season creation with start date
2. **Activation**: Set as active season (deactivates others)
3. **Operation**: MMR calculations during season
4. **Ending**: Set end date and process carryover
5. **Transition**: Initialize next season with 30% MMR carryover

### Prime Time Windows
Define specific hours for mass tracking:
- **Same Day**: 20:00-22:00 (20:00 to 22:00)
- **Overnight**: 22:00-02:00 (22:00 to 02:00 next day)
- **Multiple Windows**: Can define multiple windows globally
- **Global Configuration**: Prime times apply to all seasons automatically

## 🖥️ CLI Commands

### Season Management
```bash
# Create a new season
yarn manage-mmr create-season <name> <startDate> [endDate]

# List all seasons
yarn manage-mmr list-seasons

# Activate a season
yarn manage-mmr activate-season <seasonId>

# End a season
yarn manage-mmr end-season <seasonId> <endDate>
```

### MMR Operations
```bash
# Process historical battles
yarn manage-mmr process-historical <startDate> <endDate> [batchSize]

# Get MMR processing statistics
yarn manage-mmr get-stats

# Get top guilds by MMR
yarn manage-mmr top-guilds [limit] [seasonId]

# Get guild MMR
yarn manage-mmr guild-mmr <guildName> [seasonId]

# Get prime time mass data
yarn manage-mmr guild-prime-time-mass <guildId> <seasonId>
```

### System Management
```bash
# Check system health
yarn manage-mmr health-check

# Add global prime time window
yarn manage-mmr add-prime-time <startHour> <endHour>

# List global prime time windows
yarn manage-mmr list-prime-times
```

## 🚀 Railway Deployment

The system is designed for Railway deployment with multiple services:

- **albion-scheduler**: Battle crawling and scheduling
- **albion-kills**: Kill event processing
- **albion-metrics**: Metrics and monitoring
- **albion-mmr**: MMR calculation and processing (NEW)
- **albion-battlenotifier**: Battle notifications

See [Railway Deployment Guide](./RAILWAY_DEPLOYMENT_GUIDE.md) for detailed deployment instructions.

## 🔧 Development

### Prerequisites
- Node.js 18+
- PostgreSQL
- Redis
- Yarn

### Setup
```bash
# Install dependencies
yarn install

# Set up environment variables
cp .env.example .env

# Run database migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Build the project
yarn build
```

### Environment Variables
```bash
# Database
DATABASE_URL="postgresql://username:password@host:port/database"

# Database Connection Pool Configuration (Optimized)
DATABASE_POOL_MIN=3
DATABASE_POOL_MAX=20
DATABASE_CONNECTION_TIMEOUT=30000
DATABASE_IDLE_TIMEOUT=60000

# Redis
REDIS_URL="redis://username:password@host:port"

# API Configuration (Optimized)
API_BASE_URL="https://gameinfo.albiononline.com/api/gameinfo"
RATE_MAX_RPS=8
CRAWL_INTERVAL_SEC=30
MAX_PAGES_PER_CRAWL=12

# Queue Management (Optimized)
REDIS_CLEANUP_INTERVAL_MIN=10
REDIS_HIGH_FREQ_CLEANUP_INTERVAL_MIN=3
REDIS_WORKER_CLEANUP_INTERVAL_MIN=8

# Logging
LOG_LEVEL="info"
NODE_ENV="development"
```

### Development Commands
```bash
# Start development server
yarn dev

# Run specific worker
yarn tsx apps/mmr-worker.ts

# Run management commands
yarn tsx apps/manage-mmr.ts <command>

# Database health check
yarn db:health

# Run tests
yarn test

# Build for production
yarn build
```

## 📊 Monitoring

### Health Checks
```bash
# Check system health
yarn manage-mmr health-check
```

### Queue Statistics
```bash
# Get queue statistics
yarn manage-mmr get-stats
```

### Log Monitoring
Monitor these log patterns:
- `"Successfully processed MMR calculation"` - Successful calculations
- `"Error processing MMR calculation"` - Failed calculations
- `"MMR calculation job completed"` - Queue processing
- `"Processing MMR carryover"` - Season transitions

## 🔧 Troubleshooting

### Common Issues

1. **MMR Jobs Not Processing**
   - Check worker status: `yarn manage-mmr health-check`
   - Restart workers: `yarn mmr-worker`
   - Check Redis connectivity

2. **Database Connection Issues**
   - Verify `DATABASE_URL` is correct
   - Run: `npx prisma db push`
   - Check: `npx prisma generate`

3. **Season Configuration Issues**
   - Check active season: `yarn manage-mmr list-seasons`
   - Create and activate season
   - Add prime time windows

4. **Guild Discovery Issues**
   - Check AlbionBB API connectivity
   - Verify guild names are exact (case-sensitive)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🎯 Roadmap

- [ ] Web dashboard for MMR visualization
- [ ] Real-time MMR updates via WebSocket
- [ ] Advanced analytics and reporting
- [ ] Guild alliance tracking
- [ ] Historical battle replay system
- [ ] Mobile app for notifications

## 📞 Support

For support and questions:
- Create an issue on GitHub
- Check the documentation
- Review troubleshooting section

---

**Albion Aegis** - Comprehensive battle tracking and guild ranking for Albion Online 🏆