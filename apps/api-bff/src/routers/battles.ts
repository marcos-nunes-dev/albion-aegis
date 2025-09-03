import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { BattleService } from '../services/battleService.js';

const battleService = new BattleService();

// Input validation schemas
const battleListInput = z.object({
  page: z.number().min(0).default(0),
  limit: z.number().min(1).max(100).default(51),
  minPlayers: z.number().min(1).default(25),
  sort: z.enum(['recent', 'oldest', 'fame', 'players']).default('recent'),
});

const battleDetailInput = z.object({
  albionId: z.string().transform(val => BigInt(val)),
});

const guildSearchInput = z.object({
  name: z.string().min(1).max(64),
});

export const battlesRouter = router({
  /**
   * Get battles list with pagination and filtering
   */
  getBattles: publicProcedure
    .input(battleListInput)
    .query(async ({ input }) => {
      try {
        return await battleService.getBattles(
          input.page,
          input.limit,
          input.minPlayers,
          input.sort
        );
      } catch (error) {
        console.error('Error in getBattles:', error);
        throw new Error('Failed to fetch battles');
      }
    }),

  /**
   * Get battle details by Albion ID
   */
  getBattleDetail: publicProcedure
    .input(battleDetailInput)
    .query(async ({ input }) => {
      try {
        const battle = await battleService.getBattleDetail(input.albionId);
        if (!battle) {
          throw new Error('Battle not found');
        }
        return battle;
      } catch (error) {
        console.error('Error in getBattleDetail:', error);
        throw new Error('Failed to fetch battle details');
      }
    }),

  /**
   * Search for guilds by name
   */
  searchGuilds: publicProcedure
    .input(guildSearchInput)
    .query(async ({ input }) => {
      // TODO: Implement actual guild search from database
      return {
        guilds: [],
        searchTerm: input.name,
        total: 0,
      };
    }),

  /**
   * Get battle statistics
   */
  getBattleStats: publicProcedure
    .query(async () => {
      try {
        return await battleService.getBattleStats();
      } catch (error) {
        console.error('Error in getBattleStats:', error);
        throw new Error('Failed to fetch battle statistics');
      }
    }),
});
