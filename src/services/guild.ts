import { PrismaClient } from '@prisma/client';
import { searchGuilds } from '../http/client.js';
import { log } from '../log.js';
import type { Guild } from '../types/mmr.js';

const logger = log.child({ component: 'guild-service' });

export class GuildService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get or create a guild by name, fetching its ID from AlbionBB API if needed
   */
  async getOrCreateGuild(guildName: string): Promise<Guild> {
    try {
      console.log(`🏆 [GUILD-SERVICE] Getting or creating guild: ${guildName}`);
      
      // First, try to find the guild in our database
      const existingGuild = await this.prisma.guild.findUnique({
        where: { name: guildName }
      });

      if (existingGuild) {
        console.log(`✅ [GUILD-SERVICE] Found existing guild: ${guildName} (ID: ${existingGuild.id})`);
        logger.debug('Found existing guild', { guildName, guildId: existingGuild.id });
        return existingGuild;
      }

      // Guild doesn't exist, fetch from AlbionBB API
      console.log(`🏆 [GUILD-SERVICE] Guild ${guildName} not found, fetching from AlbionBB API`);
      logger.info('Guild not found in database, fetching from AlbionBB API', { guildName });
      const guildId = await this.fetchGuildId(guildName);

      if (!guildId) {
        console.log(`⚠️ [GUILD-SERVICE] Could not find guild ID from AlbionBB API for: ${guildName}`);
        logger.warn('Could not find guild ID from AlbionBB API', { guildName });
        // Create guild with a placeholder ID (we'll update it later if we find the real ID)
        try {
          const placeholderGuild = await this.prisma.guild.create({
            data: {
              id: `placeholder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              name: guildName
            }
          });
          console.log(`✅ [GUILD-SERVICE] Created guild with placeholder ID: ${guildName} (ID: ${placeholderGuild.id})`);
          logger.info('Created guild with placeholder ID', { guildName, guildId: placeholderGuild.id });
          return placeholderGuild;
        } catch (createError) {
          // Handle case where guild might have been created by another process
          if (createError instanceof Error && createError.message.includes('Unique constraint')) {
            logger.info('Guild already exists (race condition), fetching it', { guildName });
            const existingGuild = await this.prisma.guild.findUnique({
              where: { name: guildName }
            });
            if (existingGuild) {
              return existingGuild;
            }
            
            // If name doesn't exist but ID does, try to find by ID
            if (createError.message.includes('fields: (`id`)')) {
              logger.info('Guild ID already exists, trying to find by ID', { guildName, guildId });
              const existingGuildById = await this.prisma.guild.findUnique({
                where: { id: guildId! }
              });
              if (existingGuildById) {
                logger.warn('Found guild with same ID but different name', { 
                  requestedName: guildName, 
                  existingName: existingGuildById.name,
                  guildId 
                });
                return existingGuildById;
              }
            }
          }
          throw createError;
        }
      }

      // Create guild with the real ID
      try {
        console.log(`🏆 [GUILD-SERVICE] Creating new guild with AlbionBB ID: ${guildName} (ID: ${guildId})`);
        const newGuild = await this.prisma.guild.create({
          data: {
            id: guildId,
            name: guildName
          }
        });

        console.log(`✅ [GUILD-SERVICE] Created new guild with AlbionBB ID: ${guildName} (ID: ${newGuild.id})`);
        logger.info('Created new guild with AlbionBB ID', { guildName, guildId: newGuild.id });
        return newGuild;
      } catch (createError) {
        // Handle case where guild might have been created by another process
        if (createError instanceof Error && createError.message.includes('Unique constraint')) {
          logger.info('Guild already exists (race condition), fetching it', { guildName });
          const existingGuild = await this.prisma.guild.findUnique({
            where: { name: guildName }
          });
          if (existingGuild) {
            return existingGuild;
          }
          
          // If name doesn't exist but ID does, try to find by ID
          if (createError.message.includes('fields: (`id`)')) {
            logger.info('Guild ID already exists, trying to find by ID', { guildName, guildId });
            const existingGuildById = await this.prisma.guild.findUnique({
              where: { id: guildId }
            });
            if (existingGuildById) {
              logger.warn('Found guild with same ID but different name', { 
                requestedName: guildName, 
                existingName: existingGuildById.name,
                guildId 
              });
              return existingGuildById;
            }
          }
        }
        throw createError;
      }

    } catch (error) {
      logger.error('Error in getOrCreateGuild', { 
        guildName, 
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * Fetch guild ID from AlbionBB API
   */
  private async fetchGuildId(guildName: string): Promise<string | null> {
    try {
      logger.debug('Fetching guild ID from AlbionBB API', { guildName });
      
      const searchResults = await searchGuilds(guildName);
      
      if (searchResults.length === 0) {
        logger.warn('No guilds found in AlbionBB search', { guildName });
        return null;
      }

      // Find exact match (case-sensitive)
      const exactMatch = searchResults.find(guild => guild.Name === guildName);
      if (exactMatch) {
        logger.debug('Found exact guild match', { guildName, guildId: exactMatch.Id });
        return exactMatch.Id;
      }

      // If no exact match, log the available options and return the first one
      logger.warn('No exact guild name match, using first result', { 
        guildName, 
        availableGuilds: searchResults.map(g => g.Name),
        selectedGuild: searchResults[0].Name,
        selectedGuildId: searchResults[0].Id
      });
      
      return searchResults[0].Id;

    } catch (error) {
      logger.error('Error fetching guild ID from AlbionBB API', { 
        guildName, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null;
    }
  }

  /**
   * Get all guilds from database
   */
  async getAllGuilds(): Promise<Guild[]> {
    try {
      const guilds = await this.prisma.guild.findMany({
        orderBy: { name: 'asc' }
      });
      
      logger.debug('Retrieved all guilds', { count: guilds.length });
      return guilds;
    } catch (error) {
      logger.error('Error getting all guilds', { error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Get guild by name
   */
  async getGuildByName(guildName: string): Promise<Guild | null> {
    try {
      const guild = await this.prisma.guild.findUnique({
        where: { name: guildName }
      });
      
      logger.debug('Retrieved guild by name', { guildName, found: !!guild });
      return guild;
    } catch (error) {
      logger.error('Error getting guild by name', { guildName, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Get guild by ID
   */
  async getGuildById(guildId: string): Promise<Guild | null> {
    try {
      const guild = await this.prisma.guild.findUnique({
        where: { id: guildId }
      });
      
      logger.debug('Retrieved guild by ID', { guildId, found: !!guild });
      return guild;
    } catch (error) {
      logger.error('Error getting guild by ID', { guildId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Update guild ID if it was previously a placeholder
   */
  async updateGuildId(guildName: string, newGuildId: string): Promise<Guild> {
    try {
      const updatedGuild = await this.prisma.guild.update({
        where: { name: guildName },
        data: { id: newGuildId }
      });
      
      logger.info('Updated guild ID', { guildName, oldId: 'placeholder', newId: newGuildId });
      return updatedGuild;
    } catch (error) {
      logger.error('Error updating guild ID', { guildName, newGuildId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Extract unique guild names from battle data
   */
  extractGuildNamesFromBattle(battleData: any): string[] {
    const guildNames = new Set<string>();
    
    try {
      // Extract from battle guilds
      if (battleData.guilds && Array.isArray(battleData.guilds)) {
        battleData.guilds.forEach((guild: any) => {
          if (guild.name && typeof guild.name === 'string') {
            guildNames.add(guild.name);
          }
        });
      }

      // Extract from kill events
      if (battleData.killEvents && Array.isArray(battleData.killEvents)) {
        battleData.killEvents.forEach((killEvent: any) => {
          if (killEvent.Killer?.GuildName && typeof killEvent.Killer.GuildName === 'string') {
            guildNames.add(killEvent.Killer.GuildName);
          }
          if (killEvent.Victim?.GuildName && typeof killEvent.Victim.GuildName === 'string') {
            guildNames.add(killEvent.Victim.GuildName);
          }
        });
      }

      logger.debug('Extracted guild names from battle data', { 
        guildNames: Array.from(guildNames),
        count: guildNames.size 
      });
      
      return Array.from(guildNames);
    } catch (error) {
      logger.error('Error extracting guild names from battle data', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return [];
    }
  }

  /**
   * Process guilds from battle data - discover and store new guilds
   */
  async processGuildsFromBattle(battleData: any): Promise<Guild[]> {
    try {
      const guildNames = this.extractGuildNamesFromBattle(battleData);
      const processedGuilds: Guild[] = [];

      for (const guildName of guildNames) {
        try {
          const guild = await this.getOrCreateGuild(guildName);
          processedGuilds.push(guild);
        } catch (error) {
          logger.error('Error processing guild from battle', { 
            guildName, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
          // Continue processing other guilds
        }
      }

      logger.info('Processed guilds from battle', { 
        totalGuilds: guildNames.length, 
        processedGuilds: processedGuilds.length 
      });
      
      return processedGuilds;
    } catch (error) {
      logger.error('Error processing guilds from battle', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }
}
