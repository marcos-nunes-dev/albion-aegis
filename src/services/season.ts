import { PrismaClient } from '@prisma/client';
import { log } from '../log.js';
import type { Season, PrimeTimeWindow } from '../types/mmr.js';
import { MmrService } from './mmr.js';

const logger = log.child({ component: 'season-service' });

export class SeasonService {
  private prisma: PrismaClient;
  private mmrService: MmrService;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.mmrService = new MmrService(prisma);
  }

  /**
   * Create a new season
   */
  async createSeason(name: string, startDate: Date, endDate?: Date): Promise<Season> {
    try {
      // Check if a season with this name already exists
      const existingSeason = await this.prisma.season.findUnique({
        where: { name }
      });

      if (existingSeason) {
        throw new Error(`Season with name "${name}" already exists`);
      }

      // If creating a new active season, deactivate all other seasons
      if (!endDate) {
        await this.prisma.season.updateMany({
          where: { isActive: true },
          data: { isActive: false }
        });
      }

      const season = await this.prisma.season.create({
        data: {
          name,
          startDate,
          ...(endDate && { endDate }),
          isActive: !endDate // Active if no end date
        }
      });

      logger.info('Created new season', { 
        seasonId: season.id, 
        name: season.name, 
        startDate: season.startDate,
        endDate: season.endDate,
        isActive: season.isActive 
      });

      return season;
    } catch (error) {
      logger.error('Error creating season', { 
        name, 
        startDate, 
        endDate, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Get active season
   */
  async getActiveSeason(): Promise<Season | null> {
    try {
      return await this.prisma.season.findFirst({
        where: { isActive: true }
      });
    } catch (error) {
      logger.error('Error getting active season', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get season by ID
   */
  async getSeasonById(seasonId: string): Promise<Season | null> {
    try {
      return await this.prisma.season.findUnique({
        where: { id: seasonId }
      });
    } catch (error) {
      logger.error('Error getting season by ID', {
        seasonId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get season by name
   */
  async getSeasonByName(name: string): Promise<Season | null> {
    try {
      return await this.prisma.season.findUnique({
        where: { name }
      });
    } catch (error) {
      logger.error('Error getting season by name', {
        name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get all seasons
   */
  async getAllSeasons(): Promise<Season[]> {
    try {
      return await this.prisma.season.findMany({
        orderBy: { startDate: 'desc' }
      });
    } catch (error) {
      logger.error('Error getting all seasons', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * End a season (set end date and deactivate)
   */
  async endSeason(seasonId: string, endDate: Date): Promise<Season> {
    try {
      const updatedSeason = await this.prisma.season.update({
        where: { id: seasonId },
        data: {
          endDate,
          isActive: false
        }
      });

      // Process MMR carryover for the ending season
      try {
        await this.mmrService.processSeasonEnd(seasonId);
        logger.info('Successfully processed MMR carryover for ending season', { seasonId });
      } catch (mmrError) {
        logger.error('Failed to process MMR carryover for ending season', { 
          seasonId, 
          error: mmrError instanceof Error ? mmrError.message : 'Unknown error' 
        });
        // Don't throw - season ending should succeed even if MMR carryover fails
      }

      logger.info('Ended season', { 
        seasonId, 
        seasonName: updatedSeason.name, 
        endDate: updatedSeason.endDate 
      });

      return updatedSeason;
    } catch (error) {
      logger.error('Error ending season', { seasonId, endDate, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Activate a season (deactivate others and activate this one)
   */
  async activateSeason(seasonId: string): Promise<Season> {
    try {
      // Deactivate all other seasons
      await this.prisma.season.updateMany({
        where: { isActive: true },
        data: { isActive: false }
      });

      // Activate the specified season
      const activatedSeason = await this.prisma.season.update({
        where: { id: seasonId },
        data: { isActive: true }
      });

      logger.info('Activated season', { 
        seasonId, 
        seasonName: activatedSeason.name 
      });

      return activatedSeason;
    } catch (error) {
      logger.error('Error activating season', { seasonId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Add a global prime time window
   */
  async addPrimeTimeWindow(startHour: number, endHour: number, timezone: string = "UTC"): Promise<PrimeTimeWindow> {
    try {
      // Validate hours
      if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
        throw new Error('Hours must be between 0 and 23');
      }

      const primeTimeWindow = await this.prisma.primeTimeWindow.create({
        data: {
          startHour,
          endHour,
          timezone
        }
      });

      logger.info('Added global prime time window', {
        id: primeTimeWindow.id,
        startHour: primeTimeWindow.startHour,
        endHour: primeTimeWindow.endHour,
        timezone: primeTimeWindow.timezone
      });

      return primeTimeWindow;
    } catch (error) {
      logger.error('Error adding global prime time window', {
        startHour,
        endHour,
        timezone,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Remove a global prime time window
   */
  async removePrimeTimeWindow(windowId: string): Promise<void> {
    try {
      await this.prisma.primeTimeWindow.delete({
        where: { id: windowId }
      });

      logger.info('Removed global prime time window', { windowId });
    } catch (error) {
      logger.error('Error removing global prime time window', {
        windowId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get all global prime time windows
   */
  async getPrimeTimeWindows(): Promise<PrimeTimeWindow[]> {
    try {
      return await this.prisma.primeTimeWindow.findMany({
        orderBy: { startHour: 'asc' }
      });
    } catch (error) {
      logger.error('Error getting global prime time windows', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * Check if a given time is within prime time for a season
   */
  async isPrimeTime(seasonId: string, date: Date): Promise<boolean> {
    try {
      const primeTimeWindows = await this.getPrimeTimeWindows();
      
      if (primeTimeWindows.length === 0) {
        return false; // No prime time windows defined
      }

      const hour = date.getUTCHours(); // Use UTC hours

      return primeTimeWindows.some(window => {
        if (window.startHour <= window.endHour) {
          // Same day window (e.g., 20:00 to 22:00)
          return hour >= window.startHour && hour < window.endHour;
        } else {
          // Overnight window (e.g., 22:00 to 02:00)
          return hour >= window.startHour || hour < window.endHour;
        }
      });
    } catch (error) {
      logger.error('Error checking if time is prime time', { 
        seasonId, 
        date, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false; // Default to false on error
    }
  }

  /**
   * Get the season that was active at a specific date
   */
  async getSeasonAtDate(date: Date): Promise<Season | null> {
    try {
      const season = await this.prisma.season.findFirst({
        where: {
          startDate: { lte: date },
          OR: [
            { endDate: null },
            { endDate: { gte: date } }
          ]
        },
        orderBy: { startDate: 'desc' }
      });

      logger.debug('Retrieved season at date', { date, found: !!season, seasonId: season?.id });
      return season;
    } catch (error) {
      logger.error('Error getting season at date', { date, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Get the previous season for MMR carryover calculations
   */
  async getPreviousSeason(currentSeasonId: string): Promise<Season | null> {
    try {
      const currentSeason = await this.getSeasonById(currentSeasonId);
      if (!currentSeason) {
        return null;
      }

      const previousSeason = await this.prisma.season.findFirst({
        where: {
          startDate: { lt: currentSeason.startDate }
        },
        orderBy: { startDate: 'desc' }
      });

      logger.debug('Retrieved previous season', { 
        currentSeasonId, 
        previousSeasonId: previousSeason?.id,
        previousSeasonName: previousSeason?.name 
      });

      return previousSeason;
    } catch (error) {
      logger.error('Error getting previous season', { currentSeasonId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Initialize a new season with MMR carryover from the previous season
   */
  async initializeNewSeasonWithCarryover(newSeasonId: string, previousSeasonId: string): Promise<void> {
    try {
      logger.info('Initializing new season with MMR carryover', { 
        newSeasonId, 
        previousSeasonId 
      });

      // Verify both seasons exist
      const newSeason = await this.getSeasonById(newSeasonId);
      const previousSeason = await this.getSeasonById(previousSeasonId);

      if (!newSeason) {
        throw new Error(`New season with ID "${newSeasonId}" not found`);
      }

      if (!previousSeason) {
        throw new Error(`Previous season with ID "${previousSeasonId}" not found`);
      }

      // Initialize MMR carryover
      await this.mmrService.initializeNewSeason(newSeasonId, previousSeasonId);

      logger.info('Successfully initialized new season with MMR carryover', { 
        newSeasonId, 
        previousSeasonId 
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
}
