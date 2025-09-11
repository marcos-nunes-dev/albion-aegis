import { router, publicProc } from "../trpc.js";
import { z } from "zod";
import { prisma } from "../db.js";
import { apiCache, CACHE_TTL } from "../cache.js";

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
              if (search) {
                // OPTIMIZED: Use efficient database queries with proper indexing
                // Step 1: Get search results with database filtering (much faster than loading all)
                const searchResults = await prisma.guildSeason.findMany({
                  where: {
                    seasonId,
                    guild: {
                      name: {
                        contains: search,
                        mode: 'insensitive'
                      }
                    }
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
                  orderBy: field === 'mmr' ? { currentMmr: dir as 'asc' | 'desc' } :
                    field === 'name' ? { guild: { name: dir as 'asc' | 'desc' } } :
                      field === 'battles' ? { totalBattles: dir as 'asc' | 'desc' } :
                        { currentMmr: 'desc' }
                });

                // Step 2: Calculate ranks efficiently using a single count query per result
                // This is much faster than loading all guilds into memory
                const data = await Promise.all(
                  searchResults.map(async (gs) => {
                    // Calculate rank by counting guilds with better MMR
                    let rank = 1;
                    if (field === 'mmr') {
                      const betterCount = dir === 'desc' 
                        ? await prisma.guildSeason.count({
                            where: {
                              seasonId,
                              currentMmr: { gt: gs.currentMmr }
                            }
                          })
                        : await prisma.guildSeason.count({
                            where: {
                              seasonId,
                              currentMmr: { lt: gs.currentMmr }
                            }
                          });
                      rank = betterCount + 1;
                    } else if (field === 'name') {
                      const betterCount = dir === 'asc'
                        ? await prisma.guildSeason.count({
                            where: {
                              seasonId,
                              guild: {
                                name: { lt: gs.guild.name }
                              }
                            }
                          })
                        : await prisma.guildSeason.count({
                            where: {
                              seasonId,
                              guild: {
                                name: { gt: gs.guild.name }
                              }
                            }
                          });
                      rank = betterCount + 1;
                    } else if (field === 'battles') {
                      const betterCount = dir === 'desc'
                        ? await prisma.guildSeason.count({
                            where: {
                              seasonId,
                              totalBattles: { gt: gs.totalBattles }
                            }
                          })
                        : await prisma.guildSeason.count({
                            where: {
                              seasonId,
                              totalBattles: { lt: gs.totalBattles }
                            }
                          });
                      rank = betterCount + 1;
                    }

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
                      avgMass: Math.round(avgMass * 10) / 10,
                      lastBattleAt: gs.lastBattleAt,
                      rank, // Actual rank calculated efficiently
                      season: {
                        id: gs.season.id,
                        name: gs.season.name,
                        isActive: gs.season.isActive
                      }
                    };
                  })
                );

                // Step 3: Apply pagination to results
                const total = data.length;
                const paginatedData = data.slice((page - 1) * pageSize, page * pageSize);

                return { data: paginatedData, page, pageSize, total, seasonId };
              } else {
                // For regular pagination: Use the original efficient approach
                const [guildSeasons, total] = await Promise.all([
                  prisma.guildSeason.findMany({
                    where: { seasonId },
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
                    where: { seasonId }
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
                    avgMass: Math.round(avgMass * 10) / 10,
                    lastBattleAt: gs.lastBattleAt,
                    season: {
                      id: gs.season.id,
                      name: gs.season.name,
                      isActive: gs.season.isActive
                    }
                  };
                });

                return { data, page, pageSize, total, seasonId };
              }
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
    }),

  // Get prime time mass data for a specific guild
  getPrimeTimeMass: publicProc
    .input(z.object({
      guildId: z.string(),
      seasonId: z.string().optional()
    }))
    .query(async ({ input }) => {
      const { guildId, seasonId } = input;
      
      try {
        return await apiCache.getOrSet(
          'guilds',
          ['getPrimeTimeMass', input],
          async () => {
            // Get the active season if no seasonId provided
            let targetSeasonId = seasonId;
            if (!targetSeasonId) {
              const activeSeason = await prisma.season.findFirst({
                where: { isActive: true },
                orderBy: { startDate: 'desc' }
              });
              if (!activeSeason) {
                throw new Error('No active season found');
              }
              targetSeasonId = activeSeason.id;
            }

            // Get guild season data with prime time masses
            const guildSeason = await prisma.guildSeason.findFirst({
              where: {
                guildId,
                seasonId: targetSeasonId
              },
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

            if (!guildSeason) {
              throw new Error('Guild not found in this season');
            }

            // Get all prime time windows to ensure we show all available windows
            const allPrimeTimeWindows = await prisma.primeTimeWindow.findMany({
              orderBy: { startHour: 'asc' }
            });

            // Create a map of prime time masses by window ID
            const massMap = new Map();
            guildSeason.primeTimeMasses.forEach(mass => {
              massMap.set(mass.primeTimeWindowId, mass);
            });

            // Build the response with all prime time windows
            const primeTimeData = await Promise.all(allPrimeTimeWindows.map(async (window) => {
              const massData = massMap.get(window.id);
              
              // Count actual MMR calculation logs for this prime time window
              let mmrBattleCount = 0;
              let lastMmrBattleAt = null;
              
              try {
                // Get MMR calculation logs for this prime time window
                const mmrLogs = await prisma.mmrCalculationLog.findMany({
                  where: {
                    guildId,
                    seasonId: targetSeasonId,
                    processedAt: {
                      gte: guildSeason.season.startDate,
                      lte: guildSeason.season.endDate || new Date()
                    }
                  },
                  select: {
                    processedAt: true,
                    battleId: true
                  }
                });

                // Filter by hour of day for prime time
                const filteredLogs = mmrLogs.filter(log => {
                  const logHour = log.processedAt.getUTCHours();
                  
                  if (window.endHour < window.startHour) {
                    // Overnight window (e.g., 22:00 to 02:00)
                    return logHour >= window.startHour || logHour < window.endHour;
                  } else {
                    // Same day window (e.g., 20:00 to 22:00)
                    return logHour >= window.startHour && logHour < window.endHour;
                  }
                });

                // Count unique battles
                const uniqueBattles = new Set(filteredLogs.map(log => log.battleId.toString()));
                mmrBattleCount = uniqueBattles.size;
                
                // Get the most recent battle time
                if (filteredLogs.length > 0) {
                  lastMmrBattleAt = filteredLogs
                    .sort((a, b) => b.processedAt.getTime() - a.processedAt.getTime())[0]
                    .processedAt;
                }
              } catch (error) {
                console.warn('Error counting MMR battles for prime time window:', error);
              }

              return {
                windowId: window.id,
                startHour: window.startHour,
                endHour: window.endHour,
                timezone: window.timezone,
                avgMass: massData?.avgMass || 0,
                battleCount: mmrBattleCount, // Use MMR battle count instead
                lastBattleAt: lastMmrBattleAt || massData?.lastBattleAt
              };
            }));

            return {
              guild: {
                id: guildSeason.guild.id,
                name: guildSeason.guild.name
              },
              season: {
                id: guildSeason.season.id,
                name: guildSeason.season.name
              },
              primeTimeData
            };
          },
          { ttl: CACHE_TTL.GUILDS_LIST }
        );
      } catch (error) {
        console.error('Error fetching guild prime time mass:', error);
        throw new Error('Failed to fetch guild prime time mass data');
      }
    })

});

