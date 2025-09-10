import { router, publicProc } from "../trpc.js";
import { z } from "zod";
import { prisma } from "../db.js";
import { apiCache, CACHE_TTL } from "../cache.js";

export const seasonsRouter = router({
  getActive: publicProc
    .query(async () => {
      try {
        return await apiCache.getOrSet(
          'seasons',
          ['getActive'],
          async () => {
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
          },
          { ttl: CACHE_TTL.SEASONS }
        );
      } catch (error) {
        console.error('Error fetching active season:', error);
        throw new Error('Failed to fetch active season');
      }
    }),

  list: publicProc
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20)
    }).optional())
    .query(async ({ input }) => {
      const { page = 1, pageSize = 20 } = input || {};
      
      try {
        return await apiCache.getOrSet(
          'seasons',
          ['list', input || {}],
          async () => {
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
          },
          { ttl: CACHE_TTL.SEASONS }
        );
      } catch (error) {
        console.error('Error fetching seasons:', error);
        throw new Error('Failed to fetch seasons');
      }
    })
});
