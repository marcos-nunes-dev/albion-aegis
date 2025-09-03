# 🚀 Albion Aegis BFF API

A Backend for Frontend (BFF) API using tRPC for the Albion Aegis battle tracking and MMR system.

## 🎯 Features

- **tRPC Integration**: Type-safe API with automatic type inference
- **Express Server**: Fast and lightweight HTTP server
- **Comprehensive Logging**: Pino-based logging with HTTP request tracking
- **Security**: Helmet security headers and CORS configuration
- **Performance**: Compression and optimized middleware
- **Health Checks**: Built-in health monitoring endpoints

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Next.js       │    │   BFF API       │    │   Database      │
│   Frontend      │◄──►│   (tRPC)        │◄──►│   (PostgreSQL)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   External      │
                    │   Services      │
                    └─────────────────┘
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd apps/api-bff
npm install
```

### 2. Environment Setup

Create a `.env` file:

```bash
# Server Configuration
PORT=4000
NODE_ENV=development

# Logging
LOG_LEVEL=info

# CORS Origins (comma-separated)
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

### 3. Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## 📡 API Endpoints

### Health Checks

- `GET /health` - Basic health check
- `GET /trpc/health.check` - tRPC health check
- `GET /trpc/health.detailed` - Detailed system info
- `GET /trpc/health.ready` - Readiness check

### Battles

- `GET /trpc/battles.getBattles` - Get battles list with pagination
- `GET /trpc/battles.getBattleDetail` - Get battle details
- `GET /trpc/battles.searchGuilds` - Search for guilds
- `GET /trpc/battles.getBattleStats` - Get battle statistics

### MMR System

- `GET /trpc/mmr.getGuildMmr` - Get guild MMR
- `GET /trpc/mmr.getTopGuilds` - Get top guilds by MMR
- `GET /trpc/mmr.getSeason` - Get season information
- `GET /trpc/mmr.getSeasons` - Get all seasons
- `GET /trpc/mmr.getMmrStats` - Get MMR statistics

## 🔧 Development

### Project Structure

```
src/
├── routers/           # tRPC routers
│   ├── battles.ts     # Battle-related endpoints
│   ├── mmr.ts         # MMR-related endpoints
│   ├── health.ts      # Health check endpoints
│   └── index.ts       # Router aggregation
├── middleware/        # Express middleware
│   ├── cors.ts        # CORS configuration
│   └── logger.ts      # Logging middleware
├── trpc.ts           # tRPC configuration
├── trpcContext.ts    # tRPC context
└── server.ts         # Express server
```

### Adding New Endpoints

1. Create a new router in `src/routers/`
2. Add input validation using Zod schemas
3. Export the router from `src/routers/index.ts`
4. The endpoint will be automatically available at `/trpc/[routerName].[procedureName]`

### Example Router

```typescript
import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';

export const exampleRouter = router({
  getData: publicProcedure
    .input(z.object({
      id: z.string(),
    }))
    .query(async ({ input }) => {
      // Your logic here
      return { id: input.id, data: 'example' };
    }),
});
```

## 🔒 Security

- **Helmet**: Security headers and CSP configuration
- **CORS**: Configurable cross-origin resource sharing
- **Input Validation**: Zod schema validation for all inputs
- **Rate Limiting**: Built-in rate limiting (configurable)

## 📊 Monitoring

- **Health Checks**: Built-in health monitoring
- **Logging**: Structured logging with Pino
- **Error Handling**: Comprehensive error handling and logging
- **Metrics**: Request/response metrics (extensible)

## 🚀 Deployment

### Railway Deployment

The BFF can be deployed as a separate Railway service:

```bash
# Deploy to Railway
railway up

# View logs
railway logs

# Check status
railway status
```

### Environment Variables

Set these in your Railway service:

```bash
PORT=4000
NODE_ENV=production
LOG_LEVEL=info
CORS_ORIGINS=https://yourdomain.com
```

## 🔗 Integration

### Next.js Frontend

```typescript
import { createTRPCNext } from '@trpc/next';
import { AppRouter } from '@your-org/api-bff';

export const trpc = createTRPCNext<AppRouter>({
  config() {
    return {
      url: 'http://localhost:4000/trpc',
    };
  },
});
```

### Direct HTTP Calls

```bash
# Health check
curl http://localhost:4000/health

# tRPC call
curl -X POST http://localhost:4000/trpc/battles.getBattles \
  -H "Content-Type: application/json" \
  -d '{"input": {"page": 0, "limit": 10}}'
```

## 🐛 Troubleshooting

### Common Issues

1. **Port already in use**: Change `PORT` in `.env`
2. **CORS errors**: Update `CORS_ORIGINS` in `.env`
3. **Type errors**: Run `npm run typecheck`
4. **Build errors**: Run `npm run build`

### Logs

Check the console output for detailed logging information. The server logs all requests, errors, and system information.

## 🤝 Contributing

1. Follow the existing code patterns
2. Add proper input validation with Zod
3. Include error handling
4. Add logging for debugging
5. Update this README for new features

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE) file for details.
