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
      const meetsCriteria = this.meetsMmrCriteria(totalPlayers, totalFame);
      
      if (!meetsCriteria) {
        logger.debug('Battle does not meet MMR criteria', {
          battleId: battleId.toString(),
          totalPlayers,
          totalFame
        });
        return null;
      }

      // Extract guild statistics from kills data
      const guildStats = await this.extractGuildStats(battleId, killsData, battleData);

      // Filter out guilds with insignificant participation
      const { MmrService } = await import('./mmr.js');
      
      // Create a temporary battle analysis for filtering
      const tempBattleAnalysis = {
        battleId: battleId,
        seasonId: season.id,
        guildStats,
        totalPlayers,
        totalFame,
        battleDuration,
        isPrimeTime: await this.seasonService.isPrimeTime(season.id, battleDate),
        killClustering: this.calculateKillClustering(killsData),
        friendGroups: this.detectFriendGroups(guildStats, killsData)
      };
      
      const significantGuildStats = guildStats.filter(guildStat => {
        const hasSignificantParticipation = MmrService.hasSignificantParticipation(guildStat, tempBattleAnalysis);
        return hasSignificantParticipation;
      });

      // Check if we have enough guilds for meaningful MMR calculation
      if (significantGuildStats.length < 2) {
        logger.debug('Not enough guilds for MMR calculation', {
          battleId: battleId.toString(),
          guildCount: significantGuildStats.length
        });
        return null;
      }

      // Calculate prime time status
      const isPrimeTime = await this.seasonService.isPrimeTime(season.id, battleDate);

      // Calculate kill clustering
      const killClustering = this.calculateKillClustering(killsData);

      // Detect friend groups
      const friendGroups = this.detectFriendGroups(significantGuildStats, killsData);

      // Get current MMR for all guilds
      const guildStatsWithMmr = await this.addCurrentMmrToGuildStats(significantGuildStats, season.id);

      // Extract alliance data from battle data and kills data
      const guildAlliances = this.extractGuildAlliances(battleData, killsData);

      const battleAnalysis: BattleAnalysis = {
        battleId,
        seasonId: season.id,
        guildStats: guildStatsWithMmr,
        totalPlayers,
        totalFame,
        battleDuration,
        isPrimeTime,
        killClustering,
        friendGroups,
        guildAlliances
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
   * Extract guild statistics from battle data
   * Uses the guildsJson array from battle data
   */
  private async extractGuildStats(
    _battleId: bigint,
    killsData: any[],
    battleData: any
  ): Promise<GuildBattleStats[]> {
    const guildStats: GuildBattleStats[] = [];

    try {
      // guildsJson is always an array of objects
      if (!battleData.guildsJson || !Array.isArray(battleData.guildsJson)) {
        logger.warn('guildsJson is not available or not an array', { 
          hasGuildsJson: !!battleData.guildsJson,
          isArray: Array.isArray(battleData.guildsJson)
        });
        return [];
      }

      const guildsData = battleData.guildsJson.map((guild: any) => ({
        name: guild.name || '',
        kills: guild.kills || 0,
        deaths: guild.deaths || 0,
        killFame: guild.killFame || 0,
        players: guild.players || 0,
        ip: guild.ip || 1000,
        albionId: guild.albionId || ''
      }));

      logger.debug('Parsed guildsJson array', { 
        guildCount: guildsData.length,
        sampleGuild: guildsData[0] ? {
          name: guildsData[0].name,
          players: guildsData[0].players,
          ip: guildsData[0].ip
        } : null
      });

      // Process each guild from battle data
      for (const guild of guildsData) {
        if (!guild.name || typeof guild.name !== 'string') {
          continue;
        }

        // Get or create guild in database using albionId if available
        const guildEntity = await this.findGuildByIdOrName(guild.albionId, guild.name);
        
        // Use guild IP directly from guildsJson, but handle 0 values
        const avgIP = guild.ip > 0 ? guild.ip : 1000;

        // Create guild stats from guildsJson data
        const guildStat: GuildBattleStats = {
          guildName: guild.name,
          guildId: guildEntity.id,
          kills: guild.kills,
          deaths: guild.deaths,
          fameGained: guild.killFame,
          fameLost: 0, // Will be calculated from kills data if needed
          players: guild.players,
          avgIP: avgIP,
          isPrimeTime: false, // Will be set later
          currentMmr: 1000.0 // Will be updated later
        };

        // Log the extracted guild data for debugging
        logger.debug('Extracted guild stats from guildsJson', {
          guildName: guild.name,
          players: guild.players,
          avgIP: guild.ip,
          finalAvgIP: avgIP,
          kills: guild.kills,
          deaths: guild.deaths,
          killFame: guild.killFame
        });

        // Calculate fame lost from kills data
        if (killsData.length > 0) {
          const guildKills = killsData.filter(kill => 
            this.extractGuildFromKill(kill, 'killer') === guild.name ||
            this.extractGuildFromKill(kill, 'victim') === guild.name
          );
          
          // Calculate fame lost from kills where this guild was the victim
          const fameLost = guildKills
            .filter(kill => this.extractGuildFromKill(kill, 'victim') === guild.name)
            .reduce((sum, kill) => sum + (kill.TotalVictimKillFame || 0), 0);
          
          guildStat.fameLost = fameLost;
        }

        guildStats.push(guildStat);
      }

      logger.info('Extracted guild stats from battle data', {
        totalGuilds: guildStats.length,
        guildsWithPlayers: guildStats.filter(g => g.players > 0).length,
        guildsWithIP: guildStats.filter(g => g.avgIP > 1000).length,
        sampleGuild: guildStats[0] ? {
          name: guildStats[0].guildName,
          players: guildStats[0].players,
          avgIP: guildStats[0].avgIP,
          kills: guildStats[0].kills,
          deaths: guildStats[0].deaths
        } : null
      });

      return guildStats;

    } catch (error) {
      logger.error('Error extracting guild stats from battle data', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return [];
    }
  }

  /**
   * Extract guild name from kill data
   * Handles both raw API response format and processed database format
   */
  private extractGuildFromKill(kill: any, role: 'killer' | 'victim'): string | null {
    if (role === 'killer') {
      // Try processed database format first
      if (kill.killerGuild) {
        return kill.killerGuild;
      }
      // Try raw API response format
      if (kill.Killer?.GuildName) {
        return kill.Killer.GuildName;
      }
      return null;
    } else {
      // Try processed database format first
      if (kill.victimGuild) {
        return kill.victimGuild;
      }
      // Try raw API response format
      if (kill.Victim?.GuildName) {
        return kill.Victim.GuildName;
      }
      return null;
    }
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
   * Find guild by ID or name, creating it if necessary
   */
  private async findGuildByIdOrName(albionId: string, guildName: string): Promise<any> {
    try {
      // First try to find by ID
      let guild = await this.prisma.guild.findUnique({
        where: { id: albionId }
      });

      if (guild) {
        logger.debug('Found guild by ID', { albionId, guildName: guild.name });
        return guild;
      }

      // If not found by ID, try by name
      guild = await this.prisma.guild.findUnique({
        where: { name: guildName }
      });

      if (guild) {
        logger.debug('Found guild by name', { albionId, guildName: guild.name });
        return guild;
      }

      // If not found, create new guild with the albionId
      logger.info('Creating new guild with albionId', { albionId, guildName });
      return await this.prisma.guild.create({
        data: {
          id: albionId,
          name: guildName
        }
      });
    } catch (error) {
      logger.error('Error in findGuildByIdOrName', {
        albionId,
        guildName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Fallback to regular guild service
      return await this.guildService.getOrCreateGuild(guildName);
    }
  }

  /**
   * Extract guild alliances from battle data and kills data
   */
  private extractGuildAlliances(battleData: any, killsData: any[]): Map<string, string> {
    const guildAlliances = new Map<string, string>();

    try {
      // First try to get alliances from battle data guilds (API response format)
      if (battleData.guilds && Array.isArray(battleData.guilds)) {
        for (const guild of battleData.guilds) {
          if (guild.name && guild.alliance) {
            guildAlliances.set(guild.name, guild.alliance);
          }
        }
      }
      
      // Then try to get alliances from guildsJson
      if (battleData.guildsJson && typeof battleData.guildsJson === 'object') {
        const guildsJson = battleData.guildsJson;
        if (Array.isArray(guildsJson)) {
          for (const guild of guildsJson) {
            if (guild.name && guild.alliance) {
              guildAlliances.set(guild.name, guild.alliance);
            }
          }
        } else {
          // Handle object format
          for (const [key, guildInfo] of Object.entries(guildsJson)) {
            const guildName = (guildInfo as any).name || (guildInfo as any).Name || key;
            const alliance = (guildInfo as any).alliance || (guildInfo as any).Alliance;
            if (guildName && alliance) {
              guildAlliances.set(guildName, alliance);
            }
          }
        }
      }

      // Also extract alliances from players array (API response format)
      if (battleData.players && Array.isArray(battleData.players)) {
        for (const player of battleData.players) {
          if (player.guildName && player.allianceName) {
            guildAlliances.set(player.guildName, player.allianceName);
          }
        }
      }

      // Finally, extract from kills data as fallback
      for (const kill of killsData) {
        // Try processed database format first
        if (kill.killerGuild && kill.killerAlliance) {
          guildAlliances.set(kill.killerGuild, kill.killerAlliance);
        }
        if (kill.victimGuild && kill.victimAlliance) {
          guildAlliances.set(kill.victimGuild, kill.victimAlliance);
        }
        
        // Try raw API response format
        if (kill.Killer?.GuildName && kill.Killer?.AllianceName) {
          guildAlliances.set(kill.Killer.GuildName, kill.Killer.AllianceName);
        }
        if (kill.Victim?.GuildName && kill.Victim?.AllianceName) {
          guildAlliances.set(kill.Victim.GuildName, kill.Victim.AllianceName);
        }
      }

      return guildAlliances;

    } catch (error) {
      logger.error('Error extracting guild alliances', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return new Map();
    }
  }

  /**
   * Fetch battle data for MMR calculation from database (now with complete data)
   */
  async fetchBattleDataForMmr(battleId: bigint): Promise<{ battle: any; kills: any[] } | null> {
    try {
      // Fetch battle data from database (now contains complete guild/alliance data)
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
        playerCount: battle.totalPlayers,
        guildCount: Array.isArray(battle.guildsJson) ? battle.guildsJson.length : 0,
        allianceCount: Array.isArray(battle.alliancesJson) ? battle.alliancesJson.length : 0,
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
