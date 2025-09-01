import { request } from 'undici';
import Bottleneck from 'bottleneck';
import { config } from '../lib/config.js';
import { 
  BattleListResponse, 
  BattleDetail,
  KillEventsResponse,
  safeParseBattleList,
  safeParseBattleDetail,
  safeParseKillEvents
} from '../types/albion.js';
import { GuildSearchResponse, safeParseGuildSearchResponse } from '../types/mmr.js';
import { recordRateLimit, recordSuccess } from '../scheduler/crawlLoop.js';
import { httpLogger } from '../log.js';
import { metrics } from '../metrics.js';

// Rate limiting tracking
const RATE_LIMIT_WINDOW_SIZE = 300; // Increased from 200 to 300 requests for better averaging
const RATE_LIMIT_THRESHOLD = 0.03; // Reduced from 0.05 to 0.03 (3% threshold for slowdown)

interface RateLimitEntry {
  timestamp: number;
  isRateLimited: boolean;
}

class RateLimitTracker {
  private requests: RateLimitEntry[] = [];
  private rateLimitCount = 0;

  recordRequest(isRateLimited: boolean): void {
    const now = Date.now();
    
    // Add new request
    this.requests.push({ timestamp: now, isRateLimited });
    
    // Remove old requests outside the window
    const cutoff = now - (RATE_LIMIT_WINDOW_SIZE * 1000); // 200 seconds window
    this.requests = this.requests.filter(req => req.timestamp > cutoff);
    
    // Update rate limit count
    if (isRateLimited) {
      this.rateLimitCount++;
    } else {
      // Recalculate rate limit count from remaining requests
      this.rateLimitCount = this.requests.filter(req => req.isRateLimited).length;
    }
  }

  shouldSlowDown(): boolean {
    if (this.requests.length < 10) {
      // Need at least 10 requests to make a meaningful calculation
      return false;
    }
    
    const rateLimitRatio = this.rateLimitCount / this.requests.length;
    return rateLimitRatio > RATE_LIMIT_THRESHOLD;
  }

  getStats() {
    return {
      totalRequests: this.requests.length,
      rateLimitCount: this.rateLimitCount,
      rateLimitRatio: this.requests.length > 0 ? this.rateLimitCount / this.requests.length : 0,
      threshold: RATE_LIMIT_THRESHOLD,
      shouldSlowDown: this.shouldSlowDown(),
    };
  }
}

// Global rate limit tracker
export const rateLimitTracker = new RateLimitTracker();

// Rate limiter using Bottleneck
const limiter = new Bottleneck({
  reservoir: config.RATE_MAX_RPS, // Initial tokens
  reservoirRefreshAmount: config.RATE_MAX_RPS, // Tokens to add
  reservoirRefreshInterval: 1000, // Every 1 second
  maxConcurrent: 2, // Increased from 1 to 2 for better throughput
  minTime: Math.floor(1000 / config.RATE_MAX_RPS), // Minimum time between requests
  retryCount: 3, // Add retry count for failed requests
  retryDelay: 1000, // 1 second retry delay
});

// Exponential backoff configuration
const BACKOFF_CONFIG = {
  initialDelay: 500, // Reduced from 1000 to 500ms for faster recovery
  maxDelay: 15000, // Reduced from 30000 to 15000ms cap
  maxRetries: 3, // Reduced from 5 to 3 for faster failure detection
  backoffFactor: 2,
};

// Error types for better error handling
export class AlbionAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public retryAfter?: number,
    public isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'AlbionAPIError';
  }
}

export class RateLimitError extends AlbionAPIError {
  constructor(retryAfter?: number) {
    super('Rate limit exceeded', 429, retryAfter, true);
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends AlbionAPIError {
  constructor(message: string) {
    super(`Response validation failed: ${message}`, undefined, undefined, false);
    this.name = 'ValidationError';
  }
}

// Add jitter to prevent thundering herd
function addJitter(delay: number): number {
  return delay + Math.random() * delay * 0.1; // Add up to 10% jitter
}

// Calculate exponential backoff delay
function calculateBackoffDelay(attempt: number): number {
  const delay = BACKOFF_CONFIG.initialDelay * Math.pow(BACKOFF_CONFIG.backoffFactor, attempt - 1);
  return Math.min(addJitter(delay), BACKOFF_CONFIG.maxDelay);
}

// Sleep utility
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if error is retryable (removed - inline usage is clearer)
// function isRetryableError(statusCode: number): boolean {
//   return statusCode === 429 || (statusCode >= 500 && statusCode < 600);
// }

// Extract retry-after header
function getRetryAfter(headers: Record<string, string | string[]>): number | undefined {
  const retryAfter = headers['retry-after'];
  if (typeof retryAfter === 'string') {
    const seconds = parseInt(retryAfter, 10);
    return isNaN(seconds) ? undefined : seconds * 1000; // Convert to milliseconds
  }
  return undefined;
}

// Generic HTTP request with retry logic
async function makeRequest(url: string, attempt: number = 1): Promise<any> {
  try {
    httpLogger.debug('Making HTTP request', { url, attempt });
    
    const response = await request(url, {
      method: 'GET',
      headers: {
        'User-Agent': config.USER_AGENT,
        'Accept': 'application/json',
      },
      // Set reasonable timeouts
      headersTimeout: 10000, // 10 seconds
      bodyTimeout: 30000, // 30 seconds
    });

    const statusCode = response.statusCode;
    const headers = response.headers as Record<string, string | string[]>;

    // Handle successful responses
    if (statusCode >= 200 && statusCode < 300) {
      const body = await response.body.json();
      httpLogger.debug(`HTTP request successful (${statusCode}): ${url}`);
      metrics.recordRequest('api', statusCode);
      rateLimitTracker.recordRequest(false); // Not rate limited
      recordSuccess(); // Record successful request
      return body;
    }

    // Handle rate limiting
    if (statusCode === 429) {
      const retryAfter = getRetryAfter(headers);
      httpLogger.warn('Rate limited', { statusCode, url, retryAfter });
      metrics.recordError('api', statusCode);
      rateLimitTracker.recordRequest(true); // Rate limited
      recordRateLimit(); // Record rate limit for slowdown logic
      throw new RateLimitError(retryAfter);
    }

    // Handle server errors
    if (statusCode >= 500) {
      httpLogger.error('Server error', { statusCode, url });
      metrics.recordError('api', statusCode);
      throw new AlbionAPIError(`Server error: ${statusCode}`, statusCode, undefined, true);
    }

    // Handle client errors (non-retryable)
    httpLogger.error('Client error', { statusCode, url });
    metrics.recordError('api', statusCode);
    throw new AlbionAPIError(`Client error: ${statusCode}`, statusCode, undefined, false);

  } catch (error) {
    // Handle network errors
    if (!(error instanceof AlbionAPIError)) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      httpLogger.error('Network error', { error: errorMessage, url });
      metrics.recordError('api', 0); // Network errors don't have status codes
      throw new AlbionAPIError(`Network error: ${errorMessage}`, undefined, undefined, true);
    }
    throw error;
  }
}

// HTTP request with exponential backoff
async function requestWithBackoff(url: string): Promise<any> {
  let lastError: AlbionAPIError | undefined;

  for (let attempt = 1; attempt <= BACKOFF_CONFIG.maxRetries; attempt++) {
    try {
      return await makeRequest(url, attempt);
    } catch (error) {
      lastError = error as AlbionAPIError;

      // Don't retry non-retryable errors
      if (!lastError.isRetryable) {
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt === BACKOFF_CONFIG.maxRetries) {
        break;
      }

      // Calculate delay
      let delay: number;
      if (lastError instanceof RateLimitError && lastError.retryAfter) {
        // Use server-provided retry-after if available
        delay = lastError.retryAfter;
        httpLogger.debug('Waiting with server retry-after', { delay, attempt });
      } else {
        // Use exponential backoff
        delay = calculateBackoffDelay(attempt);
        httpLogger.debug('Waiting with exponential backoff', { delay, attempt });
      }

      await sleep(delay);
    }
  }

  throw lastError || new AlbionAPIError('All retry attempts failed');
}

// Rate-limited request wrapper
async function rateLimitedRequest(url: string): Promise<any> {
  return limiter.schedule(() => requestWithBackoff(url));
}

/**
 * Get battles page from Albion API
 * @param page - Page number (0-based)
 * @param minPlayers - Minimum number of players in battle
 * @returns Promise<BattleListResponse>
 */
export async function getBattlesPage(page: number, minPlayers: number): Promise<BattleListResponse> {
  const url = `${config.API_BASE_URL}/battles?offset=${page}&limit=51&sort=recent&minPlayers=${minPlayers}`;
  
  httpLogger.info(`Fetching battles page ${page + 1} (min players: ${minPlayers})`);
  
  try {
    const data = await rateLimitedRequest(url);
    
    // Validate response with Zod
    const battles = safeParseBattleList(data);
    if (!battles) {
      throw new ValidationError('Invalid battle list response format');
    }
    
    httpLogger.info(`Successfully fetched ${battles.length} battles from page ${page + 1}`);
    return battles;
    
  } catch (error) {
    if (error instanceof AlbionAPIError) {
      httpLogger.error('Failed to fetch battles page', { page, error: error.message });
      throw error;
    }
    
    // Wrap unexpected errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    httpLogger.error('Unexpected error fetching battles page', { page, error: errorMessage });
    throw new AlbionAPIError(`Unexpected error: ${errorMessage}`);
  }
}

/**
 * Get battle details including player statistics
 * @param albionId - Battle ID from Albion API
 * @returns Promise<BattleDetail>
 */
export async function getBattleDetail(albionId: bigint): Promise<BattleDetail> {
  const url = `${config.API_BASE_URL}/battles/${albionId.toString()}`;
  
  httpLogger.info(`Fetching battle details for battle ${albionId.toString()}`);
  
  try {
    const data = await rateLimitedRequest(url);
    
    // Validate response with Zod
    const battleDetail = safeParseBattleDetail(data);
    if (!battleDetail) {
      throw new ValidationError('Invalid battle detail response format');
    }
    
    httpLogger.info(`Successfully fetched battle details for battle ${albionId.toString()} (${battleDetail.players.length} players)`);
    return battleDetail;
    
  } catch (error) {
    if (error instanceof AlbionAPIError) {
      httpLogger.error('Failed to fetch battle details', { 
        albionId: albionId.toString(), 
        error: error.message 
      });
      throw error;
    }
    
    // Wrap unexpected errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    httpLogger.error('Unexpected error fetching battle details', { 
      albionId: albionId.toString(), 
      error: errorMessage 
    });
    throw new AlbionAPIError(`Unexpected error: ${errorMessage}`);
  }
}

/**
 * Get kill events for a specific battle
 * @param albionId - Battle ID from Albion API
 * @returns Promise<KillEventsResponse>
 */
export async function getKillsForBattle(albionId: bigint): Promise<KillEventsResponse> {
  const url = `${config.API_BASE_URL}/battles/kills?ids=${albionId.toString()}`;
  
  httpLogger.info(`Fetching kill events for battle ${albionId.toString()}`);
  
  try {
    const data = await rateLimitedRequest(url);
    
    // Validate response with Zod
    const killEvents = safeParseKillEvents(data);
    if (!killEvents) {
      throw new ValidationError('Invalid kill events response format');
    }
    
    httpLogger.info(`Successfully fetched ${killEvents.length} kill events for battle ${albionId.toString()}`);
    return killEvents;
    
  } catch (error) {
    if (error instanceof AlbionAPIError) {
      httpLogger.error('Failed to fetch kill events', { 
        albionId: albionId.toString(), 
        error: error.message 
      });
      throw error;
    }
    
    // Wrap unexpected errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    httpLogger.error('Unexpected error fetching kill events', { 
      albionId: albionId.toString(), 
      error: errorMessage 
    });
    throw new AlbionAPIError(`Unexpected error: ${errorMessage}`);
  }
}

/**
 * Search for guilds by name
 * @param name - The name of the guild to search for
 * @returns Promise<GuildSearchResponse>
 */
export async function searchGuilds(name: string): Promise<GuildSearchResponse> {
  const url = `${config.API_BASE_URL}/guilds/search?search=${encodeURIComponent(name)}`;
  
  httpLogger.info(`Searching for guilds with name: ${name}`);
  
  try {
    const data = await rateLimitedRequest(url);
    
    // Validate response with Zod
    const guildSearchResponse = safeParseGuildSearchResponse(data);
    if (!guildSearchResponse) {
      throw new ValidationError('Invalid guild search response format');
    }
    
    httpLogger.info(`Successfully found ${guildSearchResponse.length} guilds for search: ${name}`);
    return guildSearchResponse;
    
  } catch (error) {
    if (error instanceof AlbionAPIError) {
      httpLogger.error('Failed to search for guilds', { name, error: error.message });
      throw error;
    }
    
    // Wrap unexpected errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    httpLogger.error('Unexpected error searching for guilds', { name, error: errorMessage });
    throw new AlbionAPIError(`Unexpected error: ${errorMessage}`);
  }
}

/**
 * Legacy alias for getBattleDetail (for backward compatibility)
 * @deprecated Use getBattleDetail instead
 */
export const getBattleDetails = getBattleDetail;

/**
 * Get rate limiter statistics
 */
export function getRateLimiterStats() {
  return {
    running: limiter.running(),
    queued: limiter.queued(),
    // Note: reservoir properties may not be available in all Bottleneck versions
    // reservoir: limiter.reservoir(),
    // reservoirRefreshAmount: limiter.reservoirRefreshAmount,
    // reservoirRefreshInterval: limiter.reservoirRefreshInterval,
  };
}

/**
 * Wait for all pending requests to complete
 */
export async function waitForPendingRequests(): Promise<void> {
  await limiter.stop({ dropWaitingJobs: false });
}

// Export the limiter for advanced usage
export { limiter };

/**
 * Check if we should slow down based on recent rate limiting
 */
export function shouldSlowDown(): boolean {
  return rateLimitTracker.shouldSlowDown();
}

/**
 * Get rate limiting statistics
 */
export function getRateLimitStats() {
  return rateLimitTracker.getStats();
}
