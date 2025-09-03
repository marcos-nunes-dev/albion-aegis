import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { getPrisma } from '../db/database.js';

// Initialize tRPC
const t = initTRPC.create();

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

// Main router
export const appRouter = router({
  battle: battleRouter,
  kill: killRouter,
  entity: entityRouter,
});

// Export type definition of API
export type AppRouter = typeof appRouter;
