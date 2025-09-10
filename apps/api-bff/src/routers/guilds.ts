import { router, publicProc } from "../trpc";
import { z } from "zod";
import { prisma } from "../db";
import { apiCache, CACHE_TTL } from "../cache";

const ListInput = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
  sort: z.enum(["mmr:desc", "mmr:asc", "name:asc", "name:desc", "battles:desc", "battles:asc"]).default("mmr:desc"),
  seasonId: z.string().optional(),
  search: z.string().optional(),
});

export const guildsRouter = router({
  list: publicProc
    .input(ListInput)
    .query(async ({ input }) => {
      const { page, pageSize, sort, seasonId, search } = input;
      
      try {
        return await apiCache.getOrSet(
          'guilds',
          ['list', input],
          async () => {
            const [field, dir] = sort.split(":");
            const whereClause: any = {};
            if (search) {
              whereClause.name = {
                contains: search,
                mode: 'insensitive'
              };
            }

            if (seasonId) {
              const [guildSeasons, total] = await Promise.all([
                prisma.guildSeason.findMany({
                  where: {
                    seasonId,
                    ...(search ? { guild: whereClause } : {})
                  },
                  include: {
                    guild: true,
                    season: true,
                    primeTimeMasses: {
                      include: {
                        primeTimeWindow: true
                      }
                    }
                  },
                  skip: (page - 1) * pageSize,
                  take: pageSize,
                  orderBy: field === 'mmr' ? { currentMmr: dir as 'asc' | 'desc' } :
                    field === 'name' ? { guild: { name: dir as 'asc' | 'desc' } } :
                      field === 'battles' ? { totalBattles: dir as 'asc' | 'desc' } :
                        { currentMmr: 'desc' }
                }),
                prisma.guildSeason.count({
                  where: {
                    seasonId,
                    ...(search ? { guild: whereClause } : {})
                  }
                })
              ]);

              const data = guildSeasons.map((gs) => {
                // Calculate average mass across all prime time windows
                const avgMass = gs.primeTimeMasses.length > 0 
                  ? gs.primeTimeMasses.reduce((sum, mass) => sum + mass.avgMass, 0) / gs.primeTimeMasses.length
                  : 0;

                return {
                  id: gs.guild.id,
                  name: gs.guild.name,
                  currentMmr: gs.currentMmr,
                  previousSeasonMmr: gs.previousSeasonMmr,
                  carryoverMmr: gs.carryoverMmr,
                  seasonEndMmr: gs.seasonEndMmr,
                  totalBattles: gs.totalBattles,
                  wins: gs.wins,
                  losses: gs.losses,
                  winRate: gs.totalBattles > 0 ? (gs.wins / gs.totalBattles * 100).toFixed(1) : '0.0',
                  totalFameGained: gs.totalFameGained,
                  totalFameLost: gs.totalFameLost,
                  primeTimeBattles: gs.primeTimeBattles,
                  avgMass: Math.round(avgMass * 10) / 10, // Round to 1 decimal place
                  lastBattleAt: gs.lastBattleAt,
                  season: {
                    id: gs.season.id,
                    name: gs.season.name,
                    isActive: gs.season.isActive
                  }
                };
              });

              return { data, page, pageSize, total, seasonId };
            } else {
              const [guilds, total] = await Promise.all([
                prisma.guild.findMany({
                  where: whereClause,
                  skip: (page - 1) * pageSize,
                  take: pageSize,
                  orderBy: field === 'name' ? { name: dir as 'asc' | 'desc' } : { name: 'asc' },
                  include: {
                    guildSeasons: {
                      where: { season: { isActive: true } },
                      include: { season: true },
                      take: 1
                    }
                  }
                }),
                prisma.guild.count({ where: whereClause })
              ]);

              const data = guilds.map((guild) => {
                const activeSeason = guild.guildSeasons[0];
                return {
                  id: guild.id,
                  name: guild.name,
                  currentMmr: activeSeason?.currentMmr || 1000.0,
                  totalBattles: activeSeason?.totalBattles || 0,
                  wins: activeSeason?.wins || 0,
                  losses: activeSeason?.losses || 0,
                  winRate: activeSeason && activeSeason.totalBattles > 0
                    ? (activeSeason.wins / activeSeason.totalBattles * 100).toFixed(1)
                    : '0.0',
                  season: activeSeason?.season ? {
                    id: activeSeason.season.id,
                    name: activeSeason.season.name,
                    isActive: activeSeason.season.isActive
                  } : null
                };
              });

              return { data, page, pageSize, total };
            }
          },
          { ttl: CACHE_TTL.GUILDS_LIST }
        );
      } catch (error) {
        console.error('Error fetching guilds:', error);
        throw new Error('Failed to fetch guilds');
      }
    }),

  get: publicProc
    .input(z.object({
      identifier: z.string(),
      seasonId: z.string().optional()
    }))
    .query(async ({ input }) => {
      const { identifier, seasonId } = input;
      
      try {
        return await apiCache.getOrSet(
          'guilds',
          ['get', input],
          async () => {
            let guild = await prisma.guild.findFirst({
              where: {
                OR: [
                  { id: identifier },
                  { name: identifier }
                ]
              },
              include: {
                guildSeasons: seasonId ? {
                  where: { seasonId },
                  include: { season: true }
                } : {
                  include: { season: true },
                  orderBy: { season: { startDate: 'desc' } }
                }
              }
            });

            if (!guild) {
              throw new Error('Guild not found');
            }

            return {
              id: guild.id,
              name: guild.name,
              guildSeasons: guild.guildSeasons.map((gs) => ({
                seasonId: gs.seasonId,
                seasonName: gs.season.name,
                currentMmr: gs.currentMmr,
                totalBattles: gs.totalBattles,
                wins: gs.wins,
                losses: gs.losses,
                winRate: gs.totalBattles > 0 ? (gs.wins / gs.totalBattles * 100).toFixed(1) : '0.0',
                totalFameGained: gs.totalFameGained,
                totalFameLost: gs.totalFameLost,
                primeTimeBattles: gs.primeTimeBattles,
                lastBattleAt: gs.lastBattleAt
              }))
            };
          },
          { ttl: CACHE_TTL.GUILD_DETAIL }
        );
      } catch (error) {
        console.error('Error fetching guild:', error);
        throw new Error('Failed to fetch guild');
      }
    }),

  topByMmr: publicProc
    .input(z.object({
      seasonId: z.string(),
      limit: z.number().min(1).max(100).default(100)
    }))
    .query(async ({ input }) => {
      const { seasonId, limit } = input;
      
      try {
        return await apiCache.getOrSet(
          'guilds',
          ['topByMmr', input],
          async () => {
            const topGuilds = await prisma.guildSeason.findMany({
              where: { seasonId },
              orderBy: { currentMmr: 'desc' },
              take: limit,
              include: {
                guild: true,
                season: true,
                primeTimeMasses: {
                  include: {
                    primeTimeWindow: true
                  }
                }
              }
            });

            return topGuilds.map((gs) => {
              // Calculate average mass across all prime time windows
              const avgMass = gs.primeTimeMasses.length > 0 
                ? gs.primeTimeMasses.reduce((sum, mass) => sum + mass.avgMass, 0) / gs.primeTimeMasses.length
                : 0;

              return {
                rank: 0,
                id: gs.guild.id,
                name: gs.guild.name,
                currentMmr: gs.currentMmr,
                totalBattles: gs.totalBattles,
                wins: gs.wins,
                losses: gs.losses,
                winRate: gs.totalBattles > 0 ? (gs.wins / gs.totalBattles * 100).toFixed(1) : '0.0',
                totalFameGained: gs.totalFameGained,
                totalFameLost: gs.totalFameLost,
                primeTimeBattles: gs.primeTimeBattles,
                avgMass: Math.round(avgMass * 10) / 10, // Round to 1 decimal place
                lastBattleAt: gs.lastBattleAt
              };
            }).map((guild, index) => ({
              ...guild,
              rank: index + 1
            }));
          },
          { ttl: CACHE_TTL.GUILDS_TOP }
        );
      } catch (error) {
        console.error('Error fetching top guilds:', error);
        throw new Error('Failed to fetch top guilds');
      }
    }),

  topAllTime: publicProc
    .input(z.object({
      limit: z.number().min(1).max(100).default(3)
    }))
    .query(async ({ input }) => {
      const { limit } = input;
      
      try {
        return await apiCache.getOrSet(
          'guilds',
          ['topAllTime', input],
          async () => {
            // Get the highest MMR for each guild across all seasons
            const topGuilds = await prisma.guildSeason.findMany({
              include: {
                guild: true,
                season: true,
                primeTimeMasses: {
                  include: {
                    primeTimeWindow: true
                  }
                }
              },
              orderBy: { currentMmr: 'desc' },
              take: limit * 3 // Get more to filter unique guilds
            });

            // Group by guild and get the highest MMR for each guild
            const guildMap = new Map();
            
            // Fetch additional guild data from Albion API
            const fetchGuildData = async (guildId: string): Promise<{
              FounderName?: string;
              MemberCount?: number;
              killFame?: number;
              DeathFame?: number;
            } | null> => {
              try {
                const response = await fetch(`https://gameinfo.albiononline.com/api/gameinfo/guilds/${guildId}`);
                if (response.ok) {
                  const data = await response.json() as {
                    FounderName?: string;
                    MemberCount?: number;
                    killFame?: number;
                    DeathFame?: number;
                  };
                  return data;
                }
              } catch (error) {
                console.error(`Failed to fetch guild data for ${guildId}:`, error);
              }
              return null;
            };

            // Process guilds and fetch additional data
            for (const gs of topGuilds) {
              const guildId = gs.guild.id;
              if (!guildMap.has(guildId) || gs.currentMmr > guildMap.get(guildId).currentMmr) {
                // Calculate average mass across all prime time windows
                const avgMass = gs.primeTimeMasses.length > 0 
                  ? gs.primeTimeMasses.reduce((sum, mass) => sum + mass.avgMass, 0) / gs.primeTimeMasses.length
                  : 0;

                // Fetch additional guild data
                const albionData = await fetchGuildData(guildId);

                guildMap.set(guildId, {
                  rank: 0,
                  id: gs.guild.id,
                  name: gs.guild.name,
                  currentMmr: gs.currentMmr,
                  totalBattles: gs.totalBattles,
                  wins: gs.wins,
                  losses: gs.losses,
                  winRate: gs.totalBattles > 0 ? (gs.wins / gs.totalBattles * 100).toFixed(1) : '0.0',
                  avgMass: Math.round(avgMass * 10) / 10,
                  season: {
                    id: gs.season.id,
                    name: gs.season.name,
                    isActive: gs.season.isActive
                  },
                  // Additional Albion API data
                  founderName: albionData?.FounderName || 'Unknown',
                  memberCount: albionData?.MemberCount || 0,
                  killFame: albionData?.killFame || 0,
                  deathFame: albionData?.DeathFame || 0
                });
              }
            }

            // Convert to array, sort by MMR, and take top N
            const result = Array.from(guildMap.values())
              .sort((a, b) => b.currentMmr - a.currentMmr)
              .slice(0, limit)
              .map((guild, index) => ({
                ...guild,
                rank: index + 1
              }));

            return result;
          },
          { ttl: CACHE_TTL.GUILDS_TOP }
        );
      } catch (error) {
        console.error('Error fetching all-time top guilds:', error);
        throw new Error('Failed to fetch all-time top guilds');
      }
    })
});

