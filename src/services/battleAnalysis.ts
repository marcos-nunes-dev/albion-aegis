import { PrismaClient } from '@prisma/client';
import { log } from '../log.js';
import { SeasonService } from './season.js';
import { GuildService } from './guild.js';
import type { BattleAnalysis, GuildBattleStats } from './mmr.js';

const logger = log.child({ component: 'battle-analysis' });

export class BattleAnalysisService {
  private prisma: PrismaClient;
  private seasonService: SeasonService;
  private guildService: GuildService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.seasonService = new SeasonService(prisma);
    this.guildService = new GuildService(prisma);
  }

  /**
   * Create battle analysis from battle and kills data
   */
  async createBattleAnalysis(
    battleId: bigint,
    battleData: any,
    killsData: any[]
  ): Promise<BattleAnalysis | null> {
    try {
      logger.info('Creating battle analysis', { battleId: battleId.toString() });

      // Extract basic battle information
      const totalPlayers = this.extractTotalPlayers(battleData);
      const totalFame = this.extractTotalFame(battleData);
      const battleDuration = this.calculateBattleDuration(battleData, killsData);
      const battleDate = this.extractBattleDate(battleData);

      // Get active season for battle date
      const season = await this.seasonService.getSeasonAtDate(battleDate);
      if (!season) {
        logger.warn('No active season found for battle date', {
          battleId: battleId.toString(),
          battleDate
        });
        return null;
      }

      // Check if battle meets MMR criteria
      if (!this.meetsMmrCriteria(totalPlayers, totalFame)) {
        logger.debug('Battle does not meet MMR criteria', {
          battleId: battleId.toString(),
          totalPlayers,
          totalFame
        });
        return null;
      }

      // Extract guild statistics from kills data
      const guildStats = await this.extractGuildStats(battleId, killsData, battleData);

      // Check if we have enough guilds for meaningful MMR calculation
      if (guildStats.length < 2) {
        logger.debug('Not enough guilds for MMR calculation', {
          battleId: battleId.toString(),
          guildCount: guildStats.length
        });
        return null;
      }

      // Calculate prime time status
      const isPrimeTime = await this.seasonService.isPrimeTime(season.id, battleDate);

      // Calculate kill clustering
      const killClustering = this.calculateKillClustering(killsData);

      // Detect friend groups
      const friendGroups = this.detectFriendGroups(guildStats, killsData);

      // Get current MMR for all guilds
      const guildStatsWithMmr = await this.addCurrentMmrToGuildStats(guildStats, season.id);

      const battleAnalysis: BattleAnalysis = {
        battleId,
        seasonId: season.id,
        guildStats: guildStatsWithMmr,
        totalPlayers,
        totalFame,
        battleDuration,
        isPrimeTime,
        killClustering,
        friendGroups
      };

      logger.info('Successfully created battle analysis', {
        battleId: battleId.toString(),
        guildCount: guildStatsWithMmr.length,
        totalPlayers,
        totalFame,
        isPrimeTime
      });

      return battleAnalysis;

    } catch (error) {
      logger.error('Error creating battle analysis', {
        battleId: battleId.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      return null;
    }
  }

  /**
   * Extract total players from battle data
   */
  private extractTotalPlayers(battleData: any): number {
    // Use the accurate totalPlayers from battle data
    if (battleData.totalPlayers && typeof battleData.totalPlayers === 'number') {
      return battleData.totalPlayers;
    }
    return 0;
  }

  /**
   * Extract total fame from battle data
   */
  private extractTotalFame(battleData: any): number {
    // Based on your Battle model schema
    if (battleData.totalFame) return battleData.totalFame;
    return 0;
  }

  /**
   * Calculate battle duration in minutes based on kill event timestamps
   * Uses the time difference between first and last kill events
   */
  private calculateBattleDuration(_battleData: any, killsData: any[]): number {
    if (killsData.length === 0) {
      return 30; // Default duration if no kills
    }

    // Sort kills by timestamp to find first and last
    const sortedKills = killsData
      .filter(kill => kill.TimeStamp)
      .sort((a, b) => new Date(a.TimeStamp).getTime() - new Date(b.TimeStamp).getTime());

    if (sortedKills.length < 2) {
      return 30; // Default duration if only one kill
    }

    const firstKillTime = new Date(sortedKills[0].TimeStamp).getTime();
    const lastKillTime = new Date(sortedKills[sortedKills.length - 1].TimeStamp).getTime();
    
    const durationMs = lastKillTime - firstKillTime;
    const durationMinutes = Math.max(1, Math.floor(durationMs / (1000 * 60))); // Minimum 1 minute

    logger.debug('Calculated battle duration from kill events', {
      firstKillTime: new Date(firstKillTime).toISOString(),
      lastKillTime: new Date(lastKillTime).toISOString(),
      durationMinutes,
      killCount: sortedKills.length
    });

    return durationMinutes;
  }

  /**
   * Extract battle date
   */
  private extractBattleDate(battleData: any): Date {
    // Based on your Battle model schema - use startedAt
    if (battleData.startedAt) return new Date(battleData.startedAt);
    return new Date(); // Current date as fallback
  }

  /**
   * Check if battle meets MMR calculation criteria
   */
  private meetsMmrCriteria(totalPlayers: number, totalFame: number): boolean {
    return totalPlayers >= 25 && totalFame >= 2000000;
  }



  /**
   * Extract guild statistics from kills data
   */
  private async extractGuildStats(
    _battleId: bigint,
    killsData: any[],
    battleData: any
  ): Promise<GuildBattleStats[]> {
    const guildStatsMap = new Map<string, GuildBattleStats>();

    // Extract guild player counts from battle data
    const guildPlayerCounts = new Map<string, number>();
    try {
      if (battleData.guildsJson && typeof battleData.guildsJson === 'object') {
        // Parse guildsJson to get accurate player counts per guild
        const guildsData = battleData.guildsJson;
        for (const [guildName, guildInfo] of Object.entries(guildsData)) {
          if (typeof guildInfo === 'object' && guildInfo !== null && 'Players' in guildInfo) {
            guildPlayerCounts.set(guildName, (guildInfo as any).Players || 0);
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to parse guildsJson for player counts', { error });
    }

    // Process each kill to build guild statistics
    for (const kill of killsData) {
      const killerGuild = this.extractGuildFromKill(kill, 'killer');
      const victimGuild = this.extractGuildFromKill(kill, 'victim');

      if (killerGuild) {
        await this.updateGuildStats(guildStatsMap, killerGuild, {
          kills: 1,
          fameGained: kill.TotalVictimKillFame || 0,
          players: guildPlayerCounts.get(killerGuild) || 0
        });
      }

      if (victimGuild) {
        await this.updateGuildStats(guildStatsMap, victimGuild, {
          deaths: 1,
          fameLost: kill.TotalVictimKillFame || 0,
          players: guildPlayerCounts.get(victimGuild) || 0
        });
      }
    }

    // Convert map to array and add missing data
    const guildStats: GuildBattleStats[] = [];
    for (const [guildName, stats] of guildStatsMap) {
      // Get or create guild in database
      const guild = await this.guildService.getOrCreateGuild(guildName);
      
      // Calculate average IP (placeholder - implement based on your data)
      const avgIP = this.calculateAverageIP(guildName, killsData);

      guildStats.push({
        guildName,
        guildId: guild.id,
        kills: stats.kills || 0,
        deaths: stats.deaths || 0,
        fameGained: stats.fameGained || 0,
        fameLost: stats.fameLost || 0,
        players: stats.players || 0,
        avgIP,
        isPrimeTime: false, // Will be set later
        currentMmr: 1000.0 // Will be updated later
      });
    }

    return guildStats;
  }

  /**
   * Extract guild name from kill data
   */
  private extractGuildFromKill(kill: any, role: 'killer' | 'victim'): string | null {
    // Based on your KillEvent model schema
    if (role === 'killer') {
      return kill.killerGuild || null;
    } else {
      return kill.victimGuild || null;
    }
  }

  /**
   * Update guild statistics
   */
  private async updateGuildStats(
    guildStatsMap: Map<string, GuildBattleStats>,
    guildName: string,
    update: Partial<GuildBattleStats>
  ): Promise<void> {
    const existing = guildStatsMap.get(guildName);
    if (existing) {
      guildStatsMap.set(guildName, {
        ...existing,
        kills: (existing.kills || 0) + (update.kills || 0),
        deaths: (existing.deaths || 0) + (update.deaths || 0),
        fameGained: (existing.fameGained || 0) + (update.fameGained || 0),
        fameLost: (existing.fameLost || 0) + (update.fameLost || 0),
        players: Math.max(existing.players || 0, update.players || 0)
      });
    } else {
      guildStatsMap.set(guildName, {
        guildName,
        guildId: '', // Will be set later when guild is created
        kills: update.kills || 0,
        deaths: update.deaths || 0,
        fameGained: update.fameGained || 0,
        fameLost: update.fameLost || 0,
        players: update.players || 0,
        avgIP: 0, // Will be calculated later
        isPrimeTime: false,
        currentMmr: 1000.0
      });
    }
  }

  /**
   * Calculate average IP for a guild
   */
  private calculateAverageIP(guildName: string, killsData: any[]): number {
    // Based on your KillEvent model schema - use killerAvgIP and victimAvgIP
    const guildKills = killsData.filter(kill => 
      this.extractGuildFromKill(kill, 'killer') === guildName ||
      this.extractGuildFromKill(kill, 'victim') === guildName
    );

    if (guildKills.length === 0) return 1000; // Default IP

    const totalIP = guildKills.reduce((sum, kill) => {
      const killerIP = kill.killerAvgIP || 1000;
      const victimIP = kill.victimAvgIP || 1000;
      return sum + killerIP + victimIP;
    }, 0);

    return Math.round(totalIP / (guildKills.length * 2));
  }

  /**
   * Calculate kill clustering score - improved algorithm
   */
  private calculateKillClustering(killsData: any[]): number {
    if (killsData.length < 2) return 0;

    // Sort kills by timestamp
    const sortedKills = killsData
      .filter(kill => kill.TimeStamp)
      .sort((a, b) => new Date(a.TimeStamp).getTime() - new Date(b.TimeStamp).getTime());

    if (sortedKills.length < 2) return 0;

    const battleStartTime = new Date(sortedKills[0].TimeStamp).getTime();
    const battleEndTime = new Date(sortedKills[sortedKills.length - 1].TimeStamp).getTime();
    const battleDuration = (battleEndTime - battleStartTime) / (1000 * 60); // in minutes

    let totalClusteringScore = 0;

    // 1. Analyze rapid kill sequences (30-second windows)
    const rapidKillScore = this.analyzeRapidKills(sortedKills, 30);
    
    // 2. Analyze coordinated attacks (2-minute windows)
    const coordinatedAttackScore = this.analyzeCoordinatedAttacks(sortedKills, 120);
    
    // 3. Analyze high-value kill clusters (fame-based)
    const highValueScore = this.analyzeHighValueKills(sortedKills);
    
    // 4. Analyze kill streaks (consecutive kills by same guild)
    const killStreakScore = this.analyzeKillStreaks(sortedKills);

    // Combine scores with weights
    totalClusteringScore = 
      (rapidKillScore * 0.3) +           // 30% weight for rapid kills
      (coordinatedAttackScore * 0.3) +   // 30% weight for coordinated attacks
      (highValueScore * 0.25) +          // 25% weight for high-value kills
      (killStreakScore * 0.15);          // 15% weight for kill streaks

    // Normalize based on battle duration and size
    const normalizationFactor = Math.min(1, battleDuration / 10); // Longer battles get more weight
    const normalizedScore = totalClusteringScore * normalizationFactor;

    logger.debug('Calculated kill clustering score', {
      rapidKillScore,
      coordinatedAttackScore,
      highValueScore,
      killStreakScore,
      totalClusteringScore,
      battleDuration,
      normalizationFactor,
      normalizedScore
    });

    return Math.round(normalizedScore);
  }

  /**
   * Analyze rapid kill sequences within a time window
   */
  private analyzeRapidKills(sortedKills: any[], windowSeconds: number): number {
    let rapidKillCount = 0;
    const windowMs = windowSeconds * 1000;

    for (let i = 0; i < sortedKills.length - 1; i++) {
      const currentTime = new Date(sortedKills[i].TimeStamp).getTime();
      const nextTime = new Date(sortedKills[i + 1].TimeStamp).getTime();
      
      if (nextTime - currentTime <= windowMs) {
        rapidKillCount++;
      }
    }

    return rapidKillCount;
  }

  /**
   * Analyze coordinated attacks (multiple guilds killing in sequence)
   */
  private analyzeCoordinatedAttacks(sortedKills: any[], windowSeconds: number): number {
    let coordinatedScore = 0;
    const windowMs = windowSeconds * 1000;

    for (let i = 0; i < sortedKills.length - 2; i++) {
      const time1 = new Date(sortedKills[i].TimeStamp).getTime();
      const time3 = new Date(sortedKills[i + 2].TimeStamp).getTime();

      // Check if 3 kills happened within the window
      if (time3 - time1 <= windowMs) {
        const guild1 = this.extractGuildFromKill(sortedKills[i], 'killer');
        const guild2 = this.extractGuildFromKill(sortedKills[i + 1], 'killer');
        const guild3 = this.extractGuildFromKill(sortedKills[i + 2], 'killer');

        // If different guilds are killing in sequence, it's coordinated
        if (guild1 && guild2 && guild3 && guild1 !== guild2 && guild2 !== guild3) {
          coordinatedScore += 2; // Higher weight for coordinated attacks
        } else if (guild1 && guild2 && guild1 !== guild2) {
          coordinatedScore += 1;
        }
      }
    }

    return coordinatedScore;
  }

  /**
   * Analyze high-value kill clusters (fame-based)
   */
  private analyzeHighValueKills(sortedKills: any[]): number {
    let highValueScore = 0;
    const highValueThreshold = 100000; // 100K fame threshold

    // Find clusters of high-value kills
    for (let i = 0; i < sortedKills.length - 1; i++) {
      const currentKill = sortedKills[i];
      const nextKill = sortedKills[i + 1];
      
      const currentFame = currentKill.TotalVictimKillFame || 0;
      const nextFame = nextKill.TotalVictimKillFame || 0;
      
      const currentTime = new Date(currentKill.TimeStamp).getTime();
      const nextTime = new Date(nextKill.TimeStamp).getTime();
      
      // If two high-value kills happen within 60 seconds
      if (currentFame >= highValueThreshold && 
          nextFame >= highValueThreshold && 
          nextTime - currentTime <= 60000) {
        highValueScore += (currentFame + nextFame) / 100000; // Weight by total fame
      }
    }

    return highValueScore;
  }

  /**
   * Analyze kill streaks (consecutive kills by same guild)
   */
  private analyzeKillStreaks(sortedKills: any[]): number {
    let maxStreak = 0;
    let currentStreak = 0;
    let currentGuild = '';

    for (const kill of sortedKills) {
      const killerGuild = this.extractGuildFromKill(kill, 'killer');
      
      if (killerGuild === currentGuild) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 1;
        currentGuild = killerGuild || '';
      }
    }

    return maxStreak;
  }

  /**
   * Detect friend groups (guilds fighting together)
   */
  private detectFriendGroups(guildStats: GuildBattleStats[], killsData: any[]): string[][] {
    const friendGroups: string[][] = [];
    const processedGuilds = new Set<string>();

    for (const guildStat of guildStats) {
      if (processedGuilds.has(guildStat.guildName)) continue;

      const friendGroup = [guildStat.guildName];
      processedGuilds.add(guildStat.guildName);

      // Find guilds that have minimal kills/deaths against this guild
      for (const otherGuildStat of guildStats) {
        if (guildStat.guildName === otherGuildStat.guildName) continue;
        if (processedGuilds.has(otherGuildStat.guildName)) continue;

        const crossKills = this.countCrossKills(guildStat.guildName, otherGuildStat.guildName, killsData);
        const totalKills = guildStat.kills + otherGuildStat.kills;

        // If cross-kills are less than 10% of total kills, consider them friends
        if (totalKills > 0 && crossKills / totalKills < 0.1) {
          friendGroup.push(otherGuildStat.guildName);
          processedGuilds.add(otherGuildStat.guildName);
        }
      }

      if (friendGroup.length > 1) {
        friendGroups.push(friendGroup);
      }
    }

    return friendGroups;
  }

  /**
   * Count kills between two guilds
   */
  private countCrossKills(guild1: string, guild2: string, killsData: any[]): number {
    return killsData.filter(kill => {
      const killerGuild = this.extractGuildFromKill(kill, 'killer');
      const victimGuild = this.extractGuildFromKill(kill, 'victim');
      
      return (killerGuild === guild1 && victimGuild === guild2) ||
             (killerGuild === guild2 && victimGuild === guild1);
    }).length;
  }

  /**
   * Add current MMR to guild stats
   */
  private async addCurrentMmrToGuildStats(
    guildStats: GuildBattleStats[],
    seasonId: string
  ): Promise<GuildBattleStats[]> {
    const { MmrService } = await import('./mmr.js');
    const mmrService = new MmrService(this.prisma);

    return Promise.all(
      guildStats.map(async (guildStat) => {
        try {
          const currentMmr = await mmrService.getGuildSeasonMmr(guildStat.guildId, seasonId);
          return {
            ...guildStat,
            currentMmr: currentMmr?.currentMmr ?? 1000.0
          };
        } catch (error) {
          logger.warn('Error getting MMR for guild, using default', {
            guildId: guildStat.guildId,
            guildName: guildStat.guildName,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          return {
            ...guildStat,
            currentMmr: 1000.0
          };
        }
      })
    );
  }

  /**
   * Fetch battle data for MMR calculation from database
   */
  async fetchBattleDataForMmr(battleId: bigint): Promise<{ battle: any; kills: any[] } | null> {
    try {
      // Fetch battle data from your Battle model
      const battle = await this.prisma.battle.findUnique({
        where: { albionId: battleId }
      });
      
      if (!battle) {
        logger.warn('Battle not found for MMR calculation', {
          battleId: battleId.toString()
        });
        return null;
      }

      // Fetch kill events for this battle
      const kills = await this.prisma.killEvent.findMany({
        where: { battleAlbionId: battleId },
        orderBy: { TimeStamp: 'asc' }
      });

      logger.info('Fetched battle data for MMR calculation', {
        battleId: battleId.toString(),
        battleFound: !!battle,
        killCount: kills.length
      });
      
      return {
        battle,
        kills
      };
    } catch (error) {
      logger.error('Error fetching battle data for MMR', {
        battleId: battleId.toString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }
}
