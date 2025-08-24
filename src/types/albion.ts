import { z } from 'zod';

// Helper function to safely convert string to BigInt (removed - not needed for number inputs)
// const safeBigIntTransform = (val: string) => {
//   try {
//     return BigInt(val);
//   } catch {
//     throw new Error(`Invalid BigInt value: ${val}`);
//   }
// };

// Battle List Item Schema (matching actual API response)
export const zBattleListItem = z.object({
  albionId: z.number().transform(val => BigInt(val)), // Convert to BigInt for database
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  totalFame: z.number().int().nonnegative(),
  totalKills: z.number().int().nonnegative(),
  totalPlayers: z.number().int().positive(),
  alliances: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    tag: z.string().optional(),
    killFame: z.number().int().nonnegative(),
    deathFame: z.number().int().nonnegative().optional(),
    players: z.number().int().nonnegative().optional()
  })).optional().default([]),
  guilds: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    alliance: z.string().optional(),
    killFame: z.number().int().nonnegative(),
    deathFame: z.number().int().nonnegative().optional(),
    players: z.number().int().nonnegative().optional()
  })).optional().default([])
});

// Battle List Response Schema
export const zBattleListResponse = z.array(zBattleListItem);

// Battle Detail Schema (what we get from /battles/{id})
export const zBattleDetail = z.object({
  albionId: z.number().transform(val => BigInt(val)),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  totalFame: z.number().int().nonnegative(),
  totalKills: z.number().int().nonnegative(),
  totalPlayers: z.number().int().positive(),
  alliances: z.array(z.object({
    albionId: z.string().optional(),
    name: z.string().optional(),
    kills: z.number().int().nonnegative().optional(),
    deaths: z.number().int().nonnegative().optional(),
    killFame: z.number().int().nonnegative(),
    players: z.number().int().nonnegative().optional(),
    ip: z.number().nonnegative().optional()
  })).optional().default([]),
  guilds: z.array(z.object({
    albionId: z.string().optional(),
    name: z.string().optional(),
    alliance: z.string().optional(),
    kills: z.number().int().nonnegative().optional(),
    deaths: z.number().int().nonnegative().optional(),
    killFame: z.number().int().nonnegative(),
    players: z.number().int().nonnegative().optional(),
    ip: z.number().nonnegative().optional()
  })).optional().default([]),
  players: z.array(z.object({
    name: z.string().max(48),
    guildName: z.string().max(64).optional(),
    allianceName: z.string().max(16).optional(),
    kills: z.number().int().nonnegative(),
    deaths: z.number().int().nonnegative(),
    killFame: z.number().int().nonnegative(),
    deathFame: z.number().int().nonnegative(),
    ip: z.number().nonnegative(),
    heal: z.number().nonnegative().optional(),
    damage: z.number().nonnegative().optional(),
    role: z.string().optional(),
    weapon: z.object({
      name: z.string(),
      type: z.string(),
      quality: z.number().int().positive()
    }).optional()
  })).optional().default([])
});

// Kill Event Schema (from /battles/kills endpoint)
export const zKillEvent = z.object({
  EventId: z.number().transform(val => BigInt(val)),
  TimeStamp: z.string().datetime(),
  TotalVictimKillFame: z.number().int().nonnegative(),
  Killer: z.object({
    Id: z.string(),
    Name: z.string().max(48),
    GuildName: z.string().max(64).optional(),
    AllianceName: z.string().max(16).optional(),
    AverageItemPower: z.number().nonnegative(),
    Equipment: z.object({
      MainHand: z.object({
        Name: z.string(),
        Type: z.string(),
        Quality: z.number().int().positive()
      }).optional(),
      Mount: z.object({
        Name: z.string(),
        Type: z.string(),
        Quality: z.number().int().positive()
      }).nullable().optional()
    }).optional()
  }),
  Victim: z.object({
    Id: z.string(),
    Name: z.string().max(48),
    GuildName: z.string().max(64).optional(),
    AllianceName: z.string().max(16).optional(),
    AverageItemPower: z.number().nonnegative(),
    Equipment: z.object({
      MainHand: z.object({
        Name: z.string(),
        Type: z.string(),
        Quality: z.number().int().positive()
      }).optional(),
      Mount: z.object({
        Name: z.string(),
        Type: z.string(),
        Quality: z.number().int().positive()
      }).nullable().optional()
    }).optional()
  })
});

// Kill Events Response Schema
export const zKillEventsResponse = z.array(zKillEvent);

// For backward compatibility, we can create a "kill event" from player data
export const zPlayerKillEvent = z.object({
  playerName: z.string().max(48),
  guildName: z.string().max(64).optional(),
  allianceName: z.string().max(16).optional(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  killFame: z.number().int().nonnegative(),
  deathFame: z.number().int().nonnegative(),
  averageItemPower: z.number().nonnegative(),
  weapon: z.object({
    name: z.string(),
    type: z.string(),
    quality: z.number().int().positive()
  }).optional()
});

// Service State Schema (for internal use)
export const zServiceState = z.object({
  key: z.string(),
  value: z.string(),
  updatedAt: z.date()
});

// Error Response Schema
export const zErrorResponse = z.object({
  error: z.string(),
  message: z.string().optional(),
  code: z.number().optional()
});

// API Rate Limit Response Schema
export const zRateLimitResponse = z.object({
  retryAfter: z.number().optional(),
  remaining: z.number().optional(),
  reset: z.number().optional()
});

// Inferred TypeScript Types
export type BattleListItem = z.infer<typeof zBattleListItem>;
export type BattleListResponse = z.infer<typeof zBattleListResponse>;
export type BattleDetail = z.infer<typeof zBattleDetail>;
export type KillEvent = z.infer<typeof zKillEvent>;
export type KillEventsResponse = z.infer<typeof zKillEventsResponse>;
export type PlayerKillEvent = z.infer<typeof zPlayerKillEvent>;
export type ServiceState = z.infer<typeof zServiceState>;
export type ErrorResponse = z.infer<typeof zErrorResponse>;
export type RateLimitResponse = z.infer<typeof zRateLimitResponse>;

// Helper functions for parsing
export const parseBattleList = (data: unknown): BattleListResponse => {
  return zBattleListResponse.parse(data);
};

export const parseBattleDetail = (data: unknown): BattleDetail => {
  return zBattleDetail.parse(data);
};

export const parseBattleListItem = (data: unknown): BattleListItem => {
  return zBattleListItem.parse(data);
};

export const parseKillEvents = (data: unknown): KillEventsResponse => {
  return zKillEventsResponse.parse(data);
};

export const parseKillEvent = (data: unknown): KillEvent => {
  return zKillEvent.parse(data);
};

export const parsePlayerKillEvent = (data: unknown): PlayerKillEvent => {
  return zPlayerKillEvent.parse(data);
};

// Safe parsing functions (returns null on error)
export const safeParseBattleList = (data: unknown): BattleListResponse | null => {
  const result = zBattleListResponse.safeParse(data);
  return result.success ? result.data : null;
};

export const safeParseBattleDetail = (data: unknown): BattleDetail | null => {
  const result = zBattleDetail.safeParse(data);
  return result.success ? result.data : null;
};

export const safeParseKillEvents = (data: unknown): KillEventsResponse | null => {
  const result = zKillEventsResponse.safeParse(data);
  return result.success ? result.data : null;
};
