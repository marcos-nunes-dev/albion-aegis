import redis from '../../../src/queue/connection.js';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds, default 300 (5 minutes)
  prefix?: string; // Cache key prefix
}

/**
 * Redis-based caching utility for API responses
 */
export class ApiCache {
  private defaultTTL: number;
  private defaultPrefix: string;

  constructor(defaultTTL: number = 300, defaultPrefix: string = 'api:cache') {
    this.defaultTTL = defaultTTL;
    this.defaultPrefix = defaultPrefix;
  }

  /**
   * Generate a cache key from the given parameters
   */
  private generateKey(prefix: string, ...parts: (string | number | object)[]): string {
    const keyParts = parts.map(part => {
      if (typeof part === 'object') {
        return JSON.stringify(part);
      }
      return String(part);
    });
    
    return `${this.defaultPrefix}:${prefix}:${keyParts.join(':')}`;
  }

  /**
   * Get cached data
   */
  async get<T>(prefix: string, ...keyParts: (string | number | object)[]): Promise<T | null> {
    try {
      const key = this.generateKey(prefix, ...keyParts);
      const cached = await redis.get(key);
      
      if (cached) {
        console.log(`🎯 Cache HIT: ${key}`);
        return this.deserializeFromCache<T>(cached);
      }
      
      console.log(`❌ Cache MISS: ${key}`);
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Custom JSON serializer that handles BigInt values
   */
  private serializeForCache(data: any): string {
    return JSON.stringify(data, (_key, value) => {
      // Convert BigInt to string for serialization
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    });
  }

  /**
   * Custom JSON deserializer that handles BigInt values
   */
  private deserializeFromCache<T>(jsonString: string): T {
    return JSON.parse(jsonString, (_key, value) => {
      // Note: We don't convert strings back to BigInt here since the frontend expects strings
      // If you need BigInt conversion, you'd need to know which fields should be BigInt
      return value;
    });
  }

  /**
   * Set cached data
   */
  async set<T>(
    data: T, 
    prefix: string, 
    options: CacheOptions = {},
    ...keyParts: (string | number | object)[]
  ): Promise<void> {
    try {
      const key = this.generateKey(prefix, ...keyParts);
      const ttl = options.ttl || this.defaultTTL;
      
      await redis.setex(key, ttl, this.serializeForCache(data));
      console.log(`💾 Cache SET: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Delete cached data
   */
  async delete(prefix: string, ...keyParts: (string | number | object)[]): Promise<void> {
    try {
      const key = this.generateKey(prefix, ...keyParts);
      await redis.del(key);
      console.log(`🗑️ Cache DELETE: ${key}`);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(`${this.defaultPrefix}:${pattern}`);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`🧹 Cache INVALIDATE: ${keys.length} keys matching ${pattern}`);
      }
    } catch (error) {
      console.error('Cache invalidate error:', error);
    }
  }

  /**
   * Get or set cached data with automatic fallback
   */
  async getOrSet<T>(
    keyPrefix: string,
    keyParts: (string | number | object)[],
    fetchFn: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(keyPrefix, ...keyParts);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    const freshData = await fetchFn();
    
    // Cache the fresh data
    await this.set(freshData, keyPrefix, options, ...keyParts);
    
    return freshData;
  }
}

// Create default cache instance
export const apiCache = new ApiCache();

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  STATISTICS: 300,    // 5 minutes - statistics change infrequently
  GUILDS_LIST: 180,   // 3 minutes - guild lists change moderately
  GUILDS_TOP: 120,    // 2 minutes - top guilds change more frequently
  SEASONS: 600,       // 10 minutes - seasons change very rarely
  GUILD_DETAIL: 240,  // 4 minutes - individual guild data
  MMR_FEED: 60,       // 1 minute - MMR feed changes frequently
} as const;
