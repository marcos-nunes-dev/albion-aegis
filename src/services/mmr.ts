import { PrismaClient } from "@prisma/client";
import { log } from "../log.js";
import type { GuildSeason } from "../types/mmr.js";

const logger = log.child({ component: "mmr-service" });

// MMR calculation constants
const MMR_CONSTANTS = {
  BASE_MMR: 1000.0,
  K_FACTOR: 32, // How much MMR can change in a single battle
  WIN_LOSS_WEIGHT: 0.35, // 35% weight for win/loss (reduced from 40%)
  FAME_WEIGHT: 0.15, // 15% weight for fame differential (reduced from 20%)
  PLAYER_COUNT_WEIGHT: 0.25, // 25% weight for player count advantage (increased from 10%)
  IP_WEIGHT: 0.05, // 5% weight for IP level differences (reduced from 10%)
  BATTLE_SIZE_WEIGHT: 0.05, // 5% weight for battle size
  KD_RATIO_WEIGHT: 0.05, // 5% weight for kill/death ratio
  BATTLE_DURATION_WEIGHT: 0.03, // 3% weight for battle duration (reduced from 5%)
  KILL_CLUSTERING_WEIGHT: 0.02, // 2% weight for kill clustering (reduced from 5%)
  OPPONENT_MMR_WEIGHT: 0.15, // 15% weight for opponent MMR strength (reduced from 20%)
  INDIVIDUAL_PERFORMANCE_WEIGHT: 0.05, // 5% weight for individual guild performance within alliance (reduced from 15%)
  FRIEND_DETECTION_THRESHOLD: 0.1, // 10% of total kills to consider as friend
  MIN_BATTLE_SIZE: 25, // Minimum players for MMR calculation
  MIN_BATTLE_FAME: 2000000, // Minimum fame for MMR calculation (2M)
  SEASON_CARRYOVER_RATIO: 0.3, // 30% of previous season MMR carries over
  
  // IMPROVED: Much stricter participation thresholds to filter out minimal participants
  MIN_FAME_PARTICIPATION_RATIO: 0.10, // 10% of total battle fame for participation (increased from 2%)
  MIN_KILLS_DEATHS_RATIO: 0.10, // 10% of total battle kills+deaths for participation (increased from 3%)
  MIN_PLAYER_RATIO: 0.10, // 10% of total battle players for participation (increased from 3%)
  
  // IMPROVED: Higher absolute thresholds for minimum participation
  MIN_ABSOLUTE_FAME_PARTICIPATION: 500000, // Minimum 500K fame gained or lost (increased from 200K)
  MIN_ABSOLUTE_KILLS_DEATHS: 5, // Minimum 5 kills OR deaths combined (increased from 2)
  MIN_ABSOLUTE_PLAYERS: 3, // Minimum 3 players for significant participation (increased from 2)
  
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
  MIN_MMR_LOSS_FOR_LOSS: 8, // Minimum points lost for losses
  ANTI_FARMING_SEASON_LOOKBACK_DAYS: 30, // Look back 30 days for anti-farming
  ANTI_FARMING_WIN_THRESHOLD: 3, // Wins against an opponent before reduction
  ANTI_FARMING_MAX_WINS: 10, // Maximum wins against an opponent before full reduction
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

      // Calculate base MMR changes for each guild
      for (const guildStat of battleAnalysis.guildStats) {
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
      
      // Apply K-factor and ensure reasonable bounds
      let finalMmrChange = Math.max(
        -MMR_CONSTANTS.K_FACTOR,
        Math.min(
          MMR_CONSTANTS.K_FACTOR,
          totalMmrChange * MMR_CONSTANTS.K_FACTOR * playerCountScalingFactor
        )
      );

      // Apply additional constraints for easy wins and losses
      const isWin = this.calculateWinLossFactor(guildStat, battleAnalysis) > 0;
      
      if (isWin && finalMmrChange > 0) {
        // Cap easy wins to prevent excessive MMR gain
        finalMmrChange = Math.min(finalMmrChange, MMR_CONSTANTS.MAX_MMR_GAIN_FOR_EASY_WIN);
      } else if (!isWin && finalMmrChange < 0) {
        // Ensure losses lose a minimum amount of points
        finalMmrChange = Math.min(finalMmrChange, -MMR_CONSTANTS.MIN_MMR_LOSS_FOR_LOSS);
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
   * Now properly handles alliances - only considers enemy guilds for win/loss calculation
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

    // Calculate total kills from enemy guilds only
    const enemyTotalKills = enemyGuilds.reduce((sum, g) => sum + g.kills, 0);
    const totalKills = guildStat.kills + enemyTotalKills;
    
    if (totalKills === 0) return 0; // No kills in battle
    
    const guildKillRatio = guildStat.kills / totalKills;

    // Determine if guild won against enemies (had significant kills vs enemies)
    const isWinner = guildKillRatio > 0.3; // Guild won if they got >30% of total kills
    const isLoser = guildStat.deaths > guildStat.kills * 2; // Guild lost if deaths > 2x kills

    // If there are no enemies (all guilds are allies), return neutral
    if (enemyGuilds.length === 0) {
      return 0; // Neutral - no enemies to win/lose against
    }

    if (isWinner) return 1;
    if (isLoser) return -1;
    return 0; // Neutral
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
          const allianceRatio = alliancePlayers / opponentPlayers;
          
          // Apply underdog bonuses and advantage penalties based on alliance totals
          if (allianceRatio >= 2.0) return -1.0; // Severe penalty for 2x+ advantage
          if (allianceRatio >= 1.5) return -0.8; // Heavy penalty for 50%+ advantage
          if (allianceRatio >= 1.3) return -0.6; // Moderate penalty for 30%+ advantage
          if (allianceRatio <= 0.5) return 1.0; // Maximum bonus for 50%+ disadvantage
          if (allianceRatio <= 0.7) return 0.8; // High bonus for 30%+ disadvantage
          if (allianceRatio <= 0.9) return 0.4; // Moderate bonus for 10%+ disadvantage
          return 0; // Fair fight
        }
      }
    }
    
    // Fallback to individual guild calculation
    const avgPlayers =
      battleAnalysis.totalPlayers / battleAnalysis.guildStats.length;
    const playerRatio = guildStat.players / avgPlayers;

    // More aggressive penalties for player count advantages
    if (playerRatio >= 2.0) {
      return -1.0; // Severe penalty for having 2x+ more players
    }
    if (playerRatio >= 1.5) {
      return -0.8; // Heavy penalty for having 50%+ more players
    }
    if (playerRatio >= 1.3) {
      return -0.6; // Moderate penalty for having 30%+ more players
    }
    if (playerRatio <= 0.5) {
      return 1.0; // Maximum bonus for having 50% or fewer players
    }
    if (playerRatio <= 0.7) {
      return 0.8; // High bonus for having 30% or fewer players
    }
    if (playerRatio <= 0.9) {
      return 0.4; // Moderate bonus for having 10% or fewer players
    }
    return 0; // Fair fight (0.9 to 1.3 ratio)
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
    const factor = -Math.tanh(normalizedDifference);
    
    return Math.max(-1, Math.min(1, factor));
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
          },
        });
      }

      // Calculate new MMR
      const newMmr = Math.max(0, guildSeason.currentMmr + mmrChange);

      // Determine win/loss
      const isWin =
        this.calculateWinLossFactor(battleStats, battleAnalysis) > 0;

      // Update guild season
      await this.prisma.guildSeason.update({
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
        },
      });

      // Log detailed MMR calculation information
      await this.logMmrCalculation(
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
   * Log detailed MMR calculation information to database
   */
  private async logMmrCalculation(
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
    try {
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

      // Create MMR calculation log entry
      await this.prisma.mmrCalculationLog.upsert({
        where: {
          battleId_seasonId_guildId: {
            battleId: battleAnalysis.battleId,
            seasonId,
            guildId
          }
        },
        update: {
          // Update with latest values
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
        },
        create: {
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
          calculationVersion: "1.0"
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
    } catch (error) {
      logger.error("Error logging MMR calculation details", {
        guildId,
        battleId: battleAnalysis.battleId.toString(),
        error: error instanceof Error ? error.message : "Unknown error",
      });
      // Don't throw - logging failure shouldn't fail the MMR update
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

    // IMPROVED: Check both relative and absolute participation criteria
    const hasFameParticipation = fameRatio >= adjustedFameThreshold || 
                                guildFameParticipation >= MMR_CONSTANTS.MIN_ABSOLUTE_FAME_PARTICIPATION;
    const hasKillsDeathsParticipation = killsDeathsRatio >= adjustedKillsDeathsThreshold || 
                                       guildKillsDeaths >= MMR_CONSTANTS.MIN_ABSOLUTE_KILLS_DEATHS;
    const hasPlayerParticipation = playerRatio >= adjustedPlayerThreshold || 
                                  guildStat.players >= MMR_CONSTANTS.MIN_ABSOLUTE_PLAYERS;

    // IMPROVED: Much stricter criteria for single-player guilds
    // Single players must have very high participation to be included
    const isSinglePlayer = guildStat.players <= 1;
    const hasSignificantKillsDeaths = guildKillsDeaths >= 8; // At least 8 kills OR deaths for single players (increased from 3)
    const hasSignificantFame = guildFameParticipation >= 1000000; // At least 1M fame for single players (increased from 500K)
    
    // IMPROVED: Guild must meet at least 2 out of 3 criteria, or be from a major alliance
    // Additionally, must have at least some meaningful participation (kills OR deaths)
    const hasAnyKillsOrDeaths = guildStat.kills > 0 || guildStat.deaths > 0;
    
    // For single players, require higher thresholds
    if (isSinglePlayer) {
      const hasSignificantParticipationForSinglePlayer = 
        hasAnyKillsOrDeaths && 
        hasSignificantKillsDeaths && 
        hasSignificantFame;
      
      // Even for major alliances, single players must meet strict criteria
      return hasSignificantParticipationForSinglePlayer;
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
