import { router, publicProc } from "../trpc";
import { prisma } from "../db";
import { apiCache, CACHE_TTL } from "../cache";

export const statisticsRouter = router({
  getOverview: publicProc
    .query(async () => {
      try {
        return await apiCache.getOrSet(
          'statistics',
          ['overview'],
          async () => {
            // Get all three statistics in parallel for better performance
            const [guildCount, battleCount, mmrProcessedCount] = await Promise.all([
              // Count of guilds in the guilds table
              prisma.guild.count(),
              
              // Count of battles tracked
              prisma.battle.count(),
              
              // Count of MMR processed fights (from mmr_calculation_logs table)
              prisma.mmrCalculationLog.count()
            ]);

            return {
              guildCount,
              battleCount,
              mmrProcessedCount
            };
          },
          { ttl: CACHE_TTL.STATISTICS }
        );
      } catch (error) {
        console.error('Error fetching statistics:', error);
        throw new Error('Failed to fetch statistics');
      }
    })
});
