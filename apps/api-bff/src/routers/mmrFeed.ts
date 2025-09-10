import { router, publicProc } from "../trpc.js";
import { z } from "zod";
import { prisma } from "../db.js";
import { apiCache, CACHE_TTL } from "../cache.js";

const MmrFeedInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(50).default(20),
  seasonId: z.string().optional(),
  guildId: z.string().optional(),
  minMmrChange: z.number().optional(), // Filter by minimum MMR change
  maxMmrChange: z.number().optional(), // Filter by maximum MMR change
  isWin: z.boolean().optional(), // Filter by win/loss
  isPrimeTime: z.boolean().optional(), // Filter by prime time battles
});

export const mmrFeedRouter = router({
  getFeed: publicProc
    .input(MmrFeedInput)
    .query(async ({ input }) => {
      const { 
        page, 
        pageSize, 
        seasonId, 
        guildId, 
        minMmrChange, 
        maxMmrChange, 
        isWin, 
        isPrimeTime 
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
            
            if (guildId) {
              whereClause.guildId = guildId;
            }
            
            if (minMmrChange !== undefined || maxMmrChange !== undefined) {
              whereClause.mmrChange = {};
              if (minMmrChange !== undefined) {
                whereClause.mmrChange.gte = minMmrChange;
              }
              if (maxMmrChange !== undefined) {
                whereClause.mmrChange.lte = maxMmrChange;
              }
            }
            
            if (isWin !== undefined) {
              whereClause.isWin = isWin;
            }
            
            if (isPrimeTime !== undefined) {
              whereClause.isPrimeTime = isPrimeTime;
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
                  battleId: log.battleId,
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
                allianceName: log.allianceName,
                previousMmr: log.previousMmr,
                mmrChange: log.mmrChange,
                newMmr: log.newMmr,
                isWin: log.isWin,
                kills: log.kills,
                deaths: log.deaths,
                fameGained: log.fameGained,
                fameLost: log.fameLost,
                players: log.players,
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
          { ttl: CACHE_TTL.GUILDS_LIST } // Use similar TTL as guilds list
        );
      } catch (error) {
        console.error('Error fetching MMR feed:', error);
        throw new Error('Failed to fetch MMR feed');
      }
    }),

  getBattleDetails: publicProc
    .input(z.object({
      battleId: z.string(),
      seasonId: z.string().optional()
    }))
    .query(async ({ input }) => {
      const { battleId, seasonId } = input;
      
      try {
        return await apiCache.getOrSet(
          'mmrFeed',
          ['getBattleDetails', input],
          async () => {
            const whereClause: any = {
              battleId: BigInt(battleId)
            };
            
            if (seasonId) {
              whereClause.seasonId = seasonId;
            }

            const mmrLogs = await prisma.mmrCalculationLog.findMany({
              where: whereClause,
              include: {
                guild: true,
                season: true,
              },
              orderBy: { mmrChange: 'desc' }
            });

            if (mmrLogs.length === 0) {
              throw new Error('Battle not found');
            }

            const firstLog = mmrLogs[0];
            
            return {
              battleId: firstLog.battleId,
              seasonId: firstLog.seasonId,
              seasonName: firstLog.season.name,
              totalBattlePlayers: firstLog.totalBattlePlayers,
              totalBattleFame: firstLog.totalBattleFame,
              battleDuration: firstLog.battleDuration,
              isPrimeTime: firstLog.isPrimeTime,
              processedAt: firstLog.processedAt,
              guilds: mmrLogs.map(log => ({
                id: log.guildId,
                name: log.guildName,
                allianceName: log.allianceName,
                previousMmr: log.previousMmr,
                mmrChange: log.mmrChange,
                newMmr: log.newMmr,
                isWin: log.isWin,
                kills: log.kills,
                deaths: log.deaths,
                fameGained: log.fameGained,
                fameLost: log.fameLost,
                players: log.players,
                avgIP: log.avgIP,
                hasSignificantParticipation: log.hasSignificantParticipation,
                antiFarmingFactor: log.antiFarmingFactor,
                originalMmrChange: log.originalMmrChange
              }))
            };
          },
          { ttl: CACHE_TTL.GUILD_DETAIL }
        );
      } catch (error) {
        console.error('Error fetching battle details:', error);
        throw new Error('Failed to fetch battle details');
      }
    })
});
