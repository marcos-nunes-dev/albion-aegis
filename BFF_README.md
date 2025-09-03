# Albion Aegis BFF (Backend for Frontend)

A tRPC-based BFF service that provides a clean API layer for your Next.js frontend to interact with the Albion Online battle data.

## 🚀 Features

- **tRPC API**: Type-safe API endpoints with automatic type inference
- **Battle Data**: Query battles with filtering, pagination, and statistics
- **Kill Events**: Access kill data with various filters and aggregations
- **Guild/Alliance Stats**: Get detailed statistics for specific entities
- **CORS Support**: Configurable CORS origins for security
- **Health Checks**: Built-in health monitoring endpoints
- **Database Integration**: Uses the same Prisma schema as other services

## 📋 API Endpoints

### Health Check
- `GET /health` - Service health status

### tRPC Endpoints
- `POST /trpc` - All tRPC procedures

### Available Procedures

#### Battle Operations
- `battle.getBattles` - Get battles with pagination and filters
- `battle.getBattle` - Get a single battle by ID
- `battle.getBattleStats` - Get battle statistics

#### Kill Operations
- `kill.getKills` - Get kills with pagination and filters
- `kill.getKillStats` - Get kill statistics and leaderboards

#### Entity Operations
- `entity.getGuildStats` - Get guild statistics
- `entity.getAllianceStats` - Get alliance statistics

## 🛠️ Development

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Redis (optional, for caching)

### Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Fill in your database and other configuration
   ```

3. **Start the BFF service**:
   ```bash
   npm run bff
   ```

4. **Access the service**:
   - BFF: http://localhost:3001
   - tRPC: http://localhost:3001/trpc
   - Health: http://localhost:3001/health

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
BFF_PORT=3001

# Optional
BFF_ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
NODE_ENV=development
```

## 🐳 Docker Deployment

### Local Docker
```bash
# Start all services including BFF
docker-compose up -d

# Start only BFF
docker-compose up bff
```

### Railway Deployment

1. **Create a new Railway service** for the BFF
2. **Connect your GitHub repository**
3. **Set environment variables**:
   - `DATABASE_URL`
   - `BFF_PORT` (Railway will set this automatically)
   - `BFF_ALLOWED_ORIGINS`
4. **Deploy** using the Railway dashboard

## 🔌 Frontend Integration

### Next.js Setup

1. **Install tRPC client**:
   ```bash
   npm install @trpc/client @trpc/react-query @trpc/next
   ```

2. **Create client configuration**:
   ```typescript
   import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
   import type { AppRouter } from 'your-bff-types';

   export const bff = createTRPCProxyClient<AppRouter>({
     links: [
       httpBatchLink({
         url: process.env.NEXT_PUBLIC_BFF_URL + '/trpc',
       }),
     ],
   });
   ```

3. **Use in components**:
   ```typescript
   // Get battles
   const battles = await bff.battle.getBattles.query({ 
     page: 1, 
     limit: 20 
   });

   // Get guild stats
   const guildStats = await bff.entity.getGuildStats.query({ 
     guildName: 'YourGuild' 
   });
   ```

## 📊 Example Queries

### Get Recent Battles
```typescript
const battles = await bff.battle.getBattles.query({
  page: 1,
  limit: 10,
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
  minTotalFame: 1000000, // Minimum 1M fame
});
```

### Get Guild Performance
```typescript
const guildStats = await bff.entity.getGuildStats.query({
  guildName: 'YourGuild',
  startDate: new Date('2024-01-01').toISOString(),
  endDate: new Date('2024-01-31').toISOString(),
});
```

### Get Kill Statistics
```typescript
const killStats = await bff.kill.getKillStats.query({
  startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // Last week
});
```

## 🔒 Security

- **CORS**: Configurable origins via `BFF_ALLOWED_ORIGINS`
- **Input Validation**: All inputs validated with Zod schemas
- **Database**: Uses parameterized queries to prevent SQL injection
- **Rate Limiting**: Consider implementing rate limiting for production

## 📈 Monitoring

- **Health Checks**: `/health` endpoint for monitoring
- **Logging**: Structured logging with Pino
- **Metrics**: Can be extended with Prometheus metrics
- **Error Handling**: Comprehensive error handling and logging

## 🚀 Production Considerations

1. **Environment Variables**: Ensure all required variables are set
2. **CORS Origins**: Restrict to only your frontend domains
3. **Database Connection**: Use connection pooling for production
4. **Logging**: Configure appropriate log levels
5. **Monitoring**: Set up health checks and alerting
6. **SSL/TLS**: Use HTTPS in production

## 🤝 Contributing

The BFF service follows the same patterns as other services in the project:
- Use the existing database connection patterns
- Follow the logging and error handling conventions
- Maintain type safety with TypeScript
- Add comprehensive input validation

## 📚 Resources

- [tRPC Documentation](https://trpc.io/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Express.js Documentation](https://expressjs.com/)
- [Railway Documentation](https://docs.railway.app/)
