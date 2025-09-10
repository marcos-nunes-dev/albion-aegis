import { router, publicProc } from "../trpc.js";
import { z } from "zod";
import { prisma } from "../db.js";
import { apiCache, CACHE_TTL } from "../cache.js";

const MmrFeedInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(50).default(20),
  seasonId: z.string().optional(),
  searchTerm: z.string().optional(), // Search by battle ID or guild name
});

export const mmrFeedRouter = router({
  // Clear cache endpoint for debugging
  clearCache: publicProc
    .query(async () => {
      try {
        await apiCache.invalidatePattern('mmrFeed:*');
        return { success: true, message: 'MMR feed cache cleared' };
      } catch (error) {
        console.error('Error clearing MMR feed cache:', error);
        throw new Error('Failed to clear cache');
      }
    }),

  getFeed: publicProc
    .input(MmrFeedInput)
    .query(async ({ input }) => {
      const { 
        page, 
        pageSize, 
        seasonId, 
        searchTerm 
      } = input;

      try {
        return await apiCache.getOrSet(
          'mmrFeed',
          ['getFeed', input],
          async () => {
            // Build where clause
            const whereClause: any = {};
            
            if (seasonId) {
              whereClause.seasonId = seasonId;
            }
            
            // Search by battle ID or guild name
            if (searchTerm) {
              const searchTermStr = searchTerm.trim();
              
              // Check if search term is numeric (battle ID)
              const isNumeric = /^\d+$/.test(searchTermStr);
              
              if (isNumeric) {
                // Search by battle ID
                whereClause.battleId = BigInt(searchTermStr);
              } else {
                // Search by guild name (case insensitive)
                whereClause.guildName = {
                  contains: searchTermStr,
                  mode: 'insensitive'
                };
              }
            }

            // Get MMR calculation logs with pagination
            const [mmrLogs, total] = await Promise.all([
              prisma.mmrCalculationLog.findMany({
                where: whereClause,
                include: {
                  guild: true,
                  season: true,
                },
                orderBy: { processedAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
              }),
              prisma.mmrCalculationLog.count({ where: whereClause })
            ]);

            // Group by battle
            const battleGroups = new Map();
            
            for (const log of mmrLogs) {
              const battleId = log.battleId.toString();
              
              if (!battleGroups.has(battleId)) {
                battleGroups.set(battleId, {
                  battleId: log.battleId.toString(), // Convert BigInt to string
                  seasonId: log.seasonId,
                  seasonName: log.season.name,
                  totalBattlePlayers: log.totalBattlePlayers,
                  totalBattleFame: log.totalBattleFame,
                  battleDuration: log.battleDuration,
                  isPrimeTime: log.isPrimeTime,
                  processedAt: log.processedAt,
                  guilds: []
                });
              }
              
              const battle = battleGroups.get(battleId);
              battle.guilds.push({
                id: log.guildId,
                name: log.guildName,
                allianceName: (log.allianceName && log.allianceName !== '{}' && log.allianceName.trim()) || null, // Ensure allianceName is valid string or null
                previousMmr: log.previousMmr,
                mmrChange: log.mmrChange,
                newMmr: log.newMmr,
                isWin: log.isWin,
                kills: log.kills,
                deaths: log.deaths,
                fameGained: log.fameGained,
                fameLost: log.fameLost,
                players: Array.isArray(log.players) ? log.players : (log.players ? [log.players] : []), // Ensure players is always an array
                avgIP: log.avgIP,
                hasSignificantParticipation: log.hasSignificantParticipation,
                antiFarmingFactor: log.antiFarmingFactor,
                originalMmrChange: log.originalMmrChange
              });
            }

            // Convert to array and sort by processedAt
            const feedData = Array.from(battleGroups.values())
              .sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime());

            return {
              data: feedData,
              page,
              pageSize,
              total,
              totalBattles: feedData.length
            };
          },
          { ttl: CACHE_TTL.MMR_FEED } // Use MMR feed specific TTL (1 minute)
        );
      } catch (error) {
        console.error('Error fetching MMR feed:', error);
        throw new Error('Failed to fetch MMR feed');
      }
    }),

});
