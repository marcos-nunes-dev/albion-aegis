import { createServer } from 'http';
import { seasonsRouter } from "./routers/seasons.js";
import { guildsRouter } from "./routers/guilds.js";
import { statisticsRouter } from "./routers/statistics.js";
import { mmrFeedRouter } from "./routers/mmrFeed.js";
import { battlesRouter } from "./routers/battles.js";
import { createContext } from "./trpcContext.js";
import { router } from "./trpc.js";
import redis from '../../../src/queue/connection.js';

// Create the main app router
const appRouter = router({
  seasons: seasonsRouter,
  guilds: guildsRouter,
  statistics: statisticsRouter,
  mmrFeed: mmrFeedRouter,
  battles: battlesRouter,
});

const PORT = Number(process.env.PORT ?? 4000);

console.log('🚀 Starting API-BFF Server...');
console.log('📊 Environment:', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: PORT,
  RAILWAY_SERVICE_NAME: process.env.RAILWAY_SERVICE_NAME,
  DATABASE_URL: process.env.DATABASE_URL ? '[SET]' : '[NOT SET]',
  REDIS_URL: process.env.REDIS_URL ? '[SET]' : '[NOT SET]',
});

// Test Redis connection
console.log('🔗 Testing Redis connection...');
try {
  await redis.ping();
  console.log('✅ Redis connection successful');
} catch (error) {
  console.error('❌ Redis connection failed:', error);
  console.log('⚠️ Continuing without Redis (caching will be disabled)');
}

// Create HTTP server
const server = createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';
  
  console.log(`📥 ${method} ${url} - ${new Date().toISOString()}`);

  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS requests
    if (method === 'OPTIONS') {
      console.log('✅ OPTIONS request handled');
      res.writeHead(200);
      res.end();
      return;
    }

    // Route handling
    if (url === '/trpc') {
      console.log('🔧 TRPC endpoint accessed');
      if (method !== 'POST') {
        console.log('❌ TRPC: Method not allowed');
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      try {
        // Read request body
        const body = await new Promise<string>((resolve) => {
          let data = '';
          req.on('data', chunk => data += chunk);
          req.on('end', () => resolve(data));
        });

        const requestData = JSON.parse(body);
        const { params } = requestData;
        
        console.log('📋 TRPC Request:', { path: params?.path, input: params?.input });
        
        if (!params || !params.path) {
          console.log('❌ TRPC: Missing params.path');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              code: 'BAD_REQUEST',
              message: 'Missing params.path'
            }
          }));
          return;
        }

        // Create context
        const ctx = await createContext({ req, res } as any);

        // Create a caller for server-side calls
        const caller = appRouter.createCaller(ctx);

        // Parse the path to get the procedure
        const pathParts = params.path.split('.');
        if (pathParts.length !== 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              code: 'BAD_REQUEST',
              message: 'Invalid procedure path format'
            }
          }));
          return;
        }

        const [routerName, procedureName] = pathParts;
        let result: any;

        console.log(`🎯 TRPC: Calling ${routerName}.${procedureName}`);

        try {
          // Call the appropriate procedure
          if (routerName === 'seasons') {
            if (procedureName === 'getActive') {
              result = await caller.seasons.getActive();
            } else if (procedureName === 'list') {
              result = await caller.seasons.list(params.input);
            }
          } else if (routerName === 'guilds') {
            if (procedureName === 'list') {
              result = await caller.guilds.list(params.input);
            } else if (procedureName === 'topAllTime') {
              result = await caller.guilds.topAllTime(params.input);
            } else if (procedureName === 'getPrimeTimeMass') {
              result = await caller.guilds.getPrimeTimeMass(params.input);
            }
          } else if (routerName === 'statistics') {
            if (procedureName === 'getOverview') {
              result = await caller.statistics.getOverview();
            }
          } else if (routerName === 'mmrFeed') {
            if (procedureName === 'getFeed') {
              result = await caller.mmrFeed.getFeed(params.input);
            } else if (procedureName === 'clearCache') {
              result = await caller.mmrFeed.clearCache();
            }
          } else if (routerName === 'battles') {
            if (procedureName === 'headToHead') {
              result = await caller.battles.headToHead(params.input);
            } else if (procedureName === 'guildBattles') {
              result = await caller.battles.guildBattles(params.input);
            } else if (procedureName === 'getPrimeTimeBattles') {
              result = await caller.battles.getPrimeTimeBattles(params.input);
            }
          }

          if (result === undefined) {
            console.log(`❌ TRPC: Procedure "${params.path}" not found`);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: {
                code: 'NOT_FOUND',
                message: `Procedure "${params.path}" not found`
              }
            }));
            return;
          }

          console.log(`✅ TRPC: ${routerName}.${procedureName} completed successfully`);
        } catch (error) {
          console.error('❌ TRPC procedure error:', error);
          console.error('❌ TRPC error stack:', error instanceof Error ? error.stack : 'No stack trace');
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: error instanceof Error ? error.message : 'Internal server error'
            }
          }, (_key, value) => {
            // Convert BigInt to string for JSON serialization
            return typeof value === 'bigint' ? value.toString() : value;
          }));
          return;
        }

        // Return success response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          result: {
            data: result
          }
        }, (_key, value) => {
          // Convert BigInt to string for JSON serialization
          return typeof value === 'bigint' ? value.toString() : value;
        }));

      } catch (error) {
        console.error('❌ TRPC request parsing error:', error);
        console.error('❌ TRPC parsing error stack:', error instanceof Error ? error.stack : 'No stack trace');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error'
          }
        }));
      }
    } else if (url === '/healthz') {
      console.log('🏥 Health check requested');
      if (method !== 'GET') {
        console.log('❌ Health check: Method not allowed');
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      console.log('✅ Health check: OK');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        ok: true, 
        timestamp: new Date().toISOString(),
        service: 'albion-bff',
        port: PORT
      }));
    } else {
      console.log(`❌ 404: Route not found - ${method} ${url}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }

  } catch (error) {
    console.error('❌ Server error:', error);
    console.error('❌ Server error stack:', error instanceof Error ? error.stack : 'No stack trace');
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ BFF server started successfully!`);
  console.log(`🌐 Server listening on 0.0.0.0:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/healthz`);
  console.log(`🔧 tRPC endpoint: http://localhost:${PORT}/trpc`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  console.log(`🚀 Ready to accept requests!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
});

// Error handling
server.on('error', (error) => {
  console.error('❌ Server error:', error);
  console.error('❌ Server error details:', {
    code: (error as any).code,
    errno: (error as any).errno,
    syscall: (error as any).syscall,
    stack: error.stack
  });
  process.exit(1);
});

// Uncaught exception handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('❌ Uncaught Exception stack:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
