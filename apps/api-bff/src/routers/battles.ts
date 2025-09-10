import { router, publicProc } from "../trpc.js";
import { z } from "zod";
import { prisma } from "../db.js";
// import { apiCache } from "../cache.js"; // Temporarily disabled

const HeadToHeadInput = z.object({
  guild1Id: z.string(),
  guild2Id: z.string(),
  seasonId: z.string().optional(),
  limit: z.number().min(1).max(100).default(1000),
});

export const battlesRouter = router({
  headToHead: publicProc
    .input(HeadToHeadInput)
    .query(async ({ input }) => {
      const { guild1Id, guild2Id, seasonId, limit } = input;
      
      try {
        // Temporarily disabled cache - executing query directly
        // return await apiCache.getOrSet(
        //   'battles',
        //   ['headToHead', input],
        //   async () => {
            // Get guild names first
            const [guild1, guild2] = await Promise.all([
              prisma.guild.findUnique({ where: { id: guild1Id } }),
              prisma.guild.findUnique({ where: { id: guild2Id } })
            ]);

            if (!guild1 || !guild2) {
              throw new Error('One or both guilds not found');
            }

            // Note: Using raw SQL instead of Prisma JSON queries for better PostgreSQL JSONB support

            // Get season data if provided
            let season = null;
            if (seasonId) {
              season = await prisma.season.findUnique({
                where: { id: seasonId }
              });
            }

            // Get battles with both guilds using raw SQL for better JSON query support
            let battles;
            if (seasonId && season) {
              battles = await prisma.$queryRawUnsafe(`
                SELECT "albionId", "startedAt", "totalFame", "totalKills", "totalPlayers", "guildsJson", "alliancesJson"
                FROM "Battle"
                WHERE "guildsJson"::jsonb @> $1::jsonb
                AND "guildsJson"::jsonb @> $2::jsonb
                AND "startedAt" >= $3
                AND "startedAt" <= $4
                ORDER BY "startedAt" DESC
                LIMIT $5
              `, 
                JSON.stringify([{name: guild1.name}]),
                JSON.stringify([{name: guild2.name}]),
                season.startDate,
                season.endDate || new Date(),
                limit
              );
            } else {
              battles = await prisma.$queryRawUnsafe(`
                SELECT "albionId", "startedAt", "totalFame", "totalKills", "totalPlayers", "guildsJson", "alliancesJson"
                FROM "Battle"
                WHERE "guildsJson"::jsonb @> $1::jsonb
                AND "guildsJson"::jsonb @> $2::jsonb
                ORDER BY "startedAt" DESC
                LIMIT $3
              `,
                JSON.stringify([{name: guild1.name}]),
                JSON.stringify([{name: guild2.name}]),
                limit
              );
            }

            // Process battles to extract guild-specific data and calculate duration
            const processedBattles = await Promise.all((battles as any[]).map(async (battle: any) => {
              const guildsData = battle.guildsJson as Array<{
                name: string;
                kills?: number;
                deaths?: number;
              }>;
              const guild1Data = guildsData.find(g => g.name === guild1.name);
              const guild2Data = guildsData.find(g => g.name === guild2.name);

              // Determine winner based on kills - only count clear wins, not draws
              const guild1Kills = guild1Data?.kills || 0;
              const guild2Kills = guild2Data?.kills || 0;
              const winner = guild1Kills > guild2Kills ? guild1.name : 
                           guild2Kills > guild1Kills ? guild2.name : 'Draw';

              // Calculate duration based on first and last kill
              let duration = 'Unknown';
              try {
                const killEvents = await prisma.killEvent.findMany({
                  where: { battleAlbionId: battle.albionId },
                  orderBy: { TimeStamp: 'asc' },
                  select: { TimeStamp: true }
                });

                if (killEvents.length > 0) {
                  const firstKill = killEvents[0].TimeStamp;
                  const lastKill = killEvents[killEvents.length - 1].TimeStamp;
                  const durationMs = lastKill.getTime() - firstKill.getTime();
                  const durationMinutes = Math.round(durationMs / (1000 * 60));
                  duration = `${durationMinutes} minutes`;
                }
              } catch (error) {
                console.warn('Could not calculate duration for battle', battle.albionId, error);
              }

              return {
                id: battle.albionId.toString(),
                date: battle.startedAt.toISOString(),
                guild1: guild1.name,
                guild2: guild2.name,
                guild1Score: guild1Kills,
                guild2Score: guild2Kills,
                winner,
                duration,
                participants: battle.totalPlayers,
                totalFame: battle.totalFame,
                totalKills: battle.totalKills,
                detailsUrl: `https://albionbb.com/battles/${battle.albionId.toString()}`
              };
            }));

            // Calculate head-to-head statistics - only count clear wins, not draws
            const guild1Wins = processedBattles.filter((b: any) => b.winner === guild1.name).length;
            const guild2Wins = processedBattles.filter((b: any) => b.winner === guild2.name).length;
            const draws = processedBattles.filter((b: any) => b.winner === 'Draw').length;

            return {
              totalBattles: processedBattles.length,
              guild1Wins,
              guild2Wins,
              draws,
              battles: processedBattles,
              guild1: {
                id: guild1.id,
                name: guild1.name
              },
              guild2: {
                id: guild2.id,
                name: guild2.name
              }
            };
        //   },
        //   { ttl: 30 } // Short TTL to avoid long-term caching issues
        // );
      } catch (error) {
        console.error('Error fetching head-to-head battles:', error);
        throw new Error('Failed to fetch head-to-head battles');
      }
    }),

  // Get battles for a specific guild in a season
  guildBattles: publicProc
    .input(z.object({
      guildId: z.string(),
      seasonId: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const { guildId, seasonId, page, pageSize } = input;
      
      try {
        // Temporarily disabled cache - executing query directly
        // return await apiCache.getOrSet(
        //   'battles',
        //   ['guildBattles', input],
        //   async () => {
            // Get guild name
            const guild = await prisma.guild.findUnique({ where: { id: guildId } });
            if (!guild) {
              throw new Error('Guild not found');
            }

            // Note: Using raw SQL instead of Prisma JSON queries for better PostgreSQL JSONB support

            // Get season data if provided
            let season = null;
            if (seasonId) {
              season = await prisma.season.findUnique({
                where: { id: seasonId }
              });
            }

            // Get battles using raw SQL for better JSON query support
            let battles, total;
            if (seasonId && season) {
              [battles, total] = await Promise.all([
                prisma.$queryRawUnsafe(`
                  SELECT "albionId", "startedAt", "totalFame", "totalKills", "totalPlayers", "guildsJson", "alliancesJson"
                  FROM "Battle"
                  WHERE "guildsJson"::jsonb @> $1::jsonb
                  AND "startedAt" >= $2
                  AND "startedAt" <= $3
                  ORDER BY "startedAt" DESC
                  LIMIT $4 OFFSET $5
                `,
                  JSON.stringify([{name: guild.name}]),
                  season.startDate,
                  season.endDate || new Date(),
                  pageSize,
                  (page - 1) * pageSize
                ),
                prisma.$queryRawUnsafe(`
                  SELECT COUNT(*) as count
                  FROM "Battle"
                  WHERE "guildsJson"::jsonb @> $1::jsonb
                  AND "startedAt" >= $2
                  AND "startedAt" <= $3
                `,
                  JSON.stringify([{name: guild.name}]),
                  season.startDate,
                  season.endDate || new Date()
                )
              ]);
            } else {
              [battles, total] = await Promise.all([
                prisma.$queryRawUnsafe(`
                  SELECT "albionId", "startedAt", "totalFame", "totalKills", "totalPlayers", "guildsJson", "alliancesJson"
                  FROM "Battle"
                  WHERE "guildsJson"::jsonb @> $1::jsonb
                  ORDER BY "startedAt" DESC
                  LIMIT $2 OFFSET $3
                `,
                  JSON.stringify([{name: guild.name}]),
                  pageSize,
                  (page - 1) * pageSize
                ),
                prisma.$queryRawUnsafe(`
                  SELECT COUNT(*) as count
                  FROM "Battle"
                  WHERE "guildsJson"::jsonb @> $1::jsonb
                `,
                  JSON.stringify([{name: guild.name}])
                )
              ]);
            }
            
            // Extract count from the result
            const totalCount = Number((total as any[])[0].count);

            // Process battles and calculate duration
            const processedBattles = await Promise.all((battles as any[]).map(async (battle: any) => {
              const guildsData = battle.guildsJson as Array<{
                name: string;
                kills?: number;
                deaths?: number;
              }>;
              const guildData = guildsData.find(g => g.name === guild.name);
              const otherGuilds = guildsData.filter(g => g.name !== guild.name);

              // Calculate duration based on first and last kill
              let duration = 'Unknown';
              try {
                const killEvents = await prisma.killEvent.findMany({
                  where: { battleAlbionId: battle.albionId },
                  orderBy: { TimeStamp: 'asc' },
                  select: { TimeStamp: true }
                });

                if (killEvents.length > 0) {
                  const firstKill = killEvents[0].TimeStamp;
                  const lastKill = killEvents[killEvents.length - 1].TimeStamp;
                  const durationMs = lastKill.getTime() - firstKill.getTime();
                  const durationMinutes = Math.round(durationMs / (1000 * 60));
                  duration = `${durationMinutes} minutes`;
                }
              } catch (error) {
                console.warn('Could not calculate duration for battle', battle.albionId, error);
              }

              return {
                id: battle.albionId.toString(),
                date: battle.startedAt.toISOString(),
                guildName: guild.name,
                guildKills: guildData?.kills || 0,
                guildDeaths: guildData?.deaths || 0,
                totalFame: battle.totalFame,
                totalKills: battle.totalKills,
                totalPlayers: battle.totalPlayers,
                duration,
                detailsUrl: `https://albionbb.com/battles/${battle.albionId.toString()}`,
                opponents: otherGuilds.map(g => ({
                  name: g.name,
                  kills: g.kills || 0,
                  deaths: g.deaths || 0
                }))
              };
            }));

            return {
              data: processedBattles,
              page,
              pageSize,
              total: totalCount,
              hasMore: page * pageSize < totalCount
            };
        //   },
        //   { ttl: 30 } // Short TTL to avoid long-term caching issues
        // );
      } catch (error) {
        console.error('Error fetching guild battles:', error);
        throw new Error('Failed to fetch guild battles');
      }
    }),

  // Get MMR calculation logs for battles in a specific time range (for prime time battles)
  getPrimeTimeBattles: publicProc
    .input(z.object({
      guildId: z.string(),
      startHour: z.number().min(0).max(23),
      endHour: z.number().min(0).max(23),
      seasonId: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20)
    }))
    .query(async ({ input }) => {
      const { guildId, startHour, endHour, seasonId, page, pageSize } = input;
      
      try {
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

        // Get guild name
        const guild = await prisma.guild.findUnique({ where: { id: guildId } });
        if (!guild) {
          throw new Error('Guild not found');
        }

        // Get season data to determine the date range
        const season = await prisma.season.findUnique({
          where: { id: targetSeasonId }
        });
        if (!season) {
          throw new Error('Season not found');
        }

        // Get MMR calculation logs for battles during prime time hours throughout the season
        // We need to filter by hour of day, not specific dates
        const [logs, total] = await Promise.all([
          prisma.mmrCalculationLog.findMany({
            where: {
              guildId,
              seasonId: targetSeasonId,
              processedAt: {
                gte: season.startDate,
                lte: season.endDate || new Date()
              },
              // Filter by hour of day for prime time
              ...(endHour < startHour ? {
                // Overnight window (e.g., 22:00 to 02:00)
                OR: [
                  {
                    processedAt: {
                      gte: season.startDate,
                      lte: season.endDate || new Date()
                    }
                  }
                ]
              } : {
                // Same day window - we'll filter by hour in the application logic
              })
            },
            include: {
              season: true,
              guild: true
            },
            orderBy: { processedAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize * 3 // Get more to account for hour filtering
          }),
          prisma.mmrCalculationLog.count({
            where: {
              guildId,
              seasonId: targetSeasonId,
              processedAt: {
                gte: season.startDate,
                lte: season.endDate || new Date()
              }
            }
          })
        ]);

        // Filter logs by hour of day for prime time
        const filteredLogs = logs.filter(log => {
          const logHour = log.processedAt.getUTCHours();
          
          if (endHour < startHour) {
            // Overnight window (e.g., 22:00 to 02:00)
            return logHour >= startHour || logHour < endHour;
          } else {
            // Same day window (e.g., 20:00 to 22:00)
            return logHour >= startHour && logHour < endHour;
          }
        }).slice(0, pageSize); // Limit to page size after filtering

        console.log(`🔍 Prime time filtering: ${startHour}:00-${endHour}:00 UTC`);
        console.log(`📊 Found ${logs.length} total logs, ${filteredLogs.length} after hour filtering`);
        if (filteredLogs.length > 0) {
          console.log(`⏰ Sample log hours:`, filteredLogs.slice(0, 3).map(log => ({
            hour: log.processedAt.getUTCHours(),
            date: log.processedAt.toISOString()
          })));
        }

        // Group logs by battle ID to get battle summaries
        const battleMap = new Map();
        filteredLogs.forEach(log => {
          if (!battleMap.has(log.battleId)) {
            battleMap.set(log.battleId, {
              battleId: log.battleId.toString(),
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
          
          const battle = battleMap.get(log.battleId);
          battle.guilds.push({
            guildId: log.guildId,
            guildName: log.guildName,
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
        });

        const battles = Array.from(battleMap.values());

        return {
          data: battles,
          page,
          pageSize,
          total: battles.length,
          hasMore: false, // We're filtering in memory, so pagination is simplified
          timeRange: {
            startHour,
            endHour,
            startTime: season.startDate.toISOString(),
            endTime: (season.endDate || new Date()).toISOString()
          },
          guild: {
            id: guild.id,
            name: guild.name
          }
        };
      } catch (error) {
        console.error('Error fetching prime time battles:', error);
        throw new Error('Failed to fetch prime time battles');
      }
    })
});
