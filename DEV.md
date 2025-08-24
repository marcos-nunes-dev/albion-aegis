# Development Guide

This guide explains how to set up and use the development environment with Redis.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 20+ installed
- Database connection (Supabase/PostgreSQL)

## Development Options

### Option 1: Full Docker Development (Recommended)

Run everything in Docker containers with hot reloading:

```bash
# Start the full development environment
npm run dev:scheduler    # Start scheduler with Redis
npm run dev:kills        # Start kills worker with Redis
npm run dev:crawl        # Run single crawl test

# Stop everything
npm run dev:down
```

### Option 2: Local Development with Docker Redis

Run Redis in Docker, but run the application locally:

```bash
# Start Redis only
npm run redis:up

# Run applications locally (in separate terminals)
npm run start:scheduler  # Terminal 1
npm run start:kills      # Terminal 2
npm run crawl:once       # Terminal 3 (for testing)

# Stop Redis
npm run redis:down
```

## Environment Setup

1. **Quick Setup (Recommended):**
   ```bash
   npm run dev:setup
   ```
   This automatically sets the correct environment variables for local development.

2. **Manual Setup:**
   ```bash
   # Set environment variables for local development
   $env:REDIS_URL="redis://localhost:6379"
   $env:NODE_ENV="development"
   ```

3. **Database Configuration:**
   Make sure your `DATABASE_URL` is configured in your environment or .env file.

## Development Workflow

### Testing with Redis

1. **Setup development environment:**
   ```bash
   npm run dev:setup
   ```

2. **Start Redis (if not already running):**
   ```bash
   npm run redis:up
   ```

3. **Test single crawl:**
   ```bash
   npm run crawl:once
   ```

4. **Start scheduler (continuous crawling):**
   ```bash
   npm run start:scheduler
   ```

5. **Start kills worker (process kill jobs):**
   ```bash
   npm run start:kills
   ```

### Monitoring

- **Redis logs:**
  ```bash
  npm run redis:logs
  ```

- **Check Redis status:**
  ```bash
  docker exec albion-redis-local redis-cli ping
  ```

- **View Redis data:**
  ```bash
  docker exec albion-redis-local redis-cli
  ```

## Troubleshooting

### Redis Connection Issues

If you see Redis connection errors:

1. **Check if Redis is running:**
   ```bash
   docker ps | grep redis
   ```

2. **Restart Redis:**
   ```bash
   npm run redis:down
   npm run redis:up
   ```

3. **Check Redis logs:**
   ```bash
   npm run redis:logs
   ```

### Database Connection Issues

1. **Verify DATABASE_URL in .env**
2. **Test connection:**
   ```bash
   npm run crawl:once
   ```

### Port Conflicts

If port 6379 is already in use:

1. **Find what's using the port:**
   ```bash
   netstat -tulpn | grep 6379
   ```

2. **Stop conflicting service or change Redis port in docker-compose.redis-only.yml**

## Development Tips

### Hot Reloading

When using the full Docker development environment:
- Code changes are automatically detected
- Services restart automatically
- No need to rebuild containers

### Database Migrations

Run migrations before starting development:

```bash
npm run prisma:migrate
```

### Testing Different Configurations

You can override environment variables:

```bash
# Test with different crawl interval
CRAWL_INTERVAL_SEC=10 npm run start:scheduler

# Test with different rate limits
RATE_MAX_RPS=2 npm run start:scheduler
```

### Clean Development Environment

To start fresh:

```bash
# Stop all services
npm run dev:down
npm run redis:down

# Remove volumes (clears Redis data)
docker volume rm albion-aegis_redis-data

# Start again
npm run redis:up
npm run start:scheduler
```
