// Common API response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
    totalPages: number;
  };
}

// Error types
export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

// Health check types
export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
}

export interface DetailedHealthStatus extends HealthStatus {
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
    memory: {
      rss: string;
      heapTotal: string;
      heapUsed: string;
      external: string;
    };
  };
}

// Battle types
export interface BattleListItem {
  albionId: string;
  startedAt: string;
  endedAt?: string;
  totalFame: number;
  totalKills: number;
  totalPlayers: number;
  guilds: GuildInfo[];
  alliances: AllianceInfo[];
}

export interface BattleDetail extends BattleListItem {
  guilds: GuildDetail[];
  alliances: AllianceDetail[];
  players: PlayerInfo[];
}

export interface GuildInfo {
  id?: string;
  name?: string;
  alliance?: string;
  killFame: number;
  deathFame?: number;
  players?: number;
}

export interface GuildDetail extends GuildInfo {
  kills?: number;
  deaths?: number;
  ip?: number;
}

export interface AllianceInfo {
  id?: string;
  name?: string;
  tag?: string;
  killFame: number;
  deathFame?: number;
  players?: number;
}

export interface AllianceDetail extends AllianceInfo {
  kills?: number;
  deaths?: number;
  ip?: number;
}

export interface PlayerInfo {
  name: string;
  guildName?: string;
  allianceName?: string;
  kills: number;
  deaths: number;
  killFame: number;
  deathFame: number;
  ip: number;
  heal?: number;
  damage?: number;
  role?: string;
  weapon?: WeaponInfo;
}

export interface WeaponInfo {
  name: string;
  type: string;
  quality: number;
}

// MMR types
export interface GuildMmr {
  guildName: string;
  seasonId: string;
  mmr: number;
  rank: number;
  totalBattles: number;
  wins: number;
  losses: number;
  winRate: number;
  lastUpdated: string;
}

export interface Season {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  isActive: boolean;
  totalGuilds: number;
  totalBattles: number;
}

export interface MmrStats {
  totalGuilds: number;
  averageMmr: number;
  highestMmr: number;
  lowestMmr: number;
  totalBattles: number;
  lastCalculation: string;
}

// Search types
export interface GuildSearchResult {
  guilds: GuildInfo[];
  searchTerm: string;
  total: number;
}

// Statistics types
export interface BattleStats {
  totalBattles: number;
  totalFame: number;
  totalKills: number;
  averagePlayers: number;
  recentBattles: number;
}
