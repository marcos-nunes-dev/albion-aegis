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
          battleDate: battleDate.toISOString()
        });
        return null;
      }
      
      logger.debug('Found active season for battle', {
        battleId: battleId.toString(),
        seasonId: season.id,
        seasonName: season.name
      });

      // Check if battle meets MMR criteria
      const meetsCriteria = this.meetsMmrCriteria(totalPlayers, totalFame);
      
      if (!meetsCriteria) {
        logger.warn('Battle does not meet MMR criteria', {
          battleId: battleId.toString(),
          totalPlayers,
          totalFame,
          minPlayersRequired: 25,
          minFameRequired: 2000000
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
        killClustering: 0, // Placeholder - will be calculated per guild
        friendGroups: this.detectFriendGroups(guildStats, killsData)
      };
      
      const significantGuildStats = guildStats.filter(guildStat => {
        const hasSignificantParticipation = MmrService.hasSignificantParticipation(guildStat, tempBattleAnalysis);
        return hasSignificantParticipation;
      });

      // Check if we have enough guilds for meaningful MMR calculation
      if (significantGuildStats.length < 2) {
        logger.warn('Not enough guilds for MMR calculation', {
          battleId: battleId.toString(),
          totalGuilds: guildStats.length,
          significantGuilds: significantGuildStats.length,
          minRequired: 2
        });
        return null;
      }

      // Calculate prime time status
      const isPrimeTime = await this.seasonService.isPrimeTime(season.id, battleDate);

      // Calculate kill clustering per guild (will be done in extractGuildStats)

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
        killClustering: 0, // Will be calculated per guild, this is just a placeholder
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

        // Calculate kill clustering for this specific guild
        const guildKillClustering = this.calculateGuildKillClustering(guild.name, killsData);

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
          currentMmr: 1000.0, // Will be updated later
          killClustering: guildKillClustering // Per-guild kill clustering score
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
   * Calculate kill clustering score for a specific guild - improved algorithm
   */
  private calculateGuildKillClustering(guildName: string, killsData: any[]): number {
    if (killsData.length < 2) return 0;

    // Filter kills for this specific guild (kills where this guild was the killer)
    const guildKills = killsData.filter(kill => 
      this.extractGuildFromKill(kill, 'killer') === guildName
    );

    if (guildKills.length === 0) return 0;
    if (guildKills.length === 1) return 1; // Single kill gets base score

    // Sort kills by timestamp
    const sortedKills = guildKills
      .filter(kill => kill.TimeStamp)
      .sort((a, b) => new Date(a.TimeStamp).getTime() - new Date(b.TimeStamp).getTime());

    if (sortedKills.length === 0) return 0;
    if (sortedKills.length === 1) return 1;

    const battleStartTime = new Date(sortedKills[0].TimeStamp).getTime();
    const battleEndTime = new Date(sortedKills[sortedKills.length - 1].TimeStamp).getTime();
    const battleDuration = (battleEndTime - battleStartTime) / (1000 * 60); // in minutes

    let totalClusteringScore = 0;

    // Base score for number of kills (more kills = higher base score)
    const baseKillScore = Math.min(10, sortedKills.length * 2); // 2 points per kill, max 10

    // 1. Analyze rapid kill sequences (30-second windows)
    const rapidKillScore = this.analyzeRapidKills(sortedKills, 30);
    
    // 2. Analyze coordinated attacks (2-minute windows)
    const coordinatedAttackScore = this.analyzeCoordinatedAttacks(sortedKills, 120);
    
    // 3. Analyze high-value kill clusters (fame-based)
    const highValueScore = this.analyzeHighValueKills(sortedKills);
    
    // 4. Analyze kill streaks (consecutive kills by same guild)
    const killStreakScore = this.analyzeKillStreaks(sortedKills);

    // 5. Analyze kill timing patterns (how spread out the kills are)
    const timingPatternScore = this.analyzeKillTimingPatterns(sortedKills);

    // Combine scores with weights
    totalClusteringScore = 
      baseKillScore +                           // Base score for number of kills
      (rapidKillScore * 0.25) +                 // 25% weight for rapid kills
      (coordinatedAttackScore * 0.2) +          // 20% weight for coordinated attacks
      (highValueScore * 0.2) +                  // 20% weight for high-value kills
      (killStreakScore * 0.15) +                // 15% weight for kill streaks
      (timingPatternScore * 0.2);               // 20% weight for timing patterns

    // Normalize based on battle duration (longer battles get slight bonus)
    const durationBonus = Math.min(0.5, battleDuration / 20); // Max 0.5 bonus
    const finalScore = totalClusteringScore + durationBonus;

    logger.debug('Calculated kill clustering score', {
      guildName,
      killCount: sortedKills.length,
      baseKillScore,
      rapidKillScore,
      coordinatedAttackScore,
      highValueScore,
      killStreakScore,
      timingPatternScore,
      totalClusteringScore,
      battleDuration,
      durationBonus,
      finalScore
    });

    return Math.round(finalScore);
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
   * For guild-specific clustering, this becomes less relevant since we're only looking at one guild's kills
   */
  private analyzeCoordinatedAttacks(sortedKills: any[], windowSeconds: number): number {
    let coordinatedScore = 0;
    const windowMs = windowSeconds * 1000;

    // For guild-specific clustering, we look for rapid kill sequences by the same guild
    // This indicates the guild was actively engaged in combat
    for (let i = 0; i < sortedKills.length - 1; i++) {
      const time1 = new Date(sortedKills[i].TimeStamp).getTime();
      const time2 = new Date(sortedKills[i + 1].TimeStamp).getTime();

      // Check if 2 kills happened within the window
      if (time2 - time1 <= windowMs) {
        coordinatedScore += 1; // Each rapid kill sequence adds to the score
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
   * Since we're now analyzing guild-specific kills, this becomes the total number of kills
   * as all kills in the filtered data are from the same guild
   */
  private analyzeKillStreaks(sortedKills: any[]): number {
    // Since all kills are from the same guild, the streak is the total number of kills
    return sortedKills.length;
  }

  /**
   * Analyze kill timing patterns (how spread out the kills are)
   * This rewards guilds that have more complex timing patterns
   */
  private analyzeKillTimingPatterns(sortedKills: any[]): number {
    if (sortedKills.length < 2) return 0;

    const timestamps = sortedKills.map(kill => new Date(kill.TimeStamp).getTime());
    const intervals = [];

    // Calculate time intervals between kills
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    // Calculate variance in timing (more variance = more complex pattern)
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const variance = intervals.reduce((sum, interval) => sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
    
    // Normalize variance to a reasonable score (0-5 range)
    const timingScore = Math.min(5, Math.sqrt(variance) / 10000); // Adjust divisor as needed

    return timingScore;
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
  public extractGuildAlliances(battleData: any, killsData: any[]): Map<string, string> {
    const guildAlliances = new Map<string, string>();

    try {
      logger.debug('Extracting guild alliances', {
        battleDataKeys: Object.keys(battleData || {}),
        killsDataLength: killsData?.length || 0,
        hasGuilds: !!(battleData?.guilds),
        hasGuildsJson: !!(battleData?.guildsJson),
        hasAlliancesJson: !!(battleData?.alliancesJson),
        hasPlayers: !!(battleData?.players),
        guildsJsonType: typeof battleData?.guildsJson,
        alliancesJsonType: typeof battleData?.alliancesJson
      });

      // First try to get alliances from battle data guilds (API response format)
      if (battleData.guilds && Array.isArray(battleData.guilds)) {
        logger.debug('Processing battleData.guilds', { guildsCount: battleData.guilds.length });
        for (const guild of battleData.guilds) {
          if (guild.name && guild.alliance) {
            guildAlliances.set(guild.name, guild.alliance);
            logger.debug('Found alliance from battleData.guilds', { guildName: guild.name, alliance: guild.alliance });
          }
        }
      }
      
      // Then try to get alliances from guildsJson
      if (battleData.guildsJson) {
        let guildsJson;
        
        // Handle both string and object formats
        if (typeof battleData.guildsJson === 'string') {
          try {
            guildsJson = JSON.parse(battleData.guildsJson);
            logger.debug('Parsed guildsJson from string', { 
              originalType: typeof battleData.guildsJson,
              parsedType: typeof guildsJson,
              isArray: Array.isArray(guildsJson)
            });
          } catch (error) {
            logger.warn('Failed to parse guildsJson string', { 
              error: error instanceof Error ? error.message : 'Unknown error',
              guildsJson: battleData.guildsJson
            });
            guildsJson = null;
          }
        } else if (typeof battleData.guildsJson === 'object') {
          guildsJson = battleData.guildsJson;
          logger.debug('Using guildsJson as object', { 
            isArray: Array.isArray(guildsJson),
            keys: Array.isArray(guildsJson) ? guildsJson.length : Object.keys(guildsJson).length
          });
        }
        
        if (guildsJson) {
          if (Array.isArray(guildsJson)) {
            for (const guild of guildsJson) {
              if (guild.name && guild.alliance) {
                guildAlliances.set(guild.name, guild.alliance);
                logger.debug('Found alliance from guildsJson array', { guildName: guild.name, alliance: guild.alliance });
              }
            }
          } else {
            // Handle object format
            for (const [key, guildInfo] of Object.entries(guildsJson)) {
              const guildName = (guildInfo as any).name || (guildInfo as any).Name || key;
              const alliance = (guildInfo as any).alliance || (guildInfo as any).Alliance;
              if (guildName && alliance) {
                guildAlliances.set(guildName, alliance);
                logger.debug('Found alliance from guildsJson object', { guildName, alliance });
              }
            }
          }
        }
      }

      // Also extract alliances from players array (API response format)
      if (battleData.players && Array.isArray(battleData.players)) {
        logger.debug('Processing battleData.players', { playersCount: battleData.players.length });
        for (const player of battleData.players) {
          if (player.guildName && player.allianceName) {
            guildAlliances.set(player.guildName, player.allianceName);
            logger.debug('Found alliance from players', { guildName: player.guildName, alliance: player.allianceName });
          }
        }
      }

      // Finally, extract from kills data as fallback
      logger.debug('Processing kills data for alliances', { killsCount: killsData.length });
      for (const kill of killsData) {
        // Try processed database format first
        if (kill.killerGuild && kill.killerAlliance) {
          guildAlliances.set(kill.killerGuild, kill.killerAlliance);
          logger.debug('Found alliance from kill (processed)', { guildName: kill.killerGuild, alliance: kill.killerAlliance });
        }
        if (kill.victimGuild && kill.victimAlliance) {
          guildAlliances.set(kill.victimGuild, kill.victimAlliance);
          logger.debug('Found alliance from kill (processed)', { guildName: kill.victimGuild, alliance: kill.victimAlliance });
        }
        
        // Try raw API response format
        if (kill.Killer?.GuildName && kill.Killer?.AllianceName) {
          guildAlliances.set(kill.Killer.GuildName, kill.Killer.AllianceName);
          logger.debug('Found alliance from kill (raw)', { guildName: kill.Killer.GuildName, alliance: kill.Killer.AllianceName });
        }
        if (kill.Victim?.GuildName && kill.Victim?.AllianceName) {
          guildAlliances.set(kill.Victim.GuildName, kill.Victim.AllianceName);
          logger.debug('Found alliance from kill (raw)', { guildName: kill.Victim.GuildName, alliance: kill.Victim.AllianceName });
        }
      }

      logger.info('Guild alliances extraction completed', {
        totalAlliancesFound: guildAlliances.size,
        alliances: Array.from(guildAlliances.entries())
      });

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

  /**
   * Detect gaps in battle sequence and identify potentially missing battles
   * This helps catch battles that were processed late by AlbionBB API
   */
  async detectBattleGaps(
    startTime: Date,
    endTime: Date,
    maxGapMinutes: number = 30
  ): Promise<Array<{ gapStart: Date; gapEnd: Date; estimatedMissingBattles: number }>> {
    try {
      logger.info('Detecting battle gaps', {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        maxGapMinutes
      });

      // Get battles in time range, ordered by startedAt
      const battles = await this.prisma.battle.findMany({
        where: {
          startedAt: {
            gte: startTime,
            lte: endTime
          }
        },
        select: {
          startedAt: true,
          totalPlayers: true,
          totalFame: true
        },
        orderBy: {
          startedAt: 'asc'
        }
      });

      if (battles.length < 2) {
        logger.debug('Not enough battles to detect gaps', { battleCount: battles.length });
        return [];
      }

      const gaps: Array<{ gapStart: Date; gapEnd: Date; estimatedMissingBattles: number }> = [];
      const maxGapMs = maxGapMinutes * 60 * 1000;

      // Analyze gaps between consecutive battles
      for (let i = 0; i < battles.length - 1; i++) {
        const currentBattle = battles[i];
        const nextBattle = battles[i + 1];
        const gapMs = nextBattle.startedAt.getTime() - currentBattle.startedAt.getTime();

        if (gapMs > maxGapMs) {
          // Calculate estimated missing battles based on average battle frequency
          const avgBattleInterval = this.calculateAverageBattleInterval(battles, i);
          const estimatedMissingBattles = Math.floor(gapMs / avgBattleInterval);

          gaps.push({
            gapStart: currentBattle.startedAt,
            gapEnd: nextBattle.startedAt,
            estimatedMissingBattles
          });

          logger.info('Battle gap detected', {
            gapStart: currentBattle.startedAt.toISOString(),
            gapEnd: nextBattle.startedAt.toISOString(),
            gapMinutes: Math.round(gapMs / (60 * 1000)),
            estimatedMissingBattles
          });
        }
      }

      return gaps;
    } catch (error) {
      logger.error('Failed to detect battle gaps', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Calculate average battle interval around a specific index
   */
  private calculateAverageBattleInterval(
    battles: Array<{ startedAt: Date }>,
    centerIndex: number,
    windowSize: number = 10
  ): number {
    const startIndex = Math.max(0, centerIndex - windowSize);
    const endIndex = Math.min(battles.length - 1, centerIndex + windowSize);
    
    if (endIndex <= startIndex) {
      return 5 * 60 * 1000; // Default 5 minutes if not enough data
    }

    let totalInterval = 0;
    let intervalCount = 0;

    for (let i = startIndex; i < endIndex; i++) {
      const interval = battles[i + 1].startedAt.getTime() - battles[i].startedAt.getTime();
      totalInterval += interval;
      intervalCount++;
    }

    return intervalCount > 0 ? totalInterval / intervalCount : 5 * 60 * 1000;
  }

  /**
   * Get battles that might have been missed due to API processing delays
   * This performs a deeper scan in identified gap areas
   */
  async findPotentiallyMissingBattles(
    gapStart: Date,
    gapEnd: Date,
    minPlayers: number = 10
  ): Promise<Array<{ albionId: bigint; startedAt: Date; reason: string }>> {
    try {
      logger.info('Searching for potentially missing battles', {
        gapStart: gapStart.toISOString(),
        gapEnd: gapEnd.toISOString(),
        minPlayers
      });

      // This would integrate with your HTTP client to search AlbionBB API
      // for battles in the gap period that weren't in your database
      const { getBattlesPage } = await import('../http/client.js');
      
      const missingBattles: Array<{ albionId: bigint; startedAt: Date; reason: string }> = [];
      
      // Search multiple pages to find battles in the gap
      for (let page = 0; page < 5; page++) { // Limit to 5 pages to avoid excessive API calls
        try {
          const battles = await getBattlesPage(page, minPlayers);
          
          for (const battle of battles) {
            const battleTime = new Date(battle.startedAt);
            
            // Check if this battle falls within our gap
            if (battleTime >= gapStart && battleTime <= gapEnd) {
              // Check if we already have this battle in our database
              const existingBattle = await this.prisma.battle.findUnique({
                where: { albionId: battle.albionId },
                select: { albionId: true }
              });

              if (!existingBattle) {
                missingBattles.push({
                  albionId: battle.albionId,
                  startedAt: battleTime,
                  reason: 'Found in gap search'
                });
              }
            }
          }
        } catch (error) {
          logger.warn('Failed to search page for missing battles', {
            page,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          break; // Stop searching if we hit API issues
        }
      }

      logger.info('Missing battles search completed', {
        gapStart: gapStart.toISOString(),
        gapEnd: gapEnd.toISOString(),
        missingBattlesFound: missingBattles.length
      });

      return missingBattles;
    } catch (error) {
      logger.error('Failed to find potentially missing battles', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }
}
