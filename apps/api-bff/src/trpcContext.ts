import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { databaseService } from './services/database.js';
import { BattleService } from './services/battleService.js';

/**
 * Create context for tRPC requests
 */
export async function createContext({ req, res }: CreateExpressContextOptions) {
  return {
    req,
    res,
    // Database and services
    db: databaseService.getPrisma(),
    services: {
      battleService: new BattleService(),
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
