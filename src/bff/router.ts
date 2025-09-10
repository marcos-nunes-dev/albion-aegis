import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { getPrisma } from '../db/database.js';
import superjson from 'superjson';

// Initialize tRPC with superjson transformer
const t = initTRPC.create({
  transformer: superjson,
});

// Create the router and procedure helpers
export const router = t.router;
export const publicProcedure = t.procedure;

// Battle procedures
export const battleRouter = router({
  // Get battles with pagination and filters
  getBattles: publicProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      minTotalFame: z.number().min(0).optional(),
      minTotalKills: z.number().min(0).optional(),
      minTotalPlayers: z.number().min(0).optional(),
    }))
    .query(async ({ input }) => {
      const prisma = getPrisma();
      const { page, limit, startDate, endDate, minTotalFame, minTotalKills, minTotalPlayers } = input;
      
      const where: any = {};
      
      if (startDate || endDate) {
        where.startedAt = {};
        if (startDate) where.startedAt.gte = new Date(startDate);
        if (endDate) where.startedAt.lte = new Date(endDate);
      }
      
      if (minTotalFame) where.totalFame = { gte: minTotalFame };
      if (minTotalKills) where.totalKills = { gte: minTotalKills };
      if (minTotalPlayers) where.totalPlayers = { gte: minTotalPlayers };
      
      const [battles, total] = await Promise.all([
        prisma.battle.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.battle.count({ where }),
      ]);
      
      // Convert BigInt values to strings to avoid serialization issues
      const serializedBattles = battles.map(battle => {
        // Create a new object with BigInt values converted to strings
        // Temporarily exclude JSON fields to test if they contain BigInt values
        return {
          albionId: battle.albionId.toString(),
          startedAt: battle.startedAt,
          totalFame: battle.totalFame,
          totalKills: battle.totalKills,
          totalPlayers: battle.totalPlayers,
          ingestedAt: battle.ingestedAt,
          killsFetchedAt: battle.killsFetchedAt,
        };
      });
      
      // Ensure total is a number, not BigInt
      const totalCount = Number(total);
      
      return {
        battles: serializedBattles,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      };
    }),

  // Get a single battle by ID
  getBattle: publicProcedure
    .input(z.object({
      albionId: z.bigint(),
    }))
    .query(async ({ input }) => {
      const prisma = getPrisma();
      const battle = await prisma.battle.findUnique({
        where: { albionId: input.albionId },
      });
      
      if (!battle) {
        throw new Error('Battle not found');
      }
      
      // Convert BigInt values to strings to avoid serialization issues
      return {
        ...battle,
        albionId: battle.albionId.toString(),
      };
    }),

  // Get battle statistics
  getBattleStats: publicProcedure
    .input(z.object({
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
    }))
    .query(async ({ input }) => {
      const prisma = getPrisma();
      const { startDate, endDate } = input;
      
      const where: any = {};
      if (startDate || endDate) {
        where.startedAt = {};
        if (startDate) where.startedAt.gte = new Date(startDate);
        if (endDate) where.startedAt.lte = new Date(endDate);
      }
      
      const [totalBattles, totalFame, totalKills, totalPlayers] = await Promise.all([
        prisma.battle.count({ where }),
        prisma.battle.aggregate({
          where,
          _sum: { totalFame: true },
        }),
        prisma.battle.aggregate({
          where,
          _sum: { totalKills: true },
        }),
        prisma.battle.aggregate({
          where,
          _sum: { totalPlayers: true },
        }),
      ]);
      
      // Ensure all values are numbers (not BigInt)
      const fameSum = Number(totalFame._sum.totalFame || 0);
      const killsSum = Number(totalKills._sum.totalKills || 0);
      const playersSum = Number(totalPlayers._sum.totalPlayers || 0);
      
      return {
        totalBattles,
        totalFame: fameSum,
        totalKills: killsSum,
        totalPlayers: playersSum,
        averageFame: totalBattles > 0 ? Math.round(fameSum / totalBattles) : 0,
        averageKills: totalBattles > 0 ? Math.round(killsSum / totalBattles) : 0,
        averagePlayers: totalBattles > 0 ? Math.round(playersSum / totalBattles) : 0,
      };
    }),
});

// Kill procedures
export const killRouter = router({
  // Get kills with pagination and filters
  getKills: publicProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      killerAlliance: z.string().optional(),
      victimAlliance: z.string().optional(),
      killerGuild: z.string().optional(),
      victimGuild: z.string().optional(),
      minKillFame: z.number().min(0).optional(),
    }))
    .query(async ({ input }) => {
      const prisma = getPrisma();
      const { page, limit, startDate, endDate, killerAlliance, victimAlliance, killerGuild, victimGuild, minKillFame } = input;
      
      const where: any = {};
      
      if (startDate || endDate) {
        where.TimeStamp = {};
        if (startDate) where.TimeStamp.gte = new Date(startDate);
        if (endDate) where.TimeStamp.lte = new Date(endDate);
      }
      
      if (killerAlliance) where.killerAlliance = killerAlliance;
      if (victimAlliance) where.victimAlliance = victimAlliance;
      if (killerGuild) where.killerGuild = killerGuild;
      if (victimGuild) where.victimGuild = victimGuild;
      if (minKillFame) where.TotalVictimKillFame = { gte: minKillFame };
      
      const [kills, total] = await Promise.all([
        prisma.killEvent.findMany({
          where,
          orderBy: { TimeStamp: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.killEvent.count({ where }),
      ]);
      
      // Convert BigInt values to strings to avoid serialization issues
      const serializedKills = kills.map(kill => ({
        ...kill,
        EventId: kill.EventId.toString(),
        battleAlbionId: kill.battleAlbionId ? kill.battleAlbionId.toString() : null,
      }));
      
      return {
        kills: serializedKills,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }),

  // Get kill statistics
  getKillStats: publicProcedure
    .input(z.object({
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
    }))
    .query(async ({ input }) => {
      const prisma = getPrisma();
      const { startDate, endDate } = input;
      
      const where: any = {};
      if (startDate || endDate) {
        where.TimeStamp = {};
        if (startDate) where.TimeStamp.gte = new Date(startDate);
        if (endDate) where.TimeStamp.lte = new Date(endDate);
      }
      
      const [totalKills, totalFame, topKillers, topVictims] = await Promise.all([
        prisma.killEvent.count({ where }),
        prisma.killEvent.aggregate({
          where,
          _sum: { TotalVictimKillFame: true },
        }),
        prisma.killEvent.groupBy({
          by: ['killerName', 'killerGuild', 'killerAlliance'],
          where,
          _count: { EventId: true },
          _sum: { TotalVictimKillFame: true },
          orderBy: { _count: { EventId: 'desc' } },
          take: 10,
        }),
        prisma.killEvent.groupBy({
          by: ['victimName', 'victimGuild', 'victimAlliance'],
          where,
          _count: { EventId: true },
          _sum: { TotalVictimKillFame: true },
          orderBy: { _count: { EventId: 'desc' } },
          take: 10,
        }),
      ]);
      
      // Ensure all values are numbers (not BigInt)
      const fameSum = Number(totalFame._sum.TotalVictimKillFame || 0);
      
      return {
        totalKills,
        totalFame: fameSum,
        averageFame: totalKills > 0 ? Math.round(fameSum / totalKills) : 0,
        topKillers,
        topVictims,
      };
    }),
});

// Guild/Alliance procedures
export const entityRouter = router({
  // Get guild statistics
  getGuildStats: publicProcedure
    .input(z.object({
      guildName: z.string(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
    }))
    .query(async ({ input }) => {
      const prisma = getPrisma();
      const { guildName, startDate, endDate } = input;
      
      const where: any = {};
      if (startDate || endDate) {
        where.TimeStamp = {};
        if (startDate) where.TimeStamp.gte = new Date(startDate);
        if (endDate) where.TimeStamp.lte = new Date(endDate);
      }
      
      const [killsAsKiller, killsAsVictim, battles] = await Promise.all([
        prisma.killEvent.findMany({
          where: { ...where, killerGuild: guildName },
          orderBy: { TimeStamp: 'desc' },
          take: 100,
        }),
        prisma.killEvent.findMany({
          where: { ...where, victimGuild: guildName },
          orderBy: { TimeStamp: 'desc' },
          take: 100,
        }),
        prisma.battle.findMany({
          where: {
            ...where,
            guildsJson: {
              path: ['$'],
              array_contains: [guildName],
            },
          },
          orderBy: { startedAt: 'desc' },
          take: 100,
        }),
      ]);
      
      // Convert BigInt values to strings to avoid serialization issues
      const serializedKillsAsKiller = killsAsKiller.map(kill => ({
        ...kill,
        EventId: kill.EventId.toString(),
        battleAlbionId: kill.battleAlbionId ? kill.battleAlbionId.toString() : null,
      }));
      
      const serializedKillsAsVictim = killsAsVictim.map(kill => ({
        ...kill,
        EventId: kill.EventId.toString(),
        battleAlbionId: kill.battleAlbionId ? kill.battleAlbionId.toString() : null,
      }));
      
      const totalKills = killsAsKiller.length;
      const totalDeaths = killsAsVictim.length;
      const totalKillFame = killsAsKiller.reduce((sum, kill) => sum + kill.TotalVictimKillFame, 0);
      const totalDeathFame = killsAsVictim.reduce((sum, kill) => sum + kill.TotalVictimKillFame, 0);
      
      return {
        guildName,
        totalKills,
        totalDeaths,
        totalKillFame,
        totalDeathFame,
        netFame: totalKillFame - totalDeathFame,
        kdr: totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills.toString(),
        battles: battles.length,
        recentKills: serializedKillsAsKiller.slice(0, 10),
        recentDeaths: serializedKillsAsVictim.slice(0, 10),
      };
    }),

  // Get alliance statistics
  getAllianceStats: publicProcedure
    .input(z.object({
      allianceName: z.string(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
    }))
    .query(async ({ input }) => {
      const prisma = getPrisma();
      const { allianceName, startDate, endDate } = input;
      
      const where: any = {};
      if (startDate || endDate) {
        where.TimeStamp = {};
        if (startDate) where.TimeStamp.gte = new Date(startDate);
        if (endDate) where.TimeStamp.lte = new Date(endDate);
      }
      
      const [killsAsKiller, killsAsVictim, battles] = await Promise.all([
        prisma.killEvent.findMany({
          where: { ...where, killerAlliance: allianceName },
          orderBy: { TimeStamp: 'desc' },
          take: 100,
        }),
        prisma.killEvent.findMany({
          where: { ...where, victimAlliance: allianceName },
          orderBy: { TimeStamp: 'desc' },
          take: 100,
        }),
        prisma.battle.findMany({
          where: {
            ...where,
            alliancesJson: {
              path: ['$'],
              array_contains: [allianceName],
            },
          },
          orderBy: { startedAt: 'desc' },
          take: 100,
        }),
      ]);
      
      // Convert BigInt values to strings to avoid serialization issues
      const serializedKillsAsKiller = killsAsKiller.map(kill => ({
        ...kill,
        EventId: kill.EventId.toString(),
        battleAlbionId: kill.battleAlbionId ? kill.battleAlbionId.toString() : null,
      }));
      
      const serializedKillsAsVictim = killsAsVictim.map(kill => ({
        ...kill,
        EventId: kill.EventId.toString(),
        battleAlbionId: kill.battleAlbionId ? kill.battleAlbionId.toString() : null,
      }));
      
      const totalKills = killsAsKiller.length;
      const totalDeaths = killsAsVictim.length;
      const totalKillFame = killsAsKiller.reduce((sum, kill) => sum + kill.TotalVictimKillFame, 0);
      const totalDeathFame = killsAsVictim.reduce((sum, kill) => sum + kill.TotalVictimKillFame, 0);
      
      return {
        allianceName,
        totalKills,
        totalDeaths,
        totalKillFame,
        totalDeathFame,
        netFame: totalKillFame - totalDeathFame,
        kdr: totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills.toString(),
        battles: battles.length,
        recentKills: serializedKillsAsKiller.slice(0, 10),
        recentDeaths: serializedKillsAsVictim.slice(0, 10),
      };
    }),
});

// Seasons procedures
export const seasonsRouter = router({
  getActive: publicProcedure
    .query(async () => {
      try {
        const prisma = getPrisma();
        const activeSeason = await prisma.season.findFirst({
          where: { isActive: true },
          orderBy: { startDate: 'desc' }
        });

        if (!activeSeason) {
          return null;
        }

        return {
          id: activeSeason.id,
          name: activeSeason.name,
          description: activeSeason.name, // Use name as description for now
          status: 'active' as const,
          endDate: activeSeason.endDate?.toISOString() || new Date().toISOString()
        };
      } catch (error) {
        console.error('Error fetching active season:', error);
        throw new Error('Failed to fetch active season');
      }
    }),

  list: publicProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20)
    }).optional())
    .query(async ({ input }) => {
      const { page = 1, pageSize = 20 } = input || {};
      
      try {
        const prisma = getPrisma();
        const [seasons, total] = await Promise.all([
          prisma.season.findMany({
            skip: (page - 1) * pageSize,
            take: pageSize,
            orderBy: { startDate: 'desc' }
          }),
          prisma.season.count()
        ]);

        const data = seasons.map(season => ({
          id: season.id,
          name: season.name,
          description: season.name, // Use name as description for now
          status: season.isActive ? 'active' as const : 'completed' as const,
          endDate: season.endDate?.toISOString() || new Date().toISOString()
        }));

        return { data, page, pageSize, total };
      } catch (error) {
        console.error('Error fetching seasons:', error);
        throw new Error('Failed to fetch seasons');
      }
    })
});

// Guilds procedures
export const guildsRouter = router({
  list: publicProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
      sort: z.enum(["mmr:desc", "mmr:asc", "name:asc", "name:desc", "battles:desc", "battles:asc"]).default("mmr:desc"),
      seasonId: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { page, pageSize, sort, seasonId, search } = input;
      
      try {
        const prisma = getPrisma();
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
      } catch (error) {
        console.error('Error fetching guilds:', error);
        throw new Error('Failed to fetch guilds');
      }
    }),

  topAllTime: publicProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(3)
    }))
    .query(async ({ input }) => {
      const { limit } = input;
      
      try {
        const prisma = getPrisma();
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
      } catch (error) {
        console.error('Error fetching all-time top guilds:', error);
        throw new Error('Failed to fetch all-time top guilds');
      }
    })
});

// Statistics procedures
export const statisticsRouter = router({
  getOverview: publicProcedure
    .query(async () => {
      try {
        const prisma = getPrisma();
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
      } catch (error) {
        console.error('Error fetching statistics:', error);
        throw new Error('Failed to fetch statistics');
      }
    })
});

// MMR Feed procedures
export const mmrFeedRouter = router({
  getFeed: publicProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(20),
      seasonId: z.string().optional(),
      searchTerm: z.string().optional(), // Search by battle ID or guild name
    }))
    .query(async ({ input }) => {
      const { 
        page, 
        pageSize, 
        seasonId, 
        searchTerm 
      } = input;

      try {
        const prisma = getPrisma();
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
      } catch (error) {
        console.error('Error fetching MMR feed:', error);
        throw new Error('Failed to fetch MMR feed');
      }
    })
});

// Main router
export const appRouter = router({
  battle: battleRouter,
  kill: killRouter,
  entity: entityRouter,
  seasons: seasonsRouter,
  guilds: guildsRouter,
  statistics: statisticsRouter,
  mmrFeed: mmrFeedRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
