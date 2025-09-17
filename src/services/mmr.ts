import { PrismaClient } from "@prisma/client";
import { log } from "../log.js";
import type { GuildSeason } from "../types/mmr.js";

const logger = log.child({ component: "mmr-service" });

// MMR calculation constants
const MMR_CONSTANTS = {
  BASE_MMR: 1000.0,
  K_FACTOR: 32, // How much MMR can change in a single battle
  WIN_LOSS_WEIGHT: 0.30, // 30% weight for win/loss (reduced from 35%)
  FAME_WEIGHT: 0.13, // 13% weight for fame differential (reduced from 15%)
  PLAYER_COUNT_WEIGHT: 0.22, // 22% weight for player count advantage (reduced from 25%)
  IP_WEIGHT: 0.04, // 4% weight for IP level differences (reduced from 5%)
  BATTLE_SIZE_WEIGHT: 0.04, // 4% weight for battle size (reduced from 5%)
  KD_RATIO_WEIGHT: 0.04, // 4% weight for kill/death ratio (reduced from 5%)
  BATTLE_DURATION_WEIGHT: 0.03, // 3% weight for battle duration
  KILL_CLUSTERING_WEIGHT: 0.02, // 2% weight for kill clustering
  OPPONENT_MMR_WEIGHT: 0.13, // 13% weight for opponent MMR strength (reduced from 15%)
  INDIVIDUAL_PERFORMANCE_WEIGHT: 0.05, // 5% weight for individual guild performance within alliance
  FRIEND_DETECTION_THRESHOLD: 0.1, // 10% of total kills to consider as friend
  MIN_BATTLE_SIZE: 25, // Minimum players for MMR calculation
  MIN_BATTLE_FAME: 2000000, // Minimum fame for MMR calculation (2M)
  SEASON_CARRYOVER_RATIO: 0.3, // 30% of previous season MMR carries over
  
  // IMPROVED: More strict proportional participation thresholds
  MIN_FAME_PARTICIPATION_RATIO: 0.15, // 15% of total battle fame for participation (increased from 10%)
  MIN_KILLS_DEATHS_RATIO: 0.15, // 15% of total battle kills+deaths for participation (increased from 10%)
  MIN_PLAYER_RATIO: 0.15, // 15% of total battle players for participation (increased from 10%)
  
  // IMPROVED: More strict absolute thresholds
  MIN_ABSOLUTE_FAME_PARTICIPATION: 1000000, // Minimum 1M fame gained or lost (increased from 500K)
  MIN_ABSOLUTE_KILLS_DEATHS: 12, // Minimum 12 kills OR deaths combined (increased from 10)
  MIN_ABSOLUTE_PLAYERS: 2, // Minimum 2 players for significant participation
  
  // NEW: Battle size scaling factors for participation thresholds
  SMALL_BATTLE_THRESHOLD: 20, // Battles with 20 or fewer total kills+deaths are considered small
  SMALL_BATTLE_KILLS_DEATHS_MULTIPLIER: 0.5, // Small battles get 50% of normal absolute threshold (increased from 30%)
  SMALL_BATTLE_FAME_MULTIPLIER: 0.4, // Small battles get 40% of normal absolute fame threshold (increased from 20%)
  
  // Alliance participation bonus (guilds from same alliance get more lenient thresholds)
  ALLIANCE_PARTICIPATION_BONUS: 0.3, // 30% bonus for participating in major alliances (reduced from 50%)
  
  // IMPROVED: Player count scaling for proportional MMR calculation
  PLAYER_COUNT_SCALING_FACTOR: 0.8, // MMR changes scale with player count to the power of 0.8
  MIN_PLAYER_COUNT_FOR_FULL_MMR: 8, // Guilds with 8+ players get full MMR changes
  MAX_PLAYER_COUNT_FOR_SCALING: 20, // Guilds with 20+ players get capped scaling
  
  // New constants for improved calculation
  PLAYER_COUNT_PENALTY_THRESHOLD: 1.5, // 50% more players triggers penalty
  PLAYER_COUNT_BONUS_THRESHOLD: 0.7, // 30% fewer players triggers bonus
  OPPONENT_MMR_DIFFERENCE_THRESHOLD: 100, // 100 MMR difference for significant impact
  MAX_MMR_GAIN_FOR_EASY_WIN: 25, // Maximum points for easy wins (increased to allow difficult wins)
  ANTI_FARMING_SEASON_LOOKBACK_DAYS: 30, // Look back 30 days for anti-farming
  ANTI_FARMING_WIN_THRESHOLD: 3, // Wins against an opponent before reduction
  ANTI_FARMING_MAX_WINS: 10, // Maximum wins against an opponent before full reduction
  
  // IP-based farming detection constants
  LOW_IP_THRESHOLD: 1380, // IP below this is considered low
  IP_FARMING_OPPONENT_THRESHOLD: 0.6, // If 60%+ of opponents have low IP, trigger farming penalty
  IP_FARMING_MAX_MMR_GAIN: 5, // Maximum MMR gain when IP farming is detected
  IP_FARMING_PENALTY_MULTIPLIER: 0.3, // Reduce MMR gain to 30% when farming detected
  
  // MMR Convergence and Decay System (prevents infinite scaling)
  MMR_DECAY_RATE: 0.01, // 1% MMR decay per day of inactivity
  MMR_CONVERGENCE_FACTOR: 0.95, // K-factor reduces by 5% for every 100 MMR above baseline
  MMR_DECAY_THRESHOLD: 3, // Start decay after 3 days of inactivity
  MAX_MMR_ABOVE_BASELINE: 500, // Maximum MMR above baseline (1500 total)
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
  killClustering: number; // Per-guild kill clustering score
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
  // Alliance data for participation analysis
  guildAlliances?: Map<string, string>; // guildName -> allianceName mapping
}

export class MmrService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get detailed factor breakdown for a guild (for simulation/debugging)
   */
  async getGuildFactorBreakdown(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): Promise<{
    factors: any;
    weights: any;
    contributions: any;
    totalWeightedScore: number;
    playerCountScalingFactor: number;
    finalMmrChange: number;
    isIpFarming: boolean;
  }> {
    // Calculate all individual factors using the actual service methods
    const winLossFactor = this.calculateWinLossFactor(guildStat, battleAnalysis);
    const fameFactor = this.calculateFameFactor(guildStat, battleAnalysis);
    const playerCountFactor = this.calculatePlayerCountFactor(guildStat, battleAnalysis);
    const ipFactor = this.calculateIpFactor(guildStat, battleAnalysis);
    const battleSizeFactor = this.calculateBattleSizeFactor(battleAnalysis);
    const kdFactor = this.calculateKdFactor(guildStat);
    const durationFactor = this.calculateDurationFactor(battleAnalysis);
    const clusteringFactor = this.calculateClusteringFactor(guildStat);
    const opponentStrengthFactor = this.calculateOpponentStrengthFactor(guildStat, battleAnalysis);
    const individualPerformanceFactor = this.calculateIndividualPerformanceFactor(guildStat, battleAnalysis);

    const factors = {
      winLoss: winLossFactor,
      fame: fameFactor,
      playerCount: playerCountFactor,
      ip: ipFactor,
      battleSize: battleSizeFactor,
      kd: kdFactor,
      duration: durationFactor,
      clustering: clusteringFactor,
      opponentStrength: opponentStrengthFactor,
      individualPerformance: individualPerformanceFactor
    };

    // Calculate weighted contributions
    const weights = {
      winLoss: MMR_CONSTANTS.WIN_LOSS_WEIGHT,
      fame: MMR_CONSTANTS.FAME_WEIGHT,
      playerCount: MMR_CONSTANTS.PLAYER_COUNT_WEIGHT,
      ip: MMR_CONSTANTS.IP_WEIGHT,
      battleSize: MMR_CONSTANTS.BATTLE_SIZE_WEIGHT,
      kd: MMR_CONSTANTS.KD_RATIO_WEIGHT,
      duration: MMR_CONSTANTS.BATTLE_DURATION_WEIGHT,
      clustering: MMR_CONSTANTS.KILL_CLUSTERING_WEIGHT,
      opponentStrength: MMR_CONSTANTS.OPPONENT_MMR_WEIGHT,
      individualPerformance: MMR_CONSTANTS.INDIVIDUAL_PERFORMANCE_WEIGHT
    };

    const contributions = {
      winLoss: winLossFactor * weights.winLoss,
      fame: fameFactor * weights.fame,
      playerCount: playerCountFactor * weights.playerCount,
      ip: ipFactor * weights.ip,
      battleSize: battleSizeFactor * weights.battleSize,
      kd: kdFactor * weights.kd,
      duration: durationFactor * weights.duration,
      clustering: clusteringFactor * weights.clustering,
      opponentStrength: opponentStrengthFactor * weights.opponentStrength,
      individualPerformance: individualPerformanceFactor * weights.individualPerformance
    };

    const totalWeightedScore = Object.values(contributions).reduce((sum, val) => sum + val, 0);

    // Calculate player count scaling factor
    const playerCountScalingFactor = this.calculatePlayerCountScalingFactor(guildStat);

    // Calculate dynamic K-factor based on current MMR (prevents infinite scaling)
    const dynamicKFactor = this.calculateDynamicKFactor(guildStat.currentMmr);

    // Calculate final MMR change (without anti-farming for now)
    let finalMmrChange = Math.max(
      -dynamicKFactor,
      Math.min(
        dynamicKFactor,
        totalWeightedScore * dynamicKFactor * playerCountScalingFactor
      )
    );

    // Apply additional constraints for easy wins and losses
    const isWin = winLossFactor > 0;
    if (isWin && finalMmrChange > 0) {
      finalMmrChange = Math.min(finalMmrChange, MMR_CONSTANTS.MAX_MMR_GAIN_FOR_EASY_WIN);
    }
    // REMOVED: Minimum loss cap to allow proper scaling of MMR losses
    // The system should naturally scale losses based on performance
    
    // CRITICAL: Winning guilds should never lose MMR (minimum 0)
    // This prevents penalties from making winners lose MMR
    if (isWin && finalMmrChange < 0) {
      finalMmrChange = 0;
    }
    
    // CRITICAL: Poor performers should never gain MMR from bonuses alone
    // If win/loss factor is negative (poor performance), cap MMR at 0
    // This prevents underdog bonuses from creating MMR gains from nowhere
    if (!isWin && finalMmrChange > 0) {
      finalMmrChange = 0;
    }
    
    // CRITICAL: Good performers should never lose MMR from penalties
    // If guild has good individual performance (K/D ≥ 1.0 and positive fame), cap MMR loss at 0
    // This prevents penalties from taking MMR away from guilds with good performance
    const hasGoodKD = guildStat.deaths === 0 || (guildStat.kills / guildStat.deaths) >= 1.0;
    const hasPositiveFame = guildStat.fameGained > guildStat.fameLost;
    const hasGoodIndividualPerformance = hasGoodKD && hasPositiveFame;
    
    if (hasGoodIndividualPerformance && finalMmrChange < 0) {
      finalMmrChange = 0;
    }

    // Apply IP farming penalty for wins against low-IP opponents
    let isIpFarming = false;
    if (isWin && finalMmrChange > 0) {
      isIpFarming = this.detectIpFarming(guildStat, battleAnalysis);
      
      if (isIpFarming) {
        // Apply heavy penalty for IP farming
        finalMmrChange = Math.min(
          finalMmrChange * MMR_CONSTANTS.IP_FARMING_PENALTY_MULTIPLIER,
          MMR_CONSTANTS.IP_FARMING_MAX_MMR_GAIN
        );
      }
    }

    return {
      factors,
      weights,
      contributions,
      totalWeightedScore,
      playerCountScalingFactor,
      finalMmrChange,
      isIpFarming
    };
  }

  /**
   * Calculate MMR changes for all guilds in a battle
   */
  async calculateMmrForBattle(
    battleAnalysis: BattleAnalysis
  ): Promise<Map<string, { mmrChange: number; antiFarmingFactor?: number }>> {
    try {
      logger.info("Starting MMR calculation for battle", {
        battleId: battleAnalysis.battleId.toString(),
        guildCount: battleAnalysis.guildStats.length,
      });

      const mmrResults = new Map<string, { mmrChange: number; antiFarmingFactor?: number }>();

      // Filter guilds with significant participation before calculating MMR
      const significantGuilds = battleAnalysis.guildStats.filter(guildStat => {
        const hasSignificantParticipation = MmrService.hasSignificantParticipation(guildStat, battleAnalysis);
        
        if (!hasSignificantParticipation) {
          logger.debug("Skipping MMR calculation for guild with insignificant participation", {
            guildName: guildStat.guildName,
            kills: guildStat.kills,
            deaths: guildStat.deaths,
            fameGained: guildStat.fameGained,
            players: guildStat.players
          });
        }
        
        return hasSignificantParticipation;
      });

      logger.info("Filtered guilds for MMR calculation", {
        battleId: battleAnalysis.battleId.toString(),
        totalGuilds: battleAnalysis.guildStats.length,
        significantGuilds: significantGuilds.length,
        filteredOut: battleAnalysis.guildStats.length - significantGuilds.length
      });

      // Calculate base MMR changes for each significant guild
      for (const guildStat of significantGuilds) {
        const result = await this.calculateGuildMmrChangeWithAntiFarming(
          guildStat,
          battleAnalysis
        );
        mmrResults.set(guildStat.guildId, result);
      }

      logger.info("Completed MMR calculation for battle", {
        battleId: battleAnalysis.battleId.toString(),
        mmrChanges: Object.fromEntries(
          Array.from(mmrResults.entries()).map(([guildId, result]) => [guildId, result.mmrChange])
        ),
      });

      return mmrResults;
    } catch (error) {
      logger.error("Error calculating MMR for battle", {
        battleId: battleAnalysis.battleId.toString(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  /**
   * Calculate MMR change for a single guild in a battle with anti-farming factor
   */
  private async calculateGuildMmrChangeWithAntiFarming(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): Promise<{ mmrChange: number; antiFarmingFactor?: number }> {
    try {
      let totalMmrChange = 0;

      // 1. Win/Loss factor (35% weight)
      const winLossFactor = this.calculateWinLossFactor(
        guildStat,
        battleAnalysis
      );
      totalMmrChange += winLossFactor * MMR_CONSTANTS.WIN_LOSS_WEIGHT;

      // 2. Fame differential factor (15% weight)
      const fameFactor = this.calculateFameFactor(guildStat, battleAnalysis);
      totalMmrChange += fameFactor * MMR_CONSTANTS.FAME_WEIGHT;

      // 3. Player count advantage factor (25% weight)
      const playerCountFactor = this.calculatePlayerCountFactor(
        guildStat,
        battleAnalysis
      );
      totalMmrChange += playerCountFactor * MMR_CONSTANTS.PLAYER_COUNT_WEIGHT;

      // 4. IP level factor (5% weight)
      const ipFactor = this.calculateIpFactor(guildStat, battleAnalysis);
      totalMmrChange += ipFactor * MMR_CONSTANTS.IP_WEIGHT;

      // 5. Battle size factor (5% weight)
      const battleSizeFactor = this.calculateBattleSizeFactor(battleAnalysis);
      totalMmrChange += battleSizeFactor * MMR_CONSTANTS.BATTLE_SIZE_WEIGHT;

      // 6. Kill/Death ratio factor (5% weight)
      const kdFactor = this.calculateKdFactor(guildStat);
      totalMmrChange += kdFactor * MMR_CONSTANTS.KD_RATIO_WEIGHT;

      // 7. Battle duration factor (3% weight)
      const durationFactor = this.calculateDurationFactor(battleAnalysis);
      totalMmrChange += durationFactor * MMR_CONSTANTS.BATTLE_DURATION_WEIGHT;

      // 8. Kill clustering factor (2% weight)
      const clusteringFactor = this.calculateClusteringFactor(guildStat);
      totalMmrChange += clusteringFactor * MMR_CONSTANTS.KILL_CLUSTERING_WEIGHT;

      // 9. Opponent strength factor (20% weight) - NEW
      const opponentStrengthFactor = this.calculateOpponentStrengthFactor(
        guildStat,
        battleAnalysis
      );
      totalMmrChange += opponentStrengthFactor * MMR_CONSTANTS.OPPONENT_MMR_WEIGHT;

      // 10. Individual performance factor (10% weight) - NEW
      const individualPerformanceFactor = this.calculateIndividualPerformanceFactor(
        guildStat,
        battleAnalysis
      );
      totalMmrChange += individualPerformanceFactor * MMR_CONSTANTS.INDIVIDUAL_PERFORMANCE_WEIGHT;

      // IMPROVED: Apply proportional scaling based on player count
      const playerCountScalingFactor = this.calculatePlayerCountScalingFactor(guildStat);
      
      // Calculate dynamic K-factor based on current MMR (prevents infinite scaling)
      const dynamicKFactor = this.calculateDynamicKFactor(guildStat.currentMmr);
      
      // Apply K-factor and ensure reasonable bounds
      let finalMmrChange = Math.max(
        -dynamicKFactor,
        Math.min(
          dynamicKFactor,
          totalMmrChange * dynamicKFactor * playerCountScalingFactor
        )
      );

      // Apply additional constraints for easy wins and losses
      const isWin = this.calculateWinLossFactor(guildStat, battleAnalysis) > 0;
      
      if (isWin && finalMmrChange > 0) {
        // Cap easy wins to prevent excessive MMR gain
        finalMmrChange = Math.min(finalMmrChange, MMR_CONSTANTS.MAX_MMR_GAIN_FOR_EASY_WIN);
      }
      // REMOVED: Minimum loss cap to allow proper scaling of MMR losses
      // The system should naturally scale losses based on performance
      
      // CRITICAL: Winning guilds should never lose MMR (minimum 0)
      // This prevents penalties from making winners lose MMR
      if (isWin && finalMmrChange < 0) {
        finalMmrChange = 0;
      }
      
      // CRITICAL: Poor performers should never gain MMR from bonuses alone
      // If win/loss factor is negative (poor performance), cap MMR at 0
      // This prevents underdog bonuses from creating MMR gains from nowhere
      if (!isWin && finalMmrChange > 0) {
        finalMmrChange = 0;
      }
      
      // CRITICAL: Good performers should never lose MMR from penalties
      // If guild has good individual performance (K/D ≥ 1.0 and positive fame), cap MMR loss at 0
      // This prevents penalties from taking MMR away from guilds with good performance
      const hasGoodKD = guildStat.deaths === 0 || (guildStat.kills / guildStat.deaths) >= 1.0;
      const hasPositiveFame = guildStat.fameGained > guildStat.fameLost;
      const hasGoodIndividualPerformance = hasGoodKD && hasPositiveFame;
      
      if (hasGoodIndividualPerformance && finalMmrChange < 0) {
        finalMmrChange = 0;
      }

      // Apply IP farming penalty for wins against low-IP opponents
      if (isWin && finalMmrChange > 0) {
        const isIpFarming = this.detectIpFarming(guildStat, battleAnalysis);
        
        if (isIpFarming) {
          // Apply heavy penalty for IP farming
          const originalMmrChange = finalMmrChange;
          finalMmrChange = Math.min(
            finalMmrChange * MMR_CONSTANTS.IP_FARMING_PENALTY_MULTIPLIER,
            MMR_CONSTANTS.IP_FARMING_MAX_MMR_GAIN
          );

          logger.debug('Applied IP farming penalty', {
            guildName: guildStat.guildName,
            originalMmrChange,
            finalMmrChange,
            penaltyMultiplier: MMR_CONSTANTS.IP_FARMING_PENALTY_MULTIPLIER,
            maxMmrGain: MMR_CONSTANTS.IP_FARMING_MAX_MMR_GAIN
          });
        }
      }

      // Apply anti-farming factor to reduce MMR gains for repeated wins against same opponents
      let antiFarmingFactor: number | undefined;
      if (isWin && finalMmrChange > 0) {
        // Get the guild's alliance
        const guildAlliance = this.getGuildAlliance(guildStat.guildName, battleAnalysis);
        
        // Filter out allied guilds - only consider enemy guilds for anti-farming
        const enemyGuilds = battleAnalysis.guildStats.filter(g => {
          if (g.guildId === guildStat.guildId) return false; // Skip self
          
          // If no alliance data available, treat all other guilds as enemies
          if (!battleAnalysis.guildAlliances || !guildAlliance) return true;
          
          // Get the other guild's alliance
          const otherGuildAlliance = battleAnalysis.guildAlliances.get(g.guildName);
          
          // If the other guild has no alliance, treat as enemy
          if (!otherGuildAlliance) return true;
          
          // Only consider as enemy if they're from different alliances
          return otherGuildAlliance !== guildAlliance;
        });
        
        // Get opponent guild names
        const opponentGuilds = enemyGuilds.map(g => g.guildName);

        // Get current season ID
        const currentSeason = await this.getCurrentActiveSeason();
        if (currentSeason) {
          antiFarmingFactor = await this.calculateAntiFarmingFactor(
            guildStat.guildId,
            currentSeason.id,
            opponentGuilds,
            isWin
          );

          // Apply anti-farming reduction
          const originalMmrChange = finalMmrChange;
          finalMmrChange *= antiFarmingFactor;

          logger.debug("Applied anti-farming factor", {
            guildName: guildStat.guildName,
            opponentGuilds,
            antiFarmingFactor,
            originalMmrChange,
            finalMmrChange
          });
        }
      }

      logger.debug("Calculated MMR change for guild", {
        guildName: guildStat.guildName,
        totalMmrChange: finalMmrChange,
        antiFarmingFactor,
        playerCountScalingFactor,
        factors: {
          winLoss: winLossFactor,
          fame: fameFactor,
          playerCount: playerCountFactor,
          ip: ipFactor,
          battleSize: battleSizeFactor,
          kd: kdFactor,
          duration: durationFactor,
          clustering: clusteringFactor,
          opponentStrength: opponentStrengthFactor,
          individualPerformance: individualPerformanceFactor,
        },
      });

      return { 
        mmrChange: finalMmrChange, 
        ...(antiFarmingFactor !== undefined && { antiFarmingFactor }) 
      };
    } catch (error) {
      logger.error("Error calculating MMR change for guild", {
        guildName: guildStat.guildName,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return { mmrChange: 0 }; // Return 0 change on error
    }
  }



  /**
   * Calculate win/loss factor (-1 to 1)
   * IMPROVED: More sophisticated win/loss calculation with nuanced scoring
   * Now properly handles alliances and provides fair, contextual win/loss determination
   */
  private calculateWinLossFactor(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): number {
    // Get the guild's alliance
    const guildAlliance = this.getGuildAlliance(guildStat.guildName, battleAnalysis);
    
    // Filter out allied guilds - only consider enemy guilds for win/loss calculation
    const enemyGuilds = battleAnalysis.guildStats.filter(g => {
      if (g.guildId === guildStat.guildId) return false; // Skip self
      
      // If no alliance data available, treat all other guilds as enemies
      if (!battleAnalysis.guildAlliances || !guildAlliance) return true;
      
      // Get the other guild's alliance
      const otherGuildAlliance = battleAnalysis.guildAlliances.get(g.guildName);
      
      // If the other guild has no alliance, treat as enemy
      if (!otherGuildAlliance) return true;
      
      // Only consider as enemy if they're from different alliances
      return otherGuildAlliance !== guildAlliance;
    });

    // If there are no enemies (all guilds are allies), return neutral
    if (enemyGuilds.length === 0) {
      return 0; // Neutral - no enemies to win/lose against
    }

    // Calculate enemy totals
    const enemyTotalKills = enemyGuilds.reduce((sum, g) => sum + g.kills, 0);
    const enemyTotalDeaths = enemyGuilds.reduce((sum, g) => sum + g.deaths, 0);
    const enemyTotalFameGained = enemyGuilds.reduce((sum, g) => sum + g.fameGained, 0);
    const enemyTotalFameLost = enemyGuilds.reduce((sum, g) => sum + g.fameLost, 0);
    const enemyTotalPlayers = enemyGuilds.reduce((sum, g) => sum + g.players, 0);

    // Calculate total battle metrics (guild + enemies)
    const totalKills = guildStat.kills + enemyTotalKills;
    const totalDeaths = guildStat.deaths + enemyTotalDeaths;
    const totalFameGained = guildStat.fameGained + enemyTotalFameGained;
    const totalFameLost = guildStat.fameLost + enemyTotalFameLost;
    const totalPlayers = guildStat.players + enemyTotalPlayers;

    // If no meaningful battle activity, return neutral
    if (totalKills === 0 && totalDeaths === 0) {
      return 0;
    }

    // IMPROVED: Multi-factor win/loss calculation with minimum 0 for good performers
    let winScore = 0;
    let totalWeight = 0;

    // 1. Kill Performance (40% weight)
    if (totalKills > 0) {
      const killRatio = guildStat.kills / totalKills;
      const expectedKillRatio = guildStat.players / totalPlayers; // Expected based on player count
      const killPerformance = (killRatio - expectedKillRatio) * 2; // Scale for impact
      winScore += killPerformance * 0.4;
      totalWeight += 0.4;
    }

    // 2. Death Avoidance (30% weight)
    if (totalDeaths > 0) {
      const deathRatio = guildStat.deaths / totalDeaths;
      const expectedDeathRatio = guildStat.players / totalPlayers; // Expected based on player count
      const deathPerformance = (expectedDeathRatio - deathRatio) * 2; // Lower deaths = better
      winScore += deathPerformance * 0.3;
      totalWeight += 0.3;
    }

    // 3. Fame Efficiency (20% weight)
    if (totalFameGained > 0) {
      const fameGainedRatio = guildStat.fameGained / totalFameGained;
      const expectedFameRatio = guildStat.players / totalPlayers;
      const famePerformance = (fameGainedRatio - expectedFameRatio) * 1.5;
      winScore += famePerformance * 0.2;
      totalWeight += 0.2;
    }

    // 4. Fame Loss Minimization (10% weight)
    if (totalFameLost > 0) {
      const fameLostRatio = guildStat.fameLost / totalFameLost;
      const expectedFameLostRatio = guildStat.players / totalPlayers;
      const fameLossPerformance = (expectedFameLostRatio - fameLostRatio) * 1.5; // Lower losses = better
      winScore += fameLossPerformance * 0.1;
      totalWeight += 0.1;
    }

    // Normalize by total weight
    if (totalWeight > 0) {
      winScore = winScore / totalWeight;
    }

    // Apply battle size scaling - larger battles get more weight
    const battleSizeMultiplier = Math.min(1.5, Math.max(0.5, battleAnalysis.totalPlayers / 50));
    winScore *= battleSizeMultiplier;

    // Apply alliance size scaling - smaller alliances get bonus for good performance
    if (guildAlliance && battleAnalysis.guildAlliances) {
      const allianceGuilds = battleAnalysis.guildStats.filter(g => 
        battleAnalysis.guildAlliances?.get(g.guildName) === guildAlliance
      );
      const alliancePlayers = allianceGuilds.reduce((sum, g) => sum + g.players, 0);
      const allianceRatio = alliancePlayers / totalPlayers;
      
      // Underdog bonus for smaller alliances (only if already performing well)
      if (allianceRatio < 0.3 && winScore > 0) {
        winScore *= 1.2; // 20% bonus for underdog alliances
      } else if (allianceRatio > 0.7) {
        winScore *= 0.8; // 20% penalty for dominant alliances
      }
    }

    // CRITICAL FIX: Ensure good performers never get negative win/loss
    // If guild has good K/D ratio (>= 1.0) and positive fame gain, minimum score is 0
    const hasGoodKD = guildStat.deaths === 0 || (guildStat.kills / guildStat.deaths) >= 1.0;
    const hasPositiveFame = guildStat.fameGained > guildStat.fameLost;
    const hasGoodPerformance = hasGoodKD && hasPositiveFame;
    
    if (hasGoodPerformance) {
      // Good performers get minimum 0, maximum 1
      return Math.max(0, Math.min(1, winScore));
    }

    // Poor performers can get negative scores (down to -1)
    return Math.max(-1, Math.min(1, winScore));
  }

  /**
   * Calculate fame differential factor (-1 to 1)
   */
  private calculateFameFactor(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): number {
    const totalFame = battleAnalysis.totalFame;
    if (totalFame === 0) return 0;

    const fameRatio = guildStat.fameGained / totalFame;
    const fameLostRatio = guildStat.fameLost / totalFame;

    return Math.max(-1, Math.min(1, fameRatio - fameLostRatio));
  }

  /**
   * Calculate player count advantage factor (-1 to 1)
   * More aggressive penalties for player count advantages
   * Now considers alliance groupings for more accurate calculations
   */
  private calculatePlayerCountFactor(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): number {
    // First, try to calculate based on alliance groupings if available
    if (battleAnalysis.guildAlliances) {
      const guildAlliance = battleAnalysis.guildAlliances.get(guildStat.guildName);
      if (guildAlliance) {
        // Calculate alliance totals
        const allianceGuilds = battleAnalysis.guildStats.filter(g => 
          battleAnalysis.guildAlliances?.get(g.guildName) === guildAlliance
        );
        const alliancePlayers = allianceGuilds.reduce((sum, g) => sum + g.players, 0);
        
        // Calculate opponent alliance totals
        const opponentPlayers = battleAnalysis.guildStats
          .filter(g => {
            const alliance = battleAnalysis.guildAlliances?.get(g.guildName);
            return alliance && alliance !== guildAlliance;
          })
          .reduce((sum, g) => sum + g.players, 0);
        
        if (opponentPlayers > 0) {
          // FIXED: Apply underdog bonuses and advantage penalties based on alliance totals
          // Compare relative to the largest alliance, not just opponent alliance
          const maxAlliancePlayers = Math.max(alliancePlayers, opponentPlayers);
          const guildRatio = guildStat.players / maxAlliancePlayers;
          
          // If this guild has the most players in their alliance, no bonus
          if (guildRatio >= 1.0) {
            return 0; // No bonus for having the most players
          }
          
          // Underdog bonuses only apply when there's already positive performance
          // This prevents creating MMR gains from nowhere for poor performers
          if (guildRatio <= 0.3) {
            return 0.5; // Reduced bonus for having 30% or fewer players than the largest alliance
          }
          if (guildRatio <= 0.5) {
            return 0.3; // Reduced bonus for having 50% or fewer players than the largest alliance
          }
          if (guildRatio <= 0.7) {
            return 0.1; // Small bonus for having 70% or fewer players than the largest alliance
          }
          return 0; // Fair fight (0.7 to 1.0 ratio)
        }
      }
    }
    
    // Fallback to individual guild calculation
    // FIXED: Compare relative to the largest guild, not average
    const maxPlayers = Math.max(...battleAnalysis.guildStats.map(g => g.players));
    const playerRatio = guildStat.players / maxPlayers;

    // More aggressive penalties for player count advantages
    if (playerRatio >= 1.0) {
      return 0; // No bonus for having the most players or equal to the most
    }
    // Underdog bonuses only apply when there's already positive performance
    // This prevents creating MMR gains from nowhere for poor performers
    if (playerRatio <= 0.3) {
      return 0.5; // Reduced bonus for having 30% or fewer players than the largest guild
    }
    if (playerRatio <= 0.5) {
      return 0.3; // Reduced bonus for having 50% or fewer players than the largest guild
    }
    if (playerRatio <= 0.7) {
      return 0.1; // Small bonus for having 70% or fewer players than the largest guild
    }
    return 0; // Fair fight (0.7 to 1.0 ratio)
  }

  /**
   * Calculate IP level factor (-1 to 1)
   */
  private calculateIpFactor(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): number {
    const avgIP =
      battleAnalysis.guildStats.reduce((sum, g) => sum + g.avgIP, 0) /
      battleAnalysis.guildStats.length;
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
   * Calculate kill clustering factor (0 to 1) for a specific guild
   */
  private calculateClusteringFactor(guildStat: GuildBattleStats): number {
    // The improved clustering algorithm returns a more sophisticated score
    // Normalize it to 0-1 range, with better scaling for the new algorithm
    const baseScore = guildStat.killClustering;

    // New algorithm can return higher scores, so adjust normalization
    // A score of 10+ indicates significant clustering
    if (baseScore >= 15) return 1.0; // Excellent clustering
    if (baseScore >= 10) return 0.8; // Good clustering
    if (baseScore >= 5) return 0.6; // Moderate clustering
    if (baseScore >= 2) return 0.3; // Some clustering
    return 0.1; // Minimal clustering
  }

  /**
   * Calculate opponent strength factor (-1 to 1)
   * This factor heavily penalizes easy wins and rewards difficult wins
   * Now properly handles alliances - only considers enemy guilds for opponent strength
   */
  private calculateOpponentStrengthFactor(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): number {
    // Get the guild's alliance
    const guildAlliance = this.getGuildAlliance(guildStat.guildName, battleAnalysis);
    
    // Filter out allied guilds - only consider enemy guilds for opponent strength
    const enemyGuilds = battleAnalysis.guildStats.filter(g => {
      if (g.guildId === guildStat.guildId) return false; // Skip self
      
      // If no alliance data available, treat all other guilds as enemies
      if (!battleAnalysis.guildAlliances || !guildAlliance) return true;
      
      // Get the other guild's alliance
      const otherGuildAlliance = battleAnalysis.guildAlliances.get(g.guildName);
      
      // If the other guild has no alliance, treat as enemy
      if (!otherGuildAlliance) return true;
      
      // Only consider as enemy if they're from different alliances
      return otherGuildAlliance !== guildAlliance;
    });

    // Get enemy MMRs only
    const opponentMmrs = enemyGuilds.map((g) => g.currentMmr);

    if (opponentMmrs.length === 0) return 0; // No enemies, no opponent strength factor

    // Calculate average opponent MMR
    const avgOpponentMmr = opponentMmrs.reduce((sum, mmr) => sum + mmr, 0) / opponentMmrs.length;
    
    // Calculate MMR difference
    const mmrDifference = guildStat.currentMmr - avgOpponentMmr;
    
    // Normalize the difference (100 MMR difference = 0.5 factor)
    const normalizedDifference = mmrDifference / MMR_CONSTANTS.OPPONENT_MMR_DIFFERENCE_THRESHOLD;
    
    // Apply sigmoid-like function to smooth the factor
    // Positive difference (guild has higher MMR) = negative factor (penalty for easy win)
    // Negative difference (guild has lower MMR) = positive factor (bonus for difficult win)
    let factor = -Math.tanh(normalizedDifference);
    
    // CRITICAL FIX: Opponent strength bonus should only amplify positive performance
    // If guild has poor performance (K/D < 1.0), don't give opponent strength bonuses
    // This prevents poor performers from getting MMR gains from fighting stronger opponents
    const hasGoodKD = guildStat.deaths === 0 || (guildStat.kills / guildStat.deaths) >= 1.0;
    
    if (!hasGoodKD && factor > 0) {
      // Poor performers don't get opponent strength bonuses
      factor = 0;
    }
    
    return Math.max(-1, Math.min(1, factor));
  }

  // MMR decay method removed - will be integrated in future update

  /**
   * Calculate dynamic K-factor based on current MMR to prevent infinite scaling
   * Higher MMR guilds get smaller K-factors, creating natural convergence
   */
  private calculateDynamicKFactor(currentMmr: number): number {
    const baselineMmr = MMR_CONSTANTS.BASE_MMR; // 1000
    const mmrAboveBaseline = Math.max(0, currentMmr - baselineMmr);
    
    // Calculate convergence factor: K-factor reduces as MMR gets higher
    const convergenceReduction = Math.pow(
      MMR_CONSTANTS.MMR_CONVERGENCE_FACTOR, 
      mmrAboveBaseline / 100 // 5% reduction per 100 MMR above baseline
    );
    
    // Apply convergence to base K-factor
    const dynamicKFactor = MMR_CONSTANTS.K_FACTOR * convergenceReduction;
    
    // Ensure minimum K-factor (never goes below 25% of original)
    const minKFactor = MMR_CONSTANTS.K_FACTOR * 0.25;
    
    return Math.max(minKFactor, dynamicKFactor);
  }

  /**
   * Calculate player count scaling factor for proportional MMR calculation
   * This ensures that guilds with fewer players get proportionally less MMR changes
   */
  private calculatePlayerCountScalingFactor(guildStat: GuildBattleStats): number {
    const playerCount = guildStat.players;
    
    // Guilds with minimum player count or more get full scaling
    if (playerCount >= MMR_CONSTANTS.MIN_PLAYER_COUNT_FOR_FULL_MMR) {
      return 1.0;
    }
    
    // Guilds with very few players get heavily reduced scaling
    if (playerCount <= 1) {
      return 0.1; // 10% of normal MMR change for single players
    }
    
    // Calculate scaling using power function for smooth transition
    // This creates a curve where small guilds get proportionally less MMR
    const scalingFactor = Math.pow(
      playerCount / MMR_CONSTANTS.MIN_PLAYER_COUNT_FOR_FULL_MMR,
      MMR_CONSTANTS.PLAYER_COUNT_SCALING_FACTOR
    );
    
    // Ensure minimum scaling for very small guilds
    return Math.max(0.1, Math.min(1.0, scalingFactor));
  }

  /**
   * Calculate individual performance factor (-1 to 1)
   * This factor rewards guilds that contribute significantly to their alliance's success
   * and penalizes guilds that contribute little despite being in a winning alliance
   */
  private calculateIndividualPerformanceFactor(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): number {
    // If no alliance data available, use individual guild performance
    if (!battleAnalysis.guildAlliances) {
      return this.calculateIndividualGuildPerformance(guildStat, battleAnalysis);
    }

    // Find guild's alliance
    const guildAlliance = battleAnalysis.guildAlliances.get(guildStat.guildName);
    if (!guildAlliance) {
      return this.calculateIndividualGuildPerformance(guildStat, battleAnalysis);
    }

    // Get all guilds in the same alliance
    const allianceGuilds = battleAnalysis.guildStats.filter(g => 
      battleAnalysis.guildAlliances?.get(g.guildName) === guildAlliance
    );

    if (allianceGuilds.length <= 1) {
      return 0; // Single guild alliance, no comparison needed
    }

    // Calculate alliance totals
    const allianceTotalKills = allianceGuilds.reduce((sum, g) => sum + g.kills, 0);
    const allianceTotalDeaths = allianceGuilds.reduce((sum, g) => sum + g.deaths, 0);
    const allianceTotalFameGained = allianceGuilds.reduce((sum, g) => sum + g.fameGained, 0);
    const allianceTotalFameLost = allianceGuilds.reduce((sum, g) => sum + g.fameLost, 0);
    const allianceTotalPlayers = allianceGuilds.reduce((sum, g) => sum + g.players, 0);

    // Calculate guild's contribution ratios
    const killContribution = allianceTotalKills > 0 ? guildStat.kills / allianceTotalKills : 0;
    const deathContribution = allianceTotalDeaths > 0 ? guildStat.deaths / allianceTotalDeaths : 0;
    const fameGainedContribution = allianceTotalFameGained > 0 ? guildStat.fameGained / allianceTotalFameGained : 0;
    const fameLostContribution = allianceTotalFameLost > 0 ? guildStat.fameLost / allianceTotalFameLost : 0;
    const playerContribution = allianceTotalPlayers > 0 ? guildStat.players / allianceTotalPlayers : 0;

    // Calculate performance score (positive for good performance, negative for poor)
    let performanceScore = 0;

    // IMPROVED: More balanced performance calculation that doesn't heavily penalize smaller guilds
    if (playerContribution > 0) {
      const expectedKillRatio = playerContribution;
      const actualKillRatio = killContribution;
      
      // Reduced weight and more balanced calculation
      const killPerformance = (actualKillRatio - expectedKillRatio) * 1.0; // Reduced from 3.0
      performanceScore += killPerformance;
      
      // Only apply severe penalties for very poor performance (less than 30% of expected)
      if (actualKillRatio < expectedKillRatio * 0.3) {
        performanceScore -= 0.2; // Reduced penalty
      }
    }

    // Death contribution (negative impact, but expected based on player count)
    if (playerContribution > 0) {
      const expectedDeathRatio = playerContribution;
      const actualDeathRatio = deathContribution;
      
      // Reduced weight for death performance
      const deathPerformance = (actualDeathRatio - expectedDeathRatio) * 0.8; // Reduced from 2.0
      performanceScore -= deathPerformance;
      
      // Only apply penalties for very high death contribution (more than 200% of expected)
      if (actualDeathRatio > expectedDeathRatio * 2.0) {
        performanceScore -= 0.1; // Reduced penalty
      }
    }

    // Fame efficiency (positive impact) - Reduced weight
    if (playerContribution > 0) {
      const expectedFameRatio = playerContribution;
      const actualFameRatio = fameGainedContribution;
      const famePerformance = (actualFameRatio - expectedFameRatio) * 0.5; // Reduced from 1.5
      performanceScore += famePerformance;
    }

    // Fame loss efficiency (negative impact) - Reduced weight
    if (playerContribution > 0) {
      const expectedFameLossRatio = playerContribution;
      const actualFameLossRatio = fameLostContribution;
      const fameLossPerformance = (actualFameLossRatio - expectedFameLossRatio) * 0.5; // Reduced from 1.5
      performanceScore -= fameLossPerformance;
    }

    // Normalize to -1 to 1 range
    return Math.max(-1, Math.min(1, performanceScore));
  }

  /**
   * Calculate individual guild performance when no alliance data is available
   */
  private calculateIndividualGuildPerformance(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): number {
    // Calculate guild's performance relative to battle averages
    const avgKills = battleAnalysis.guildStats.reduce((sum, g) => sum + g.kills, 0) / battleAnalysis.guildStats.length;
    const avgDeaths = battleAnalysis.guildStats.reduce((sum, g) => sum + g.deaths, 0) / battleAnalysis.guildStats.length;
    const avgFameGained = battleAnalysis.guildStats.reduce((sum, g) => sum + g.fameGained, 0) / battleAnalysis.guildStats.length;
    const avgFameLost = battleAnalysis.guildStats.reduce((sum, g) => sum + g.fameLost, 0) / battleAnalysis.guildStats.length;
    const avgPlayers = battleAnalysis.guildStats.reduce((sum, g) => sum + g.players, 0) / battleAnalysis.guildStats.length;

    // Calculate performance ratios
    const killRatio = avgKills > 0 ? guildStat.kills / avgKills : 0;
    const deathRatio = avgDeaths > 0 ? guildStat.deaths / avgDeaths : 0;
    const fameGainedRatio = avgFameGained > 0 ? guildStat.fameGained / avgFameGained : 0;
    const fameLostRatio = avgFameLost > 0 ? guildStat.fameLost / avgFameLost : 0;
    const playerRatio = avgPlayers > 0 ? guildStat.players / avgPlayers : 0;

    // Calculate performance score
    let performanceScore = 0;

    // Normalize by player count
    if (playerRatio > 0) {
      performanceScore += (killRatio - playerRatio) * 2; // Kills relative to player count
      performanceScore -= (deathRatio - playerRatio) * 1.5; // Deaths relative to player count
      performanceScore += (fameGainedRatio - playerRatio) * 1.0; // Fame gained relative to player count
      performanceScore -= (fameLostRatio - playerRatio) * 1.0; // Fame lost relative to player count
    }

    // Normalize to -1 to 1 range
    return Math.max(-1, Math.min(1, performanceScore));
  }



  /**
   * Check if battle meets MMR calculation criteria
   */
  static shouldCalculateMmr(totalPlayers: number, totalFame: number): boolean {
    return (
      totalPlayers >= MMR_CONSTANTS.MIN_BATTLE_SIZE &&
      totalFame >= MMR_CONSTANTS.MIN_BATTLE_FAME
    );
  }

  /**
   * Update guild season MMR in database with detailed logging
   * Note: This function is only called for battles that have already passed MMR eligibility checks
   */
  async updateGuildSeasonMmr(
    guildId: string,
    seasonId: string,
    mmrChange: number,
    battleStats: GuildBattleStats,
    battleAnalysis: BattleAnalysis,
    antiFarmingFactor?: number
  ): Promise<void> {
    try {
      // Check if this battle has already been processed for this guild to prevent duplicate updates
      const existingLog = await this.prisma.mmrCalculationLog.findFirst({
        where: {
          battleId: battleAnalysis.battleId,
          seasonId: seasonId,
          guildId: guildId
        }
      });

      if (existingLog) {
        console.log(`⚠️ Battle ${battleAnalysis.battleId} already processed for guild ${guildId}, skipping duplicate update`);
        return;
      }

      // Get or create guild season record
      let guildSeason = await this.prisma.guildSeason.findUnique({
        where: { guildId_seasonId: { guildId, seasonId } },
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
            primeTimeBattles: 0,
            // Initialize MMR-eligible battle statistics
            totalBattlesMmre: 0,
            winsMmre: 0,
            lossesMmre: 0,
            totalFameGainedMmre: 0n,
            totalFameLostMmre: 0n,
            primeTimeBattlesMmre: 0,
          },
        });
      }

      // Calculate new MMR
      const newMmr = Math.max(0, guildSeason.currentMmr + mmrChange);

      // Determine win/loss
      const isWin =
        this.calculateWinLossFactor(battleStats, battleAnalysis) > 0;

      // This function is only called for MMR-eligible battles
      // so we can always increment the MMRE statistics
      const isMmreBattle = true;

      // Use a transaction to ensure atomicity and prevent race conditions
      await this.prisma.$transaction(async (tx) => {
        // First, try to create the MMR calculation log to claim this battle+guild combination
        // This will fail if another process already processed this combination
        await this.logMmrCalculationInTransaction(
          tx,
          guildId,
          seasonId,
          guildSeason.currentMmr,
          mmrChange,
          newMmr,
          battleStats,
          battleAnalysis,
          isWin,
          antiFarmingFactor
        );

        // Only if the log creation succeeds, update the guild season statistics
        await tx.guildSeason.update({
          where: { id: guildSeason.id },
          data: {
            currentMmr: newMmr,
            totalBattles: guildSeason.totalBattles + 1,
            wins: guildSeason.wins + (isWin ? 1 : 0),
            losses: guildSeason.losses + (isWin ? 0 : 1),
            totalFameGained:
              guildSeason.totalFameGained + BigInt(battleStats.fameGained),
            totalFameLost:
              guildSeason.totalFameLost + BigInt(battleStats.fameLost),
            primeTimeBattles:
              guildSeason.primeTimeBattles + (battleStats.isPrimeTime ? 1 : 0),
            lastBattleAt: new Date(),
            
            // Update MMR-eligible battle statistics
            totalBattlesMmre: isMmreBattle ? guildSeason.totalBattlesMmre + 1 : guildSeason.totalBattlesMmre,
            winsMmre: isMmreBattle ? guildSeason.winsMmre + (isWin ? 1 : 0) : guildSeason.winsMmre,
            lossesMmre: isMmreBattle ? guildSeason.lossesMmre + (isWin ? 0 : 1) : guildSeason.lossesMmre,
            totalFameGainedMmre: isMmreBattle ? 
              guildSeason.totalFameGainedMmre + BigInt(battleStats.fameGained) : 
              guildSeason.totalFameGainedMmre,
            totalFameLostMmre: isMmreBattle ? 
              guildSeason.totalFameLostMmre + BigInt(battleStats.fameLost) : 
              guildSeason.totalFameLostMmre,
            primeTimeBattlesMmre: isMmreBattle ? 
              guildSeason.primeTimeBattlesMmre + (battleStats.isPrimeTime ? 1 : 0) : 
              guildSeason.primeTimeBattlesMmre,
            lastBattleMmreAt: isMmreBattle ? new Date() : guildSeason.lastBattleMmreAt,
          },
        });
      });

      // Update prime time mass for eligible guilds (function will determine if it's actually prime time)
      await this.updatePrimeTimeMass(
        guildSeason.id,
        battleStats.players,
        battleAnalysis.battleId
      );

      logger.info("Updated guild season MMR", {
        guildId,
        seasonId,
        oldMmr: guildSeason.currentMmr,
        newMmr,
        mmrChange,
        isWin,
        isPrimeTime: battleStats.isPrimeTime,
        antiFarmingFactor,
      });
    } catch (error) {
      logger.error("Error updating guild season MMR", {
        guildId,
        seasonId,
        mmrChange,
        error: error instanceof Error ? error.message : "Unknown error",
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
      logger.debug('Updating prime time mass for battle', {
        battleId: battleId.toString(),
        playerCount
      });

      // Get the battle to determine which prime time window it falls into
      const battle = await this.prisma.battle.findUnique({
        where: { albionId: battleId },
      });

      if (!battle) {
        logger.warn("Battle not found for prime time mass update", {
          battleId: battleId.toString(),
        });
        return;
      }

      // Get global prime time windows
      const primeTimeWindows = await this.prisma.primeTimeWindow.findMany();
      logger.debug('Found prime time windows', {
        battleId: battleId.toString(),
        windowCount: primeTimeWindows.length
      });

      // Find which prime time window this battle falls into
      const battleHour = battle.startedAt.getUTCHours();
      logger.debug('Battle hour for prime time analysis', {
        battleId: battleId.toString(),
        battleHour
      });

      const matchingWindow = primeTimeWindows.find((window) => {
        if (window.startHour <= window.endHour) {
          // Same day window (e.g., 20:00 to 22:00)
          return battleHour >= window.startHour && battleHour < window.endHour;
        } else {
          // Overnight window (e.g., 22:00 to 02:00)
          return battleHour >= window.startHour || battleHour < window.endHour;
        }
      });

      if (!matchingWindow) {
        logger.debug("Battle does not fall into any prime time window", {
          battleId: battleId.toString(),
          battleHour,
          primeTimeWindows: primeTimeWindows.map(
            (w) => `${w.startHour}-${w.endHour}`
          ),
        });
        return;
      }

      logger.debug('Found matching prime time window', {
        battleId: battleId.toString(),
        windowStart: matchingWindow.startHour,
        windowEnd: matchingWindow.endHour
      });

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

        logger.debug('Created new prime time mass record', {
          guildSeasonId,
          primeTimeWindowId: matchingWindow.id,
          avgMass: playerCount,
          battleCount: 1
        });
      } else {
        // Update existing record with running average
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

        logger.debug('Updated existing prime time mass record', {
          guildSeasonId,
          primeTimeWindowId: matchingWindow.id,
          oldAvgMass: primeTimeMass.avgMass,
          newAvgMass: newAvgMass,
          oldBattleCount: primeTimeMass.battleCount,
          newBattleCount: newBattleCount
        });
      }

      logger.debug("Successfully updated prime time mass", {
        guildSeasonId,
        primeTimeWindow: `${matchingWindow.startHour}:00-${matchingWindow.endHour}:00`,
        playerCount,
        battleId: battleId.toString(),
        finalAvgMass: primeTimeMass.avgMass,
        finalBattleCount: primeTimeMass.battleCount
      });
    } catch (error) {
      logger.error("Error updating prime time mass", {
        guildSeasonId,
        playerCount,
        battleId: battleId.toString(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  /**
   * Get prime time mass data for a guild season
   */
  async getGuildPrimeTimeMass(guildSeasonId: string): Promise<any[]> {
    try {
      return await this.prisma.guildPrimeTimeMass.findMany({
        where: { guildSeasonId },
        include: { primeTimeWindow: true }
      });
    } catch (error) {
      logger.error("Error getting guild prime time mass", {
        guildSeasonId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return [];
    }
  }

  /**
   * Get guild season MMR
   */
  async getGuildSeasonMmr(
    guildId: string,
    seasonId: string
  ): Promise<GuildSeason | null> {
    try {
      return await this.prisma.guildSeason.findUnique({
        where: { guildId_seasonId: { guildId, seasonId } },
      });
    } catch (error) {
      logger.error("Error getting guild season MMR", {
        guildId,
        seasonId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * Get top guilds by MMR for a season
   */
  async getTopGuildsByMmr(
    seasonId: string,
    limit: number = 100
  ): Promise<GuildSeason[]> {
    try {
      return await this.prisma.guildSeason.findMany({
        where: { seasonId },
        orderBy: { currentMmr: "desc" },
        take: limit,
        include: {
          guild: true,
        },
      });
    } catch (error) {
      logger.error("Error getting top guilds by MMR", {
        seasonId,
        limit,
        error: error instanceof Error ? error.message : "Unknown error",
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
      logger.info("Processing MMR carryover for season end", { seasonId });

      // Get all guild seasons for the ending season
      const guildSeasons = await this.prisma.guildSeason.findMany({
        where: { seasonId },
        include: { guild: true },
      });

      logger.info("Found guild seasons for carryover", {
        seasonId,
        guildCount: guildSeasons.length,
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

        logger.debug("Calculated carryover MMR for guild", {
          guildId: guildSeason.guildId,
          guildName: guildSeason.guild.name,
          finalMmr: guildSeason.currentMmr,
          carryoverMmr,
        });
      }

      logger.info("Completed MMR carryover processing", {
        seasonId,
        processedGuilds: guildSeasons.length,
      });
    } catch (error) {
      logger.error("Error processing season end MMR carryover", {
        seasonId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  /**
   * Initialize new season with carryover MMR from previous season
   * This should be called when starting a new season
   */
  async initializeNewSeason(
    newSeasonId: string,
    previousSeasonId: string
  ): Promise<void> {
    try {
      logger.info("Initializing new season with MMR carryover", {
        newSeasonId,
        previousSeasonId,
      });

      // Get all guild seasons from the previous season
      const previousGuildSeasons = await this.prisma.guildSeason.findMany({
        where: { seasonId: previousSeasonId },
        include: { guild: true },
      });

      logger.info("Found previous season guilds for carryover", {
        previousSeasonId,
        guildCount: previousGuildSeasons.length,
      });

      // Create new guild season records with carryover MMR
      for (const previousGuildSeason of previousGuildSeasons) {
        // TODO: Use carryoverMmr field when Prisma client is regenerated
        // const carryoverMmr = previousGuildSeason.carryoverMmr || MMR_CONSTANTS.BASE_MMR;
        const carryoverMmr = this.calculateCarryoverMmr(
          previousGuildSeason.currentMmr
        );

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
            primeTimeBattles: 0,
            // TODO: Add these fields when Prisma client is regenerated
            // carryoverMmr: null, // Reset for new season
            // seasonEndMmr: null
          },
        });

        logger.debug("Created new guild season with carryover MMR", {
          guildId: previousGuildSeason.guildId,
          guildName: previousGuildSeason.guild.name,
          newSeasonId,
          carryoverMmr,
        });
      }

      logger.info("Completed new season initialization", {
        newSeasonId,
        previousSeasonId,
        initializedGuilds: previousGuildSeasons.length,
      });
    } catch (error) {
      logger.error("Error initializing new season with MMR carryover", {
        newSeasonId,
        previousSeasonId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }


  /**
   * Log MMR calculation details within a transaction (for atomicity)
   */
  private async logMmrCalculationInTransaction(
    tx: any,
    guildId: string,
    seasonId: string,
    previousMmr: number,
    mmrChange: number,
    newMmr: number,
    battleStats: GuildBattleStats,
    battleAnalysis: BattleAnalysis,
    isWin: boolean,
    antiFarmingFactor?: number
  ): Promise<void> {
    // Calculate all the individual factors for detailed logging
    const winLossFactor = this.calculateWinLossFactor(
      battleStats,
      battleAnalysis
    );
    const fameFactor = this.calculateFameFactor(battleStats, battleAnalysis);
    const playerCountFactor = this.calculatePlayerCountFactor(
      battleStats,
      battleAnalysis
    );
    const ipFactor = this.calculateIpFactor(battleStats, battleAnalysis);
    const battleSizeFactor = this.calculateBattleSizeFactor(battleAnalysis);
    const kdFactor = this.calculateKdFactor(battleStats);
    const durationFactor = this.calculateDurationFactor(battleAnalysis);
    const clusteringFactor = this.calculateClusteringFactor(battleStats);
    const opponentStrengthFactor = this.calculateOpponentStrengthFactor(
      battleStats,
      battleAnalysis
    );

    // Calculate weighted contributions
    const winLossContribution = winLossFactor * MMR_CONSTANTS.WIN_LOSS_WEIGHT;
    const fameContribution = fameFactor * MMR_CONSTANTS.FAME_WEIGHT;
    const playerCountContribution =
      playerCountFactor * MMR_CONSTANTS.PLAYER_COUNT_WEIGHT;
    const ipContribution = ipFactor * MMR_CONSTANTS.IP_WEIGHT;
    const battleSizeContribution =
      battleSizeFactor * MMR_CONSTANTS.BATTLE_SIZE_WEIGHT;
    const kdContribution = kdFactor * MMR_CONSTANTS.KD_RATIO_WEIGHT;
    const durationContribution =
      durationFactor * MMR_CONSTANTS.BATTLE_DURATION_WEIGHT;
    const clusteringContribution =
      clusteringFactor * MMR_CONSTANTS.KILL_CLUSTERING_WEIGHT;
    const opponentStrengthContribution =
      opponentStrengthFactor * MMR_CONSTANTS.OPPONENT_MMR_WEIGHT;

    // Calculate total weighted score
    const totalWeightedScore =
      winLossContribution +
      fameContribution +
      playerCountContribution +
      ipContribution +
      battleSizeContribution +
      kdContribution +
      durationContribution +
      clusteringContribution +
      opponentStrengthContribution;

    // Get opponent information
    const opponentGuilds = battleAnalysis.guildStats
      .filter((g) => g.guildId !== guildId)
      .map((g) => g.guildName);

    const opponentMmrs = battleAnalysis.guildStats
      .filter((g) => g.guildId !== guildId)
      .map((g) => g.currentMmr);

    // Get alliance information
    const allianceName = battleAnalysis.guildAlliances?.get(battleStats.guildName) ?? null;

    // Check significant participation
    const hasSignificantParticipation =
      MmrService.hasSignificantParticipation(battleStats, battleAnalysis);

    // Create MMR calculation log entry using CREATE (not upsert) to enforce uniqueness
    await tx.mmrCalculationLog.create({
      data: {
        battleId: battleAnalysis.battleId,
        seasonId,
        guildId,
        guildName: battleStats.guildName,
        previousMmr,
        mmrChange,
        newMmr,
        kills: battleStats.kills,
        deaths: battleStats.deaths,
        fameGained: BigInt(battleStats.fameGained),
        fameLost: BigInt(battleStats.fameLost),
        players: battleStats.players,
        avgIP: battleStats.avgIP,
        isPrimeTime: battleStats.isPrimeTime,
        totalBattlePlayers: battleAnalysis.totalPlayers,
        totalBattleFame: BigInt(battleAnalysis.totalFame),
        battleDuration: battleAnalysis.battleDuration,
        killClustering: battleStats.killClustering,
        winLossFactor,
        fameFactor,
        playerCountFactor,
        ipFactor,
        battleSizeFactor,
        kdFactor,
        durationFactor,
        clusteringFactor,
        opponentStrengthFactor,
        winLossContribution,
        fameContribution,
        playerCountContribution,
        ipContribution,
        battleSizeContribution,
        kdContribution,
        durationContribution,
        clusteringContribution,
        opponentStrengthContribution,
        totalWeightedScore,
        kFactorApplied: MMR_CONSTANTS.K_FACTOR,
        isWin,
        hasSignificantParticipation,
        allianceName,
        opponentGuilds,
        opponentMmrs,
        antiFarmingFactor: antiFarmingFactor ?? null,
        originalMmrChange: antiFarmingFactor !== undefined && antiFarmingFactor < 1.0 ? mmrChange / antiFarmingFactor : null,
        calculationVersion: "1.0",
        processedAt: new Date()
      }
    });

    logger.debug("Logged MMR calculation details", {
      guildId,
      battleId: battleAnalysis.battleId.toString(),
      mmrChange,
      factors: {
        winLoss: winLossFactor,
        fame: fameFactor,
        playerCount: playerCountFactor,
        ip: ipFactor,
        battleSize: battleSizeFactor,
        kd: kdFactor,
        duration: durationFactor,
        clustering: clusteringFactor,
      },
    });
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
   * Get the currently active season
   */
  async getCurrentActiveSeason(): Promise<{ id: string; name: string } | null> {
    try {
      const activeSeason = await this.prisma.season.findFirst({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { startDate: 'desc' }
      });

      return activeSeason;
    } catch (error) {
      logger.error("Error getting current active season", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    }
  }

  /**
   * Get carryover MMR for a guild from the previous season
   */
  async getCarryoverMmr(
    guildId: string,
    currentSeasonId: string
  ): Promise<number> {
    try {
      // Find the previous season
      const currentSeason = await this.prisma.season.findUnique({
        where: { id: currentSeasonId },
      });

      if (!currentSeason) {
        return MMR_CONSTANTS.BASE_MMR;
      }

      const previousSeason = await this.prisma.season.findFirst({
        where: {
          startDate: { lt: currentSeason.startDate },
        },
        orderBy: { startDate: "desc" },
      });

      if (!previousSeason) {
        return MMR_CONSTANTS.BASE_MMR;
      }

      // Get the guild's season record from the previous season
      const previousGuildSeason = await this.prisma.guildSeason.findUnique({
        where: { guildId_seasonId: { guildId, seasonId: previousSeason.id } },
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
      logger.error("Error getting carryover MMR", {
        guildId,
        currentSeasonId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return MMR_CONSTANTS.BASE_MMR; // Return base MMR on error
    }
  }

  /**
   * Check if a guild has significant participation in a battle
   * Uses improved thresholds with both relative and absolute minimums
   */
  static hasSignificantParticipation(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): boolean {
    const totalBattleFame = battleAnalysis.totalFame;
    const totalBattlePlayers = battleAnalysis.totalPlayers;
    const totalBattleKills = battleAnalysis.guildStats.reduce(
      (sum, g) => sum + g.kills,
      0
    );
    const totalBattleDeaths = battleAnalysis.guildStats.reduce(
      (sum, g) => sum + g.deaths,
      0
    );
    const totalBattleKillsDeaths = totalBattleKills + totalBattleDeaths;

    // Calculate guild's participation ratios
    const guildFameParticipation = guildStat.fameGained + guildStat.fameLost;
    const guildKillsDeaths = guildStat.kills + guildStat.deaths;

    const fameRatio =
      totalBattleFame > 0 ? guildFameParticipation / totalBattleFame : 0;
    const killsDeathsRatio =
      totalBattleKillsDeaths > 0
        ? guildKillsDeaths / totalBattleKillsDeaths
        : 0;
    const playerRatio =
      totalBattlePlayers > 0 ? guildStat.players / totalBattlePlayers : 0;

    // Check if guild is from a major participating alliance
    const isFromMajorAlliance = this.isFromMajorParticipatingAlliance(
      guildStat,
      battleAnalysis
    );

    // Apply alliance bonus if guild is from major participating alliance
    const allianceBonus = isFromMajorAlliance
      ? MMR_CONSTANTS.ALLIANCE_PARTICIPATION_BONUS
      : 0;
    const adjustedFameThreshold =
      MMR_CONSTANTS.MIN_FAME_PARTICIPATION_RATIO * (1 - allianceBonus);
    const adjustedKillsDeathsThreshold =
      MMR_CONSTANTS.MIN_KILLS_DEATHS_RATIO * (1 - allianceBonus);
    const adjustedPlayerThreshold =
      MMR_CONSTANTS.MIN_PLAYER_RATIO * (1 - allianceBonus);

    // IMPROVED: Check both relative and absolute participation criteria with battle size scaling
    const isSmallBattle = totalBattleKillsDeaths <= MMR_CONSTANTS.SMALL_BATTLE_THRESHOLD;
    
    // Adjust absolute thresholds based on battle size
    const adjustedAbsoluteFameThreshold = isSmallBattle 
      ? MMR_CONSTANTS.MIN_ABSOLUTE_FAME_PARTICIPATION * MMR_CONSTANTS.SMALL_BATTLE_FAME_MULTIPLIER
      : MMR_CONSTANTS.MIN_ABSOLUTE_FAME_PARTICIPATION;
    
    const adjustedAbsoluteKillsDeathsThreshold = isSmallBattle
      ? MMR_CONSTANTS.MIN_ABSOLUTE_KILLS_DEATHS * MMR_CONSTANTS.SMALL_BATTLE_KILLS_DEATHS_MULTIPLIER
      : MMR_CONSTANTS.MIN_ABSOLUTE_KILLS_DEATHS;
    
    const adjustedAbsolutePlayerThreshold = isSmallBattle
      ? MMR_CONSTANTS.MIN_ABSOLUTE_PLAYERS
      : MMR_CONSTANTS.MIN_ABSOLUTE_PLAYERS;
    
    const hasFameParticipation = fameRatio >= adjustedFameThreshold || 
                                guildFameParticipation >= adjustedAbsoluteFameThreshold;
    const hasKillsDeathsParticipation = killsDeathsRatio >= adjustedKillsDeathsThreshold || 
                                       guildKillsDeaths >= adjustedAbsoluteKillsDeathsThreshold;
    // IMPROVED: More lenient player participation when player data is missing or unreliable
    const hasPlayerParticipation = playerRatio >= adjustedPlayerThreshold || 
                                  guildStat.players >= adjustedAbsolutePlayerThreshold ||
                                  (guildStat.players === 0 && (guildStat.kills > 0 || guildStat.deaths > 0)); // Allow if no player data but has kills/deaths

    // IMPROVED: Proportional criteria for single-player guilds based on battle size
    const isSinglePlayer = guildStat.players <= 1;
    
    // Scale single player thresholds based on battle size
    const singlePlayerKillsDeathsThreshold = isSmallBattle 
      ? Math.max(2, Math.ceil(totalBattleKillsDeaths * 0.2)) // 20% of total kills+deaths, minimum 2
      : 8; // Large battles keep the original threshold
    
    const singlePlayerFameThreshold = isSmallBattle
      ? Math.max(100000, totalBattleFame * 0.1) // 10% of total fame, minimum 100K
      : 1000000; // Large battles keep the original threshold
    
    const hasSignificantKillsDeaths = guildKillsDeaths >= singlePlayerKillsDeathsThreshold;
    const hasSignificantFame = guildFameParticipation >= singlePlayerFameThreshold;
    
    // IMPROVED: Guild must meet at least 2 out of 3 criteria, or be from a major alliance
    // Additionally, must have at least some meaningful participation (kills OR deaths)
    const hasAnyKillsOrDeaths = guildStat.kills > 0 || guildStat.deaths > 0;
    
    // For single players, require higher thresholds
    if (isSinglePlayer) {
      // IMPROVED: More lenient for single players when player data is missing
      if (guildStat.players === 0) {
        // If no player data, use regular participation logic instead of strict single player logic
        const participationScore = [
          hasFameParticipation,
          hasKillsDeathsParticipation,
          hasPlayerParticipation,
        ].filter(Boolean).length;
        
        return participationScore >= 2 && hasAnyKillsOrDeaths;
      } else {
        // Original strict single player logic for actual single players
        const hasSignificantParticipationForSinglePlayer = 
          hasAnyKillsOrDeaths && 
          hasSignificantKillsDeaths && 
          hasSignificantFame;
        
        return hasSignificantParticipationForSinglePlayer;
      }
    }
    
    const participationScore = [
      hasFameParticipation,
      hasKillsDeathsParticipation,
      hasPlayerParticipation,
    ].filter(Boolean).length;

    // For small guilds (2-3 players), require stricter criteria even with alliance bonus
    const isSmallGuild = guildStat.players <= 3;
    const hasSignificantParticipationForSmallGuild = 
      participationScore >= 2 && hasAnyKillsOrDeaths && guildKillsDeaths >= 3;

    if (isSmallGuild) {
      return hasSignificantParticipationForSmallGuild;
    }

    const hasSignificantParticipation =
      (participationScore >= 2 && hasAnyKillsOrDeaths) || isFromMajorAlliance;

    // Log detailed participation analysis (debug level to reduce Railway rate limiting)
    logger.debug('Guild participation analysis', {
      guildName: guildStat.guildName,
      fameParticipation: {
        guild: guildFameParticipation,
        total: totalBattleFame,
        ratio: fameRatio,
        threshold: adjustedFameThreshold
      },
      killsDeathsParticipation: {
        guild: guildKillsDeaths,
        total: totalBattleKillsDeaths,
        ratio: killsDeathsRatio,
        threshold: adjustedKillsDeathsThreshold
      },
      playerParticipation: {
        guild: guildStat.players,
        total: totalBattlePlayers,
        ratio: playerRatio,
        threshold: adjustedPlayerThreshold
      },
      isFromMajorAlliance,
      participationScore,
      hasSignificantParticipation
    });

    return hasSignificantParticipation;
  }

  /**
   * Check if guild is from a major participating alliance in the battle
   * Major alliances are those that have significant participation in the battle
   */
  private static isFromMajorParticipatingAlliance(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): boolean {
    // Get alliance data from the battle analysis context
    // This should be passed from the battle data (alliancesJson or kills data)
    const guildAlliance = MmrService.getGuildAllianceStatic(
      guildStat.guildName,
      battleAnalysis
    );
    if (!guildAlliance) return false;

    // Calculate total participation by alliance from the battle data
    const allianceStats = new Map<
      string,
      { fame: number; killsDeaths: number; players: number }
    >();

    for (const guild of battleAnalysis.guildStats) {
      const allianceName = MmrService.getGuildAllianceStatic(
        guild.guildName,
        battleAnalysis
      );
      if (!allianceName) continue;

      const stats = allianceStats.get(allianceName) || {
        fame: 0,
        killsDeaths: 0,
        players: 0,
      };
      stats.fame += guild.fameGained + guild.fameLost;
      stats.killsDeaths += guild.kills + guild.deaths;
      stats.players += guild.players;
      allianceStats.set(allianceName, stats);
    }

    // Sort alliances by total fame to find major participants
    const sortedAlliances = Array.from(allianceStats.entries()).sort(
      ([, a], [, b]) => b.fame - a.fame
    );

    // Consider top 3 alliances as major participants
    const majorAlliances = sortedAlliances.slice(0, 3).map(([name]) => name);

    return majorAlliances.includes(guildAlliance);
  }

  /**
   * Get guild's alliance from battle data
   * Uses actual alliance data from the battle context
   */
  private getGuildAlliance(
    guildName: string,
    battleAnalysis: BattleAnalysis
  ): string | null {
    // Use the alliance mapping from battle analysis if available
    if (battleAnalysis.guildAlliances) {
      return battleAnalysis.guildAlliances.get(guildName) || null;
    }

    // Fallback: try to extract from kills data if available
    // This would require passing kills data to the battle analysis
    return null;
  }

  /**
   * Static version of getGuildAlliance for use in static methods
   */
  private static getGuildAllianceStatic(
    guildName: string,
    battleAnalysis: BattleAnalysis
  ): string | null {
    // Use the alliance mapping from battle analysis if available
    if (battleAnalysis.guildAlliances) {
      return battleAnalysis.guildAlliances.get(guildName) || null;
    }

    // Fallback: try to extract from kills data if available
    // This would require passing kills data to the battle analysis
    return null;
  }

  /**
   * Detect if a guild is farming low-IP opponents
   * Returns true if the guild is fighting against multiple low-IP opponents
   */
  private detectIpFarming(
    guildStat: GuildBattleStats,
    battleAnalysis: BattleAnalysis
  ): boolean {
    // Get the guild's alliance
    const guildAlliance = this.getGuildAlliance(guildStat.guildName, battleAnalysis);
    
    // Filter out allied guilds - only consider enemy guilds for IP farming detection
    const enemyGuilds = battleAnalysis.guildStats.filter(g => {
      if (g.guildId === guildStat.guildId) return false; // Skip self
      
      // If no alliance data available, treat all other guilds as enemies
      if (!battleAnalysis.guildAlliances || !guildAlliance) return true;
      
      // Get the other guild's alliance
      const otherGuildAlliance = battleAnalysis.guildAlliances.get(g.guildName);
      
      // If the other guild has no alliance, treat as enemy
      if (!otherGuildAlliance) return true;
      
      // Only consider as enemy if they're from different alliances
      return otherGuildAlliance !== guildAlliance;
    });

    if (enemyGuilds.length === 0) return false; // No enemies, no farming

    // Count how many enemy guilds have low IP
    const lowIpEnemies = enemyGuilds.filter(g => g.avgIP < MMR_CONSTANTS.LOW_IP_THRESHOLD);
    const lowIpRatio = lowIpEnemies.length / enemyGuilds.length;

    // Check if enough opponents have low IP to consider this farming
    const isFarming = lowIpRatio >= MMR_CONSTANTS.IP_FARMING_OPPONENT_THRESHOLD;

    if (isFarming) {
      logger.debug('IP farming detected', {
        guildName: guildStat.guildName,
        totalEnemies: enemyGuilds.length,
        lowIpEnemies: lowIpEnemies.length,
        lowIpRatio: lowIpRatio.toFixed(2),
        threshold: MMR_CONSTANTS.IP_FARMING_OPPONENT_THRESHOLD,
        lowIpEnemyNames: lowIpEnemies.map(g => `${g.guildName} (IP: ${g.avgIP})`)
      });
    }

    return isFarming;
  }

  /**
   * Calculate anti-farming factor to prevent guilds from farming weaker opponents
   * This reduces MMR gains when a guild has repeatedly won against the same opponent
   */
  private async calculateAntiFarmingFactor(
    guildId: string,
    seasonId: string,
    opponentGuilds: string[],
    isWin: boolean
  ): Promise<number> {
    try {
      // Only apply anti-farming to wins (we don't want to reduce losses)
      if (!isWin || opponentGuilds.length === 0) {
        return 1.0; // No reduction
      }

      // Look back 30 days for recent wins against these opponents
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - MMR_CONSTANTS.ANTI_FARMING_SEASON_LOOKBACK_DAYS);

      // Get recent wins against each opponent
      const recentWins = await this.prisma.mmrCalculationLog.findMany({
        where: {
          guildId,
          seasonId,
          isWin: true,
          processedAt: {
            gte: lookbackDate
          },
          opponentGuilds: {
            hasSome: opponentGuilds
          }
        },
        select: {
          opponentGuilds: true,
          processedAt: true
        },
        orderBy: {
          processedAt: 'desc'
        }
      });

      if (recentWins.length === 0) {
        return 1.0; // No recent wins, no reduction
      }

      // Count wins against each opponent
      const opponentWinCounts = new Map<string, number>();
      
      for (const win of recentWins) {
        for (const opponent of win.opponentGuilds) {
          if (opponentGuilds.includes(opponent)) {
            opponentWinCounts.set(opponent, (opponentWinCounts.get(opponent) || 0) + 1);
          }
        }
      }

      // Calculate the maximum win count against any opponent in this battle
      let maxWinsAgainstOpponent = 0;
      for (const opponent of opponentGuilds) {
        const winCount = opponentWinCounts.get(opponent) || 0;
        maxWinsAgainstOpponent = Math.max(maxWinsAgainstOpponent, winCount);
      }

      // Apply anti-farming reduction
      if (maxWinsAgainstOpponent <= MMR_CONSTANTS.ANTI_FARMING_WIN_THRESHOLD) {
        return 1.0; // No reduction for wins under threshold
      }

      // Calculate reduction factor
      const winsOverThreshold = maxWinsAgainstOpponent - MMR_CONSTANTS.ANTI_FARMING_WIN_THRESHOLD;
      const maxWinsOverThreshold = MMR_CONSTANTS.ANTI_FARMING_MAX_WINS - MMR_CONSTANTS.ANTI_FARMING_WIN_THRESHOLD;
      
      // Linear reduction from 1.0 to 0.0 over the remaining wins
      const reductionFactor = Math.max(0.0, 1.0 - (winsOverThreshold / maxWinsOverThreshold));

      logger.debug('Anti-farming factor calculated', {
        guildId,
        opponentGuilds,
        maxWinsAgainstOpponent,
        winsOverThreshold,
        reductionFactor,
        recentWinsCount: recentWins.length
      });

      return reductionFactor;

    } catch (error) {
      logger.error('Error calculating anti-farming factor', {
        guildId,
        opponentGuilds,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 1.0; // Return no reduction on error
    }
  }
}
