import { router, publicProc } from "../trpc";
import { z } from "zod";
import { prisma } from "../db";
import { apiCache, CACHE_TTL } from "../cache";

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
    }),

  get: publicProc
    .input(z.object({
      id: z.string()
    }))
    .query(async ({ input }) => {
      const { id } = input;
      
      try {
        return await apiCache.getOrSet(
          'seasons',
          ['get', input],
          async () => {
            const season = await prisma.season.findUnique({
              where: { id }
            });

            if (!season) {
              throw new Error('Season not found');
            }

            return {
              id: season.id,
              name: season.name,
              description: season.name, // Use name as description for now
              status: season.isActive ? 'active' as const : 'completed' as const,
              endDate: season.endDate?.toISOString() || new Date().toISOString()
            };
          },
          { ttl: CACHE_TTL.SEASONS }
        );
      } catch (error) {
        console.error('Error fetching season:', error);
        throw new Error('Failed to fetch season');
      }
    })
});
