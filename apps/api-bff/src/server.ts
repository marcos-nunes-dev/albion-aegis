import { createServer } from 'http';
import { seasonsRouter } from "./routers/seasons.js";
import { guildsRouter } from "./routers/guilds.js";
import { statisticsRouter } from "./routers/statistics.js";
import { mmrFeedRouter } from "./routers/mmrFeed.js";
import { createContext } from "./trpcContext";
import { router } from "./trpc.js";

// Create the main app router
const appRouter = router({
  seasons: seasonsRouter,
  guilds: guildsRouter,
  statistics: statisticsRouter,
  mmrFeed: mmrFeedRouter,
});

const PORT = Number(process.env.PORT ?? 4000);

// Create HTTP server
const server = createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS requests
    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Route handling
    if (url === '/trpc') {
      if (method !== 'POST') {
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
        
        if (!params || !params.path) {
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

        try {
          // Call the appropriate procedure
          if (routerName === 'seasons') {
            if (procedureName === 'getActive') {
              result = await caller.seasons.getActive();
            } else if (procedureName === 'list') {
              result = await caller.seasons.list(params.input);
            } else if (procedureName === 'get') {
              result = await caller.seasons.get(params.input);
            }
          } else if (routerName === 'guilds') {
            if (procedureName === 'list') {
              result = await caller.guilds.list(params.input);
            } else if (procedureName === 'get') {
              result = await caller.guilds.get(params.input);
            } else if (procedureName === 'topByMmr') {
              result = await caller.guilds.topByMmr(params.input);
            } else if (procedureName === 'topAllTime') {
              result = await caller.guilds.topAllTime(params.input);
            }
          } else if (routerName === 'statistics') {
            if (procedureName === 'getOverview') {
              result = await caller.statistics.getOverview();
            }
          } else if (routerName === 'mmrFeed') {
            if (procedureName === 'getFeed') {
              result = await caller.mmrFeed.getFeed(params.input);
            } else if (procedureName === 'getBattleDetails') {
              result = await caller.mmrFeed.getBattleDetails(params.input);
            }
          }

          if (result === undefined) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: {
                code: 'NOT_FOUND',
                message: `Procedure "${params.path}" not found`
              }
            }));
            return;
          }
        } catch (error) {
          console.error('tRPC procedure error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              code: 'INTERNAL_SERVER_ERROR',
              message: error instanceof Error ? error.message : 'Internal server error'
            }
          }, (key, value) => {
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
        }, (key, value) => {
          // Convert BigInt to string for JSON serialization
          return typeof value === 'bigint' ? value.toString() : value;
        }));

      } catch (error) {
        console.error('tRPC error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error'
          }
        }));
      }
    } else if (url === '/healthz') {
      if (method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }

  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`BFF server started on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/healthz`);
  console.log(`tRPC endpoint: http://localhost:${PORT}/trpc`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Error handling
server.on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});
