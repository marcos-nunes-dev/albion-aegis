import { z } from 'zod';

// MMR System Schemas

// Season Schema
export const zSeason = z.object({
  id: z.string().cuid(),
  name: z.string(),
  startDate: z.date(),
  endDate: z.date().nullable(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date()
});

// Prime Time Window Schema
export const zPrimeTimeWindow = z.object({
  id: z.string().cuid(),
  seasonId: z.string().cuid(),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
  timezone: z.string().default("UTC"),
  createdAt: z.date()
});

// Guild Schema
export const zGuild = z.object({
  id: z.string(), // AlbionBB guild ID
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// Guild Season Schema
export const zGuildSeason = z.object({
  id: z.string().cuid(),
  guildId: z.string(),
  seasonId: z.string().cuid(),
  currentMmr: z.number().default(1000.0),
  previousSeasonMmr: z.number().nullable(),
  totalBattles: z.number().int().min(0).default(0),
  wins: z.number().int().min(0).default(0),
  losses: z.number().int().min(0).default(0),
  totalFameGained: z.bigint().default(0n),
  totalFameLost: z.bigint().default(0n),
  avgPrimeTimeMass: z.number().nullable(),
  primeTimeBattles: z.number().int().min(0).default(0),
  lastBattleAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// MMR Calculation Job Schema
export const zMmrCalculationJob = z.object({
  id: z.string().cuid(),
  battleId: z.bigint(),
  seasonId: z.string().cuid(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRY']).default('PENDING'),
  attempts: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(0).default(3),
  error: z.string().nullable(),
  processedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// MMR Job Status Enum
export const zMmrJobStatus = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRY']);

// Guild Search Response Schema (from AlbionBB API)
export const zGuildSearchResponse = z.array(z.object({
  Id: z.string(),
  Name: z.string()
}));

// MMR Calculation Input Schema
export const zMmrCalculationInput = z.object({
  battleId: z.bigint(),
  seasonId: z.string().cuid(),
  guildStats: z.array(z.object({
    guildName: z.string(),
    guildId: z.string(),
    kills: z.number().int().min(0),
    deaths: z.number().int().min(0),
    fameGained: z.number().int().min(0),
    fameLost: z.number().int().min(0),
    players: z.number().int().min(0),
    avgIP: z.number().min(0),
    isPrimeTime: z.boolean(),
    currentMmr: z.number().default(1000.0)
  }))
});

// Inferred TypeScript Types
export type Season = z.infer<typeof zSeason>;
export type PrimeTimeWindow = z.infer<typeof zPrimeTimeWindow>;
export type Guild = z.infer<typeof zGuild>;
export type GuildSeason = z.infer<typeof zGuildSeason>;
export type MmrCalculationJob = z.infer<typeof zMmrCalculationJob>;
export type MmrJobStatus = z.infer<typeof zMmrJobStatus>;
export type GuildSearchResponse = z.infer<typeof zGuildSearchResponse>;
export type MmrCalculationInput = z.infer<typeof zMmrCalculationInput>;

// Helper functions for parsing
export const safeParseGuildSearchResponse = (data: unknown): GuildSearchResponse | null => {
  const result = zGuildSearchResponse.safeParse(data);
  return result.success ? result.data : null;
};
