import { PrismaClient } from '@prisma/client';
import { log } from '../log.js';
import type { GuildSeason } from '../types/mmr.js';

const logger = log.child({ component: 'mmr-service' });

// MMR calculation constants
const MMR_CONSTANTS = {
  BASE_MMR: 1000.0,
  K_FACTOR: 32, // How much MMR can change in a single battle
  WIN_LOSS_WEIGHT: 0.4, // 40% weight for win/loss
  FAME_WEIGHT: 0.2, // 20% weight for fame differential
  PLAYER_COUNT_WEIGHT: 0.1, // 10% weight for player count advantage
  IP_WEIGHT: 0.1, // 10% weight for IP level differences
  BATTLE_SIZE_WEIGHT: 0.05, // 5% weight for battle size
  KD_RATIO_WEIGHT: 0.05, // 5% weight for kill/death ratio
  BATTLE_DURATION_WEIGHT: 0.05, // 5% weight for battle duration
  KILL_CLUSTERING_WEIGHT: 0.05, // 5% weight for kill clustering
  OPPONENT_MMR_WEIGHT: 0.1, // 10% weight for opponent MMR strength
  FRIEND_DETECTION_THRESHOLD: 0.1, // 10% of total kills to consider as friend
  MIN_BATTLE_SIZE: 25, // Minimum players for MMR calculation
  MIN_BATTLE_FAME: 2000000, // Minimum fame for MMR calculation (2M)
  SEASON_CARRYOVER_RATIO: 0.3, // 30% of previous season MMR carries over
} as const;

export interface GuildBattleStats {
  guildName: string;
  guildId: string;
  kills: number;
  deaths: number;
  fameGained: number;
  fameLost: number;
  players: number;
  avgIP: number;
  isPrimeTime: boolean;
  currentMmr: number;
  previousSeasonMmr?: number;
}

export interface BattleAnalysis {
  battleId: bigint;
  seasonId: string;
  guildStats: GuildBattleStats[];
  totalPlayers: number;
  totalFame: number;
  battleDuration: number; // in minutes
  isPrimeTime: boolean;
  killClustering: number; // clustering score
  friendGroups: string[][]; // groups of guilds that fought together
}

export class MmrService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Calculate MMR changes for all guilds in a battle
   */
  async calculateMmrForBattle(battleAnalysis: BattleAnalysis): Promise<Map<string, number>> {
    try {
      logger.info('Starting MMR calculation for battle', { 
        battleId: battleAnalysis.battleId.toString(),
        guildCount: battleAnalysis.guildStats.length 
      });

      const mmrChanges = new Map<string, number>();

      // Calculate base MMR changes for each guild
      for (const guildStat of battleAnalysis.guildStats) {
        const mmrChange = await this.calculateGuildMmrChange(guildStat, battleAnalysis);
        mmrChanges.set(guildStat.guildId, mmrChange);
      }

      // Apply opponent MMR strength adjustments
      this.adjustForOpponentStrength(mmrChanges, battleAnalysis);

      logger.info('Completed MMR calculation for battle', { 
        battleId: battleAnalysis.battleId.toString(),
        mmrChanges: Object.fromEntries(mmrChanges) 
      });

      return mmrChanges;
    } catch (error) {
      logger.error('Error calculating MMR for battle', { 
        battleId: battleAnalysis.battleId.toString(),
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Calculate MMR change for a single guild in a battle
   */
  private async calculateGuildMmrChange(
    guildStat: GuildBattleStats, 
    battleAnalysis: BattleAnalysis
  ): Promise<number> {
    try {
      let totalMmrChange = 0;

      // 1. Win/Loss factor (40% weight)
      const winLossFactor = this.calculateWinLossFactor(guildStat, battleAnalysis);
      totalMmrChange += winLossFactor * MMR_CONSTANTS.WIN_LOSS_WEIGHT;

      // 2. Fame differential factor (20% weight)
      const fameFactor = this.calculateFameFactor(guildStat, battleAnalysis);
      totalMmrChange += fameFactor * MMR_CONSTANTS.FAME_WEIGHT;

      // 3. Player count advantage factor (10% weight)
      const playerCountFactor = this.calculatePlayerCountFactor(guildStat, battleAnalysis);
      totalMmrChange += playerCountFactor * MMR_CONSTANTS.PLAYER_COUNT_WEIGHT;

      // 4. IP level factor (10% weight)
      const ipFactor = this.calculateIpFactor(guildStat, battleAnalysis);
      totalMmrChange += ipFactor * MMR_CONSTANTS.IP_WEIGHT;

      // 5. Battle size factor (5% weight)
      const battleSizeFactor = this.calculateBattleSizeFactor(battleAnalysis);
      totalMmrChange += battleSizeFactor * MMR_CONSTANTS.BATTLE_SIZE_WEIGHT;

      // 6. Kill/Death ratio factor (5% weight)
      const kdFactor = this.calculateKdFactor(guildStat);
      totalMmrChange += kdFactor * MMR_CONSTANTS.KD_RATIO_WEIGHT;

      // 7. Battle duration factor (5% weight)
      const durationFactor = this.calculateDurationFactor(battleAnalysis);
      totalMmrChange += durationFactor * MMR_CONSTANTS.BATTLE_DURATION_WEIGHT;

      // 8. Kill clustering factor (5% weight)
      const clusteringFactor = this.calculateClusteringFactor(battleAnalysis);
      totalMmrChange += clusteringFactor * MMR_CONSTANTS.KILL_CLUSTERING_WEIGHT;

      // Apply K-factor and ensure reasonable bounds
      const finalMmrChange = Math.max(-MMR_CONSTANTS.K_FACTOR, 
        Math.min(MMR_CONSTANTS.K_FACTOR, totalMmrChange * MMR_CONSTANTS.K_FACTOR));

      logger.debug('Calculated MMR change for guild', {
        guildName: guildStat.guildName,
        totalMmrChange: finalMmrChange,
        factors: {
          winLoss: winLossFactor,
          fame: fameFactor,
          playerCount: playerCountFactor,
          ip: ipFactor,
          battleSize: battleSizeFactor,
          kd: kdFactor,
          duration: durationFactor,
          clustering: clusteringFactor
        }
      });

      return finalMmrChange;
    } catch (error) {
      logger.error('Error calculating MMR change for guild', { 
        guildName: guildStat.guildName,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return 0; // Return 0 change on error
    }
  }

  /**
   * Calculate win/loss factor (-1 to 1)
   */
  private calculateWinLossFactor(guildStat: GuildBattleStats, battleAnalysis: BattleAnalysis): number {
    const totalKills = battleAnalysis.guildStats.reduce((sum, g) => sum + g.kills, 0);
    const guildKillRatio = totalKills > 0 ? guildStat.kills / totalKills : 0;
    
    // Determine if guild won (had significant kills)
    const isWinner = guildKillRatio > 0.3; // Guild won if they got >30% of kills
    const isLoser = guildStat.deaths > guildStat.kills * 2; // Guild lost if deaths > 2x kills
    
    if (isWinner) return 1;
    if (isLoser) return -1;
    return 0; // Neutral
  }

  /**
   * Calculate fame differential factor (-1 to 1)
   */
  private calculateFameFactor(guildStat: GuildBattleStats, battleAnalysis: BattleAnalysis): number {
    const totalFame = battleAnalysis.totalFame;
    if (totalFame === 0) return 0;

    const fameRatio = guildStat.fameGained / totalFame;
    const fameLostRatio = guildStat.fameLost / totalFame;
    
    return Math.max(-1, Math.min(1, fameRatio - fameLostRatio));
  }

  /**
   * Calculate player count advantage factor (-1 to 1)
   */
  private calculatePlayerCountFactor(guildStat: GuildBattleStats, battleAnalysis: BattleAnalysis): number {
    const avgPlayers = battleAnalysis.totalPlayers / battleAnalysis.guildStats.length;
    const playerRatio = guildStat.players / avgPlayers;
    
    // Consider advantage/disadvantage
    if (playerRatio > 1.5) return -0.5; // Had advantage
    if (playerRatio < 0.7) return 0.5; // Had disadvantage
    return 0; // Fair fight
  }

  /**
   * Calculate IP level factor (-1 to 1)
   */
  private calculateIpFactor(guildStat: GuildBattleStats, battleAnalysis: BattleAnalysis): number {
    const avgIP = battleAnalysis.guildStats.reduce((sum, g) => sum + g.avgIP, 0) / battleAnalysis.guildStats.length;
    const ipRatio = guildStat.avgIP / avgIP;
    
    if (ipRatio > 1.2) return -0.3; // Had IP advantage
    if (ipRatio < 0.8) return 0.3; // Had IP disadvantage
    return 0; // Fair IP
  }

  /**
   * Calculate battle size factor (0 to 1)
   */
  private calculateBattleSizeFactor(battleAnalysis: BattleAnalysis): number {
    // Larger battles get more weight
    if (battleAnalysis.totalPlayers >= 100) return 1;
    if (battleAnalysis.totalPlayers >= 50) return 0.7;
    if (battleAnalysis.totalPlayers >= 25) return 0.4;
    return 0.1;
  }

  /**
   * Calculate kill/death ratio factor (-1 to 1)
   */
  private calculateKdFactor(guildStat: GuildBattleStats): number {
    if (guildStat.deaths === 0) return guildStat.kills > 0 ? 1 : 0;
    
    const kdRatio = guildStat.kills / guildStat.deaths;
    if (kdRatio >= 3) return 1; // Excellent K/D
    if (kdRatio >= 2) return 0.5; // Good K/D
    if (kdRatio >= 1) return 0; // Even K/D
    if (kdRatio >= 0.5) return -0.5; // Poor K/D
    return -1; // Very poor K/D
  }

  /**
   * Calculate battle duration factor (-1 to 1)
   */
  private calculateDurationFactor(battleAnalysis: BattleAnalysis): number {
    // Shorter battles (quick wins) get positive factor
    if (battleAnalysis.battleDuration <= 5) return 1; // Very quick
    if (battleAnalysis.battleDuration <= 15) return 0.5; // Quick
    if (battleAnalysis.battleDuration <= 30) return 0; // Normal
    if (battleAnalysis.battleDuration <= 60) return -0.3; // Long
    return -0.7; // Very long
  }

  /**
   * Calculate kill clustering factor (0 to 1)
   */
  private calculateClusteringFactor(battleAnalysis: BattleAnalysis): number {
    // The improved clustering algorithm returns a more sophisticated score
    // Normalize it to 0-1 range, with better scaling for the new algorithm
    const baseScore = battleAnalysis.killClustering;
    
    // New algorithm can return higher scores, so adjust normalization
    // A score of 10+ indicates significant clustering
    if (baseScore >= 15) return 1.0;      // Excellent clustering
    if (baseScore >= 10) return 0.8;      // Good clustering  
    if (baseScore >= 5) return 0.6;       // Moderate clustering
    if (baseScore >= 2) return 0.3;       // Some clustering
    return 0.1;                           // Minimal clustering
  }

  /**
   * Adjust MMR changes based on opponent strength
   */
  private adjustForOpponentStrength(
    mmrChanges: Map<string, number>, 
    battleAnalysis: BattleAnalysis
  ): void {
    const avgOpponentMmr = battleAnalysis.guildStats.reduce((sum, g) => sum + g.currentMmr, 0) / battleAnalysis.guildStats.length;
    
    for (const [guildId, currentChange] of mmrChanges) {
      const guildStat = battleAnalysis.guildStats.find(g => g.guildId === guildId);
      if (!guildStat) continue;

      // If opponents have higher MMR, increase the change
      const opponentStrengthFactor = avgOpponentMmr > guildStat.currentMmr ? 1.2 : 0.8;
      const adjustedChange = currentChange * opponentStrengthFactor;
      
      mmrChanges.set(guildId, adjustedChange);
    }
  }

  /**
   * Check if battle meets MMR calculation criteria
   */
  static shouldCalculateMmr(totalPlayers: number, totalFame: number): boolean {
    return totalPlayers >= MMR_CONSTANTS.MIN_BATTLE_SIZE && 
           totalFame >= MMR_CONSTANTS.MIN_BATTLE_FAME;
  }

  /**
   * Update guild season MMR in database
   */
  async updateGuildSeasonMmr(
    guildId: string, 
    seasonId: string, 
    mmrChange: number, 
    battleStats: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): Promise<void> {
    try {
      // Get or create guild season record
      let guildSeason = await this.prisma.guildSeason.findUnique({
        where: { guildId_seasonId: { guildId, seasonId } }
      });

      if (!guildSeason) {
        // Create new guild season record
        guildSeason = await this.prisma.guildSeason.create({
          data: {
            guildId,
            seasonId,
            currentMmr: 1000.0, // Base MMR
            totalBattles: 0,
            wins: 0,
            losses: 0,
            totalFameGained: 0n,
            totalFameLost: 0n,
            primeTimeBattles: 0
          }
        });
      }

      // Calculate new MMR
      const newMmr = Math.max(0, guildSeason.currentMmr + mmrChange);
      
      // Determine win/loss
      const isWin = this.calculateWinLossFactor(battleStats, battleAnalysis) > 0;
      
      // Update guild season
      await this.prisma.guildSeason.update({
        where: { id: guildSeason.id },
        data: {
          currentMmr: newMmr,
          totalBattles: guildSeason.totalBattles + 1,
          wins: guildSeason.wins + (isWin ? 1 : 0),
          losses: guildSeason.losses + (isWin ? 0 : 1),
          totalFameGained: guildSeason.totalFameGained + BigInt(battleStats.fameGained),
          totalFameLost: guildSeason.totalFameLost + BigInt(battleStats.fameLost),
          primeTimeBattles: guildSeason.primeTimeBattles + (battleStats.isPrimeTime ? 1 : 0),
          lastBattleAt: new Date()
        }
      });

      // Update prime time mass if this is a prime time battle
      if (battleStats.isPrimeTime) {
        await this.updatePrimeTimeMass(guildSeason.id, battleStats.players, battleAnalysis.battleId);
      }

      logger.info('Updated guild season MMR', {
        guildId,
        seasonId,
        oldMmr: guildSeason.currentMmr,
        newMmr,
        mmrChange,
        isWin,
        isPrimeTime: battleStats.isPrimeTime
      });

    } catch (error) {
      logger.error('Error updating guild season MMR', {
        guildId,
        seasonId,
        mmrChange,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Update prime time mass for a guild
   */
  private async updatePrimeTimeMass(
    guildSeasonId: string, 
    playerCount: number, 
    battleId: bigint
  ): Promise<void> {
    try {
      // Get the battle to determine which prime time window it falls into
      const battle = await this.prisma.battle.findUnique({
        where: { albionId: battleId }
      });

      if (!battle) {
        logger.warn('Battle not found for prime time mass update', { battleId: battleId.toString() });
        return;
      }

      // Get global prime time windows
      const primeTimeWindows = await this.prisma.primeTimeWindow.findMany();

      // Find which prime time window this battle falls into
      const battleHour = battle.startedAt.getUTCHours();
      const matchingWindow = primeTimeWindows.find(window => {
        if (window.startHour <= window.endHour) {
          // Same day window (e.g., 20:00 to 22:00)
          return battleHour >= window.startHour && battleHour < window.endHour;
        } else {
          // Overnight window (e.g., 22:00 to 02:00)
          return battleHour >= window.startHour || battleHour < window.endHour;
        }
      });

      if (!matchingWindow) {
        logger.debug('Battle does not fall into any prime time window', { 
          battleId: battleId.toString(),
          battleHour,
          primeTimeWindows: primeTimeWindows.map(w => `${w.startHour}-${w.endHour}`)
        });
        return;
      }

      // TODO: Uncomment when Prisma client is regenerated with new GuildPrimeTimeMass model
      /*
      // Get or create prime time mass record
      let primeTimeMass = await this.prisma.guildPrimeTimeMass.findUnique({
        where: { 
          guildSeasonId_primeTimeWindowId: { 
            guildSeasonId, 
            primeTimeWindowId: matchingWindow.id 
          } 
        }
      });

      if (!primeTimeMass) {
        // Create new record
        primeTimeMass = await this.prisma.guildPrimeTimeMass.create({
          data: {
            guildSeasonId,
            primeTimeWindowId: matchingWindow.id,
            avgMass: playerCount,
            battleCount: 1,
            lastBattleAt: battle.startedAt
          }
        });
      } else {
        // Update existing record
        const newBattleCount = primeTimeMass.battleCount + 1;
        const newAvgMass = ((primeTimeMass.avgMass * primeTimeMass.battleCount) + playerCount) / newBattleCount;

        await this.prisma.guildPrimeTimeMass.update({
          where: { id: primeTimeMass.id },
          data: {
            avgMass: newAvgMass,
            battleCount: newBattleCount,
            lastBattleAt: battle.startedAt
          }
        });
      }
      */

      logger.debug('Updated prime time mass (placeholder)', {
        guildSeasonId,
        primeTimeWindow: `${matchingWindow.startHour}-${matchingWindow.endHour}`,
        playerCount,
        battleId: battleId.toString()
      });

    } catch (error) {
      logger.error('Error updating prime time mass', {
        guildSeasonId,
        playerCount,
        battleId: battleId.toString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get prime time mass data for a guild season
   */
  async getGuildPrimeTimeMass(guildSeasonId: string): Promise<any[]> {
    try {
      // TODO: Implement when Prisma client is regenerated
      // return await this.prisma.guildPrimeTimeMass.findMany({
      //   where: { guildSeasonId },
      //   include: { primeTimeWindow: true }
      // });
      
      logger.info('Prime time mass data not yet implemented - requires Prisma client regeneration');
      return [];
    } catch (error) {
      logger.error('Error getting guild prime time mass', {
        guildSeasonId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Get guild season MMR
   */
  async getGuildSeasonMmr(guildId: string, seasonId: string): Promise<GuildSeason | null> {
    try {
      return await this.prisma.guildSeason.findUnique({
        where: { guildId_seasonId: { guildId, seasonId } }
      });
    } catch (error) {
      logger.error('Error getting guild season MMR', {
        guildId,
        seasonId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get top guilds by MMR for a season
   */
  async getTopGuildsByMmr(seasonId: string, limit: number = 100): Promise<GuildSeason[]> {
    try {
      return await this.prisma.guildSeason.findMany({
        where: { seasonId },
        orderBy: { currentMmr: 'desc' },
        take: limit,
        include: {
          guild: true
        }
      });
    } catch (error) {
      logger.error('Error getting top guilds by MMR', {
        seasonId,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Process MMR carryover when a season ends
   * This should be called when ending a season to prepare for the next season
   */
  async processSeasonEnd(seasonId: string): Promise<void> {
    try {
      logger.info('Processing MMR carryover for season end', { seasonId });

      // Get all guild seasons for the ending season
      const guildSeasons = await this.prisma.guildSeason.findMany({
        where: { seasonId },
        include: { guild: true }
      });

      logger.info('Found guild seasons for carryover', { 
        seasonId, 
        guildCount: guildSeasons.length 
      });

      // Calculate carryover MMR for each guild
      for (const guildSeason of guildSeasons) {
        const carryoverMmr = this.calculateCarryoverMmr(guildSeason.currentMmr);
        
        // Store the carryover MMR in the guild season record
        // TODO: Uncomment when Prisma client is regenerated with new fields
        /*
        await this.prisma.guildSeason.update({
          where: { id: guildSeason.id },
          data: {
            carryoverMmr: carryoverMmr,
            seasonEndMmr: guildSeason.currentMmr
          }
        });
        */

        logger.debug('Calculated carryover MMR for guild', {
          guildId: guildSeason.guildId,
          guildName: guildSeason.guild.name,
          finalMmr: guildSeason.currentMmr,
          carryoverMmr
        });
      }

      logger.info('Completed MMR carryover processing', { 
        seasonId, 
        processedGuilds: guildSeasons.length 
      });

    } catch (error) {
      logger.error('Error processing season end MMR carryover', { 
        seasonId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Initialize new season with carryover MMR from previous season
   * This should be called when starting a new season
   */
  async initializeNewSeason(newSeasonId: string, previousSeasonId: string): Promise<void> {
    try {
      logger.info('Initializing new season with MMR carryover', { 
        newSeasonId, 
        previousSeasonId 
      });

      // Get all guild seasons from the previous season
      const previousGuildSeasons = await this.prisma.guildSeason.findMany({
        where: { seasonId: previousSeasonId },
        include: { guild: true }
      });

      logger.info('Found previous season guilds for carryover', { 
        previousSeasonId, 
        guildCount: previousGuildSeasons.length 
      });

      // Create new guild season records with carryover MMR
      for (const previousGuildSeason of previousGuildSeasons) {
        // TODO: Use carryoverMmr field when Prisma client is regenerated
        // const carryoverMmr = previousGuildSeason.carryoverMmr || MMR_CONSTANTS.BASE_MMR;
        const carryoverMmr = this.calculateCarryoverMmr(previousGuildSeason.currentMmr);
        
        // Create new guild season record for the new season
        await this.prisma.guildSeason.create({
          data: {
            guildId: previousGuildSeason.guildId,
            seasonId: newSeasonId,
            currentMmr: carryoverMmr,
            totalBattles: 0,
            wins: 0,
            losses: 0,
            totalFameGained: 0n,
            totalFameLost: 0n,
            primeTimeBattles: 0
            // TODO: Add these fields when Prisma client is regenerated
            // carryoverMmr: null, // Reset for new season
            // seasonEndMmr: null
          }
        });

        logger.debug('Created new guild season with carryover MMR', {
          guildId: previousGuildSeason.guildId,
          guildName: previousGuildSeason.guild.name,
          newSeasonId,
          carryoverMmr
        });
      }

      logger.info('Completed new season initialization', { 
        newSeasonId, 
        previousSeasonId,
        initializedGuilds: previousGuildSeasons.length 
      });

    } catch (error) {
      logger.error('Error initializing new season with MMR carryover', { 
        newSeasonId, 
        previousSeasonId,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Calculate carryover MMR based on final season MMR
   */
  private calculateCarryoverMmr(finalMmr: number): number {
    const carryoverMmr = finalMmr * MMR_CONSTANTS.SEASON_CARRYOVER_RATIO;
    const baseMmr = MMR_CONSTANTS.BASE_MMR;
    
    // Ensure carryover MMR is at least the base MMR
    return Math.max(baseMmr, carryoverMmr);
  }

  /**
   * Get carryover MMR for a guild from the previous season
   */
  async getCarryoverMmr(guildId: string, currentSeasonId: string): Promise<number> {
    try {
      // Find the previous season
      const currentSeason = await this.prisma.season.findUnique({
        where: { id: currentSeasonId }
      });

      if (!currentSeason) {
        return MMR_CONSTANTS.BASE_MMR;
      }

      const previousSeason = await this.prisma.season.findFirst({
        where: {
          startDate: { lt: currentSeason.startDate }
        },
        orderBy: { startDate: 'desc' }
      });

      if (!previousSeason) {
        return MMR_CONSTANTS.BASE_MMR;
      }

      // Get the guild's season record from the previous season
      const previousGuildSeason = await this.prisma.guildSeason.findUnique({
        where: { guildId_seasonId: { guildId, seasonId: previousSeason.id } }
      });

      if (!previousGuildSeason) {
        return MMR_CONSTANTS.BASE_MMR;
      }

      // TODO: Use carryoverMmr field when Prisma client is regenerated
      /*
      // Return carryover MMR or calculate it if not set
      if (previousGuildSeason.carryoverMmr !== null) {
        return previousGuildSeason.carryoverMmr;
      }
      */

      // Calculate carryover if not already calculated
      return this.calculateCarryoverMmr(previousGuildSeason.currentMmr);

    } catch (error) {
      logger.error('Error getting carryover MMR', { 
        guildId, 
        currentSeasonId,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return MMR_CONSTANTS.BASE_MMR; // Return base MMR on error
    }
  }
}
