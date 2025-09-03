import { router, publicProcedure } from '../trpc.js';
import { databaseService } from '../services/database.js';

export const healthRouter = router({
  /**
   * Basic health check endpoint
   */
  check: publicProcedure
    .query(async () => {
      const dbHealth = await databaseService.healthCheck();
      
      return {
        status: dbHealth ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: dbHealth ? 'connected' : 'disconnected',
      };
    }),

  /**
   * Detailed health check with system information
   */
  detailed: publicProcedure
    .query(async () => {
      const memUsage = process.memoryUsage();
      const dbHealth = await databaseService.healthCheck();
      
      return {
        status: dbHealth ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: {
          status: dbHealth ? 'connected' : 'disconnected',
          connectionStatus: databaseService.isConnectedToDatabase(),
        },
        system: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
            external: Math.round(memUsage.external / 1024 / 1024) + ' MB',
          },
        },
      };
    }),

  /**
   * Ready check for load balancers
   */
  ready: publicProcedure
    .query(async () => {
      const dbHealth = await databaseService.healthCheck();
      
      return {
        status: dbHealth ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: dbHealth ? 'healthy' : 'unhealthy',
          externalServices: 'healthy', // TODO: Add other service checks
        },
      };
    }),
});
