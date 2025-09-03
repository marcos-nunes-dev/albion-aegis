import { router } from '../trpc.js';
import { battlesRouter } from './battles.js';
import { mmrRouter } from './mmr.js';
import { healthRouter } from './health.js';

/**
 * Root router - combines all routers
 */
export const appRouter = router({
  battles: battlesRouter,
  mmr: mmrRouter,
  health: healthRouter,
});

/**
 * Export type definition of API
 */
export type AppRouter = typeof appRouter;
