# Docker Setup for Albion Aegis

This guide explains how to run the Albion Aegis service using Docker and docker-compose.

## Prerequisites

- Docker and Docker Compose installed
- PostgreSQL database (Supabase, Neon, etc.)
- Redis instance (Upstash, Redis Cloud, self-hosted, etc.)

## Quick Start

### 1. Set up environment variables

```bash
# Copy the Docker environment template
cp .env.docker.example .env

# Edit .env and fill in your real credentials
# Required:
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require
REDIS_URL=rediss://:PASSWORD@YOUR-REDIS-HOST:PORT
```

### 2. Build and run with Docker Compose

```bash
# Build the image and start all services
docker compose up --build

# Or run in detached mode
docker compose up --build -d
```

### 3. Check service status

```bash
# View running containers
docker compose ps

# View logs
docker compose logs -f

# View logs for specific service
docker compose logs -f scheduler
docker compose logs -f kills
docker compose logs -f metrics
```

## Services

The docker-compose setup includes three main services:

### Scheduler
- **Purpose**: Polls the Albion API for new battles and enqueues kill fetch jobs
- **Container**: `albion-scheduler`
- **Command**: `node dist/apps/scheduler.js`

### Kills Worker
- **Purpose**: Consumes kill fetch jobs and retrieves detailed battle data
- **Container**: `albion-kills`
- **Command**: `node dist/apps/kills-worker.js`
- **Dependencies**: Requires scheduler to be running

### Metrics Server
- **Purpose**: Provides Prometheus metrics and health check endpoints
- **Container**: `albion-metrics`
- **Command**: `node dist/apps/metrics-http.js`
- **Port**: 8080 (http://localhost:8080)

## Scaling

Scale the kills worker for higher throughput:

```bash
# Run 3 kills workers
docker compose up --scale kills=3 -d

# Run 5 kills workers
docker compose up --scale kills=5 -d
```

## Database Migrations

Run Prisma migrations before starting the services:

```bash
# Run migrations using a temporary container
docker run --rm --env-file .env albion-ingestor:latest npx prisma migrate deploy
```

## Using Local Redis (Optional)

If you want to use a local Redis instance instead of external Redis:

1. Uncomment the Redis service in `docker-compose.yml`:
```yaml
redis:
  image: redis:7-alpine
  container_name: local-redis
  ports:
    - "6379:6379"
  command: ["redis-server", "--save", "", "--appendonly", "yes"]
  volumes:
    - redis-data:/data
  restart: unless-stopped
```

2. Set `REDIS_URL=redis://redis:6379` in your `.env` file

3. Uncomment the volumes section:
```yaml
volumes:
  redis-data:
```

## Health Checks

Each service includes health checks:

- **Scheduler**: Basic health check every 30s
- **Kills Worker**: Depends on scheduler
- **Metrics**: Available on port 8080

## Monitoring

Access metrics and health endpoints:

- **Metrics**: http://localhost:8080/metrics
- **Health Check**: http://localhost:8080/healthz

## Troubleshooting

### Common Issues

1. **Docker daemon not running**
   ```bash
   # Start Docker Desktop or Docker daemon
   # Then try building again
   docker build -t albion-ingestor .
   ```

2. **Environment variables not loaded**
   ```bash
   # Check if .env file exists and has correct format
   cat .env
   
   # Verify environment variables are loaded
   docker compose config
   ```

3. **Database connection issues**
   ```bash
   # Test database connection
   docker run --rm --env-file .env albion-ingestor:latest npx prisma db pull
   ```

4. **Redis connection issues**
   ```bash
   # Check Redis connectivity
   docker run --rm --env-file .env albion-ingestor:latest node -e "
   const Redis = require('ioredis');
   const redis = new Redis(process.env.REDIS_URL);
   redis.ping().then(() => console.log('Redis OK')).catch(console.error);
   "
   ```

### Logs and Debugging

```bash
# View all logs
docker compose logs

# View logs for specific service
docker compose logs scheduler
docker compose logs kills
docker compose logs metrics

# Follow logs in real-time
docker compose logs -f

# View container details
docker compose ps
docker inspect albion-scheduler
```

## Development

For development, you can run services individually:

```bash
# Run just the scheduler
docker compose up scheduler

# Run scheduler and kills worker
docker compose up scheduler kills

# Run with custom environment
docker compose run --env-file .env.dev scheduler
```

## Production Deployment

For production deployment:

1. Use proper secrets management
2. Set `NODE_ENV=production`
3. Configure proper logging
4. Set up monitoring and alerting
5. Use external Redis and PostgreSQL instances
6. Configure proper resource limits

```bash
# Production deployment example
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
