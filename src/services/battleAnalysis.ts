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
      console.log(`🏆 [BATTLE-ANALYSIS] Creating battle analysis for battle ${battleId}`);
      logger.info('Creating battle analysis', { battleId: battleId.toString() });

      // Extract basic battle information
      const totalPlayers = this.extractTotalPlayers(battleData);
      const totalFame = this.extractTotalFame(battleData);
      const battleDuration = this.calculateBattleDuration(battleData, killsData);
      const battleDate = this.extractBattleDate(battleData);

      console.log(`📊 [BATTLE-ANALYSIS] Battle ${battleId} stats: ${totalPlayers} players, ${totalFame} fame, ${battleDuration} min duration`);

      // Get active season for battle date
      console.log(`🏆 [BATTLE-ANALYSIS] Getting season for battle date: ${battleDate}`);
      const season = await this.seasonService.getSeasonAtDate(battleDate);
      if (!season) {
        console.log(`❌ [BATTLE-ANALYSIS] No active season found for battle ${battleId} date: ${battleDate}`);
        logger.warn('No active season found for battle date', {
          battleId: battleId.toString(),
          battleDate
        });
        return null;
      }

      console.log(`✅ [BATTLE-ANALYSIS] Found active season: ${season.name} (${season.id})`);

      // Check if battle meets MMR criteria
      const meetsCriteria = this.meetsMmrCriteria(totalPlayers, totalFame);
      console.log(`📋 [BATTLE-ANALYSIS] MMR criteria check for battle ${battleId}: ${meetsCriteria ? 'PASS' : 'FAIL'} (${totalPlayers} players, ${totalFame} fame)`);
      
      if (!meetsCriteria) {
        console.log(`❌ [BATTLE-ANALYSIS] Battle ${battleId} does not meet MMR criteria`);
        logger.debug('Battle does not meet MMR criteria', {
          battleId: battleId.toString(),
          totalPlayers,
          totalFame
        });
        return null;
      }

      // Extract guild statistics from kills data
      console.log(`🏆 [BATTLE-ANALYSIS] Extracting guild stats for battle ${battleId}`);
      const guildStats = await this.extractGuildStats(battleId, killsData, battleData);

      console.log(`📊 [BATTLE-ANALYSIS] Found ${guildStats.length} guilds in battle ${battleId}`);

      // Filter out guilds with insignificant participation
      console.log(`🏆 [BATTLE-ANALYSIS] Filtering guilds with insignificant participation`);
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
        if (!hasSignificantParticipation) {
          console.log(`⚠️ [BATTLE-ANALYSIS] Filtering out guild ${guildStat.guildName} - insignificant participation (${guildStat.kills} kills, ${guildStat.deaths} deaths, ${guildStat.fameGained} fame gained, ${guildStat.fameLost} fame lost, ${guildStat.players} players)`);
        }
        return hasSignificantParticipation;
      });

      // Check if we have enough guilds for meaningful MMR calculation
      if (significantGuildStats.length < 2) {
        console.log(`❌ [BATTLE-ANALYSIS] Not enough guilds (${significantGuildStats.length}) for MMR calculation in battle ${battleId}`);
        logger.debug('Not enough guilds for MMR calculation', {
          battleId: battleId.toString(),
          guildCount: significantGuildStats.length
        });
        return null;
      }

      // Calculate prime time status
      console.log(`🏆 [BATTLE-ANALYSIS] Checking prime time status for battle ${battleId}`);
      const isPrimeTime = await this.seasonService.isPrimeTime(season.id, battleDate);
      console.log(`📊 [BATTLE-ANALYSIS] Battle ${battleId} prime time: ${isPrimeTime}`);

      // Calculate kill clustering
      console.log(`🏆 [BATTLE-ANALYSIS] Calculating kill clustering for battle ${battleId}`);
      const killClustering = this.calculateKillClustering(killsData);
      console.log(`📊 [BATTLE-ANALYSIS] Battle ${battleId} kill clustering score: ${killClustering}`);

      // Detect friend groups
      console.log(`🏆 [BATTLE-ANALYSIS] Detecting friend groups for battle ${battleId}`);
      const friendGroups = this.detectFriendGroups(significantGuildStats, killsData);
      console.log(`📊 [BATTLE-ANALYSIS] Battle ${battleId} friend groups: ${friendGroups.length}`);

      // Get current MMR for all guilds
      console.log(`🏆 [BATTLE-ANALYSIS] Getting current MMR for guilds in battle ${battleId}`);
      const guildStatsWithMmr = await this.addCurrentMmrToGuildStats(significantGuildStats, season.id);
      console.log(`📊 [BATTLE-ANALYSIS] Added MMR data for ${guildStatsWithMmr.length} guilds in battle ${battleId}`);

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

      console.log(`✅ [BATTLE-ANALYSIS] Successfully created battle analysis for battle ${battleId}`);
      console.log(`   - Season: ${season.name} (${season.id})`);
      console.log(`   - Guilds: ${guildStatsWithMmr.length}`);
      console.log(`   - Players: ${totalPlayers}`);
      console.log(`   - Fame: ${totalFame}`);
      console.log(`   - Prime time: ${isPrimeTime}`);
      console.log(`   - Duration: ${battleDuration} min`);
      console.log(`   - Kill clustering: ${killClustering}`);

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
   * Uses the guilds list from battle data instead of parsing kills
   */
  private async extractGuildStats(
    _battleId: bigint,
    killsData: any[],
    battleData: any
  ): Promise<GuildBattleStats[]> {
    const guildStats: GuildBattleStats[] = [];

    try {
      // Get guilds from battle data
      let guildsData: any[] = [];
      
      // First try the raw battle data guilds array (from API response)
      if (battleData.guilds && Array.isArray(battleData.guilds)) {
        guildsData = battleData.guilds;
        console.log(`📊 [BATTLE-ANALYSIS] Using guilds from battle data: ${guildsData.length} guilds`);
      }
      // Then try the processed guildsJson (from database)
      else if (battleData.guildsJson && typeof battleData.guildsJson === 'object') {
        // Convert guildsJson object to array format
        const guildsJson = battleData.guildsJson;
        
        // Check if guildsJson is an array (from API response) or object (from database)
        if (Array.isArray(guildsJson)) {
          // The guildsJson contains corrupted data with numeric names, so we need to extract guild names from kills
          console.log(`⚠️ [BATTLE-ANALYSIS] guildsJson contains corrupted data with numeric names, extracting from kills data`);
          guildsData = [];
        } else {
          // Handle object format - extract guild names properly
          guildsData = Object.entries(guildsJson).map(([key, guildInfo]: [string, any]) => {
            // The key might be a number, so we need to get the actual guild name from the guildInfo
            const guildName = guildInfo.name || guildInfo.Name || key;
            return {
              name: guildName,
              kills: guildInfo.kills || guildInfo.Kills || 0,
              deaths: guildInfo.deaths || guildInfo.Deaths || 0,
              killFame: guildInfo.killFame || guildInfo.KillFame || 0,
              players: guildInfo.players || guildInfo.Players || 0,
              ip: guildInfo.ip || guildInfo.IP || 1000
            };
          });
          console.log(`📊 [BATTLE-ANALYSIS] Using guilds from guildsJson object: ${guildsData.length} guilds`);
        }
      }
      
      // If no guilds found in battle data, extract from kills data as fallback
      if (guildsData.length === 0) {
        console.log(`⚠️ [BATTLE-ANALYSIS] No guilds found in battle data, extracting from kills data as fallback`);
        
        // Extract unique guild names from kills data
        const guildNames = new Set<string>();
        const guildKillStats = new Map<string, { kills: number; deaths: number; fameGained: number; fameLost: number }>();
        
        for (const kill of killsData) {
          const killerGuild = this.extractGuildFromKill(kill, 'killer');
          const victimGuild = this.extractGuildFromKill(kill, 'victim');
          
          if (killerGuild) {
            guildNames.add(killerGuild);
            const stats = guildKillStats.get(killerGuild) || { kills: 0, deaths: 0, fameGained: 0, fameLost: 0 };
            stats.kills++;
            stats.fameGained += kill.TotalVictimKillFame || 0;
            guildKillStats.set(killerGuild, stats);
          }
          
          if (victimGuild) {
            guildNames.add(victimGuild);
            const stats = guildKillStats.get(victimGuild) || { kills: 0, deaths: 0, fameGained: 0, fameLost: 0 };
            stats.deaths++;
            stats.fameLost += kill.TotalVictimKillFame || 0;
            guildKillStats.set(victimGuild, stats);
          }
        }
        
        // Convert to guildsData format
        guildsData = Array.from(guildNames).map(guildName => {
          const stats = guildKillStats.get(guildName) || { kills: 0, deaths: 0, fameGained: 0, fameLost: 0 };
          return {
            name: guildName,
            kills: stats.kills,
            deaths: stats.deaths,
            killFame: stats.fameGained,
            players: 0, // We don't have player count from kills data
            ip: 1000 // Default IP
          };
        });
        
        console.log(`📊 [BATTLE-ANALYSIS] Extracted ${guildsData.length} guilds from kills data:`, Array.from(guildNames));
      }

      // Process each guild from battle data
      for (const guild of guildsData) {
        if (!guild.name || typeof guild.name !== 'string') {
          console.log(`⚠️ [BATTLE-ANALYSIS] Skipping guild with invalid name:`, guild);
          continue;
        }

        // Get or create guild in database
        const guildEntity = await this.guildService.getOrCreateGuild(guild.name);
        
        // Calculate average IP from kills data for this guild
        const avgIP = this.calculateAverageIP(guild.name, killsData);

        // Create guild stats from battle data
        const guildStat: GuildBattleStats = {
          guildName: guild.name,
          guildId: guildEntity.id,
          kills: guild.kills || 0,
          deaths: guild.deaths || 0,
          fameGained: guild.killFame || 0,
          fameLost: 0, // Will be calculated from kills data if needed
          players: guild.players || 0,
          avgIP: guild.ip || avgIP || 1000,
          isPrimeTime: false, // Will be set later
          currentMmr: 1000.0 // Will be updated later
        };

        // If we have kills data, we can cross-reference to get more accurate fame lost
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
        
        console.log(`📊 [BATTLE-ANALYSIS] Processed guild ${guild.name}: ${guildStat.kills} kills, ${guildStat.deaths} deaths, ${guildStat.fameGained} fame gained, ${guildStat.fameLost} fame lost, ${guildStat.players} players`);
      }

      console.log(`✅ [BATTLE-ANALYSIS] Successfully processed ${guildStats.length} guilds from battle data`); 
      return guildStats;

    } catch (error) {
      console.error(`❌ [BATTLE-ANALYSIS] Error extracting guild stats:`, error);
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
   * Calculate average IP for a guild
   * Handles both raw API response format and processed database format
   */
  private calculateAverageIP(guildName: string, killsData: any[]): number {
    const guildKills = killsData.filter(kill => 
      this.extractGuildFromKill(kill, 'killer') === guildName ||
      this.extractGuildFromKill(kill, 'victim') === guildName
    );

    if (guildKills.length === 0) return 1000; // Default IP

    const totalIP = guildKills.reduce((sum, kill) => {
      // Try processed database format first
      let killerIP = kill.killerAvgIP;
      let victimIP = kill.victimAvgIP;
      
      // Try raw API response format if database format not found
      if (killerIP === undefined && kill.Killer?.AverageItemPower !== undefined) {
        killerIP = kill.Killer.AverageItemPower;
      }
      if (victimIP === undefined && kill.Victim?.AverageItemPower !== undefined) {
        victimIP = kill.Victim.AverageItemPower;
      }
      
      // Use defaults if still undefined
      killerIP = killerIP || 1000;
      victimIP = victimIP || 1000;
      
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
   * Extract guild alliances from battle data and kills data
   */
  private extractGuildAlliances(battleData: any, killsData: any[]): Map<string, string> {
    const guildAlliances = new Map<string, string>();

    try {
      // First try to get alliances from battle data guilds
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

      console.log(`📊 [BATTLE-ANALYSIS] Extracted ${guildAlliances.size} guild alliances`);
      return guildAlliances;

    } catch (error) {
      console.error(`❌ [BATTLE-ANALYSIS] Error extracting guild alliances:`, error);
      return new Map();
    }
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
