import { log } from '../log.js';

const logger = log.child({ component: 'discord-service' });

// Discord webhook configuration
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1411115771484045526/zf-p2vjNu99UOc-kvHs9YrfH0TBnlatAarKFC6eAn2lphQhVF3I6ufZNCF-Epe3wpV9b';

// Error severity levels
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// Error categories
export enum ErrorCategory {
  RATE_LIMITING = 'rate_limiting',
  NETWORK = 'network',
  DATABASE = 'database',
  SYSTEM_LOAD = 'system_load',
  API_ERROR = 'api_error',
  QUEUE_ERROR = 'queue_error',
  MISSING_DATA = 'missing_data'
}

// Error tracking interface
export interface ErrorAlert {
  category: ErrorCategory;
  severity: ErrorSeverity;
  title: string;
  description: string;
  details?: Record<string, any>;
  timestamp: Date;
  battleId?: string | undefined;
  retryCount?: number;
  error?: Error;
}

// Rate limiting tracking
let rateLimitCount = 0;
let lastRateLimitTime: Date | null = null;
const RATE_LIMIT_THRESHOLD = 5; // Alert after 5 rate limits in 10 minutes
const RATE_LIMIT_WINDOW = 10 * 60 * 1000; // 10 minutes

// Database error tracking
let databaseErrorCount = 0;
let lastDatabaseErrorTime: Date | null = null;
const DATABASE_ERROR_THRESHOLD = 3; // Alert after 3 DB errors in 5 minutes
const DATABASE_ERROR_WINDOW = 5 * 60 * 1000; // 5 minutes

// System load tracking
let concurrentBattlesCount = 0;
let lastLoadAlertTime: Date | null = null;
const LOAD_ALERT_THRESHOLD = 50; // Alert when processing 50+ concurrent battles
const LOAD_ALERT_COOLDOWN = 30 * 60 * 1000; // 30 minutes between alerts

export class DiscordService {
  private static instance: DiscordService;

  private constructor() {}

  static getInstance(): DiscordService {
    if (!DiscordService.instance) {
      DiscordService.instance = new DiscordService();
    }
    return DiscordService.instance;
  }

  /**
   * Send error alert to Discord
   */
  async sendErrorAlert(alert: ErrorAlert): Promise<void> {
    try {
      const embed = this.createErrorEmbed(alert);
      await this.sendDiscordMessage({ embeds: [embed] });
      
      logger.info('Error alert sent to Discord', {
        category: alert.category,
        severity: alert.severity,
        title: alert.title
      });
    } catch (error) {
      logger.error('Failed to send Discord error alert', {
        error: error instanceof Error ? error.message : 'Unknown error',
        alert
      });
    }
  }

  /**
   * Track rate limiting and send alerts if threshold exceeded
   */
  async trackRateLimit(battleId?: string, retryAfter?: number): Promise<void> {
    const now = new Date();
    rateLimitCount++;
    
    // Reset counter if outside window
    if (lastRateLimitTime && (now.getTime() - lastRateLimitTime.getTime()) > RATE_LIMIT_WINDOW) {
      rateLimitCount = 1;
    }
    
    lastRateLimitTime = now;

    // Send alert if threshold exceeded
    if (rateLimitCount >= RATE_LIMIT_THRESHOLD) {
      await this.sendErrorAlert({
        category: ErrorCategory.RATE_LIMITING,
        severity: ErrorSeverity.HIGH,
        title: '🚨 Rate Limiting Alert',
        description: `Albion API rate limiting detected. ${rateLimitCount} rate limits in the last 10 minutes.`,
        details: {
          rateLimitCount,
          retryAfter,
          timeWindow: '10 minutes'
        },
        timestamp: now,
        ...(battleId && { battleId })
      });
      
      // Reset counter after alert
      rateLimitCount = 0;
    }
  }

  /**
   * Track database errors and send alerts if threshold exceeded
   */
  async trackDatabaseError(error: Error, operation: string, battleId?: string): Promise<void> {
    const now = new Date();
    databaseErrorCount++;
    
    // Reset counter if outside window
    if (lastDatabaseErrorTime && (now.getTime() - lastDatabaseErrorTime.getTime()) > DATABASE_ERROR_WINDOW) {
      databaseErrorCount = 1;
    }
    
    lastDatabaseErrorTime = now;

    // Send alert if threshold exceeded
    if (databaseErrorCount >= DATABASE_ERROR_THRESHOLD) {
      await this.sendErrorAlert({
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.CRITICAL,
        title: '💾 Database Error Alert',
        description: `Database errors detected. ${databaseErrorCount} errors in the last 5 minutes.`,
        details: {
          databaseErrorCount,
          operation,
          errorMessage: error.message,
          errorStack: error.stack?.split('\n').slice(0, 3).join('\n')
        },
        timestamp: now,
        ...(battleId && { battleId }),
        error
      });
      
      // Reset counter after alert
      databaseErrorCount = 0;
    }
  }

  /**
   * Track system load and send alerts if too high
   */
  async trackSystemLoad(currentBattles: number, queueDepth: number): Promise<void> {
    const now = new Date();
    concurrentBattlesCount = currentBattles;
    
    // Check if we should send a load alert
    if (currentBattles >= LOAD_ALERT_THRESHOLD) {
      // Check cooldown
      if (!lastLoadAlertTime || (now.getTime() - lastLoadAlertTime.getTime()) > LOAD_ALERT_COOLDOWN) {
        await this.sendErrorAlert({
          category: ErrorCategory.SYSTEM_LOAD,
          severity: ErrorSeverity.MEDIUM,
          title: '⚡ High System Load Alert',
          description: `High system load detected. Processing ${currentBattles} concurrent battles.`,
          details: {
            concurrentBattles: currentBattles,
            queueDepth,
            threshold: LOAD_ALERT_THRESHOLD
          },
          timestamp: now
        });
        
        lastLoadAlertTime = now;
      }
    }
  }

  /**
   * Track missing battle data
   */
  async trackMissingBattle(battleId: string, reason: string): Promise<void> {
    await this.sendErrorAlert({
      category: ErrorCategory.MISSING_DATA,
      severity: ErrorSeverity.HIGH,
      title: '❌ Missing Battle Data Alert',
      description: `Battle ${battleId} is missing from database but exists in Albion API.`,
      details: {
        reason,
        battleId,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date(),
      battleId
    });
  }

  /**
   * Track network connectivity issues
   */
  async trackNetworkError(error: Error, endpoint: string, battleId?: string): Promise<void> {
    await this.sendErrorAlert({
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.MEDIUM,
      title: '🌐 Network Error Alert',
      description: `Network connectivity issue detected when accessing ${endpoint}.`,
      details: {
        endpoint,
        errorMessage: error.message,
        errorType: error.constructor.name
      },
      timestamp: new Date(),
      ...(battleId && { battleId }),
      error
    });
  }

  /**
   * Track queue processing issues
   */
  async trackQueueError(error: Error, queueName: string, jobId: string, battleId?: string): Promise<void> {
    await this.sendErrorAlert({
      category: ErrorCategory.QUEUE_ERROR,
      severity: ErrorSeverity.HIGH,
      title: '🔄 Queue Processing Error Alert',
      description: `Error processing job in ${queueName} queue.`,
      details: {
        queueName,
        jobId,
        errorMessage: error.message,
        errorStack: error.stack?.split('\n').slice(0, 3).join('\n')
      },
      timestamp: new Date(),
      ...(battleId && { battleId }),
      error
    });
  }

  /**
   * Track API errors from Albion
   */
  async trackApiError(error: Error, endpoint: string, statusCode?: number, battleId?: string): Promise<void> {
    const severity = statusCode && statusCode >= 500 ? ErrorSeverity.MEDIUM : ErrorSeverity.LOW;
    
    await this.sendErrorAlert({
      category: ErrorCategory.API_ERROR,
      severity,
      title: '🌐 Albion API Error Alert',
      description: `Error accessing Albion API endpoint: ${endpoint}`,
      details: {
        endpoint,
        statusCode,
        errorMessage: error.message,
        errorType: error.constructor.name
      },
      timestamp: new Date(),
      ...(battleId && { battleId }),
      error
    });
  }

  /**
   * Create Discord embed for error alerts
   */
  private createErrorEmbed(alert: ErrorAlert): any {
    const color = this.getSeverityColor(alert.severity);
    const categoryIcon = this.getCategoryIcon(alert.category);
    
    const embed = {
      title: `${categoryIcon} ${alert.title}`,
      description: alert.description,
      color: color,
      timestamp: alert.timestamp.toISOString(),
      fields: [] as any[],
      footer: {
        text: `Albion Aegis - ${alert.category.toUpperCase()}`
      }
    };

    // Add battle ID if available
    if (alert.battleId) {
      embed.fields.push({
        name: 'Battle ID',
        value: alert.battleId,
        inline: true
      });
    }

    // Add retry count if available
    if (alert.retryCount !== undefined) {
      embed.fields.push({
        name: 'Retry Count',
        value: alert.retryCount.toString(),
        inline: true
      });
    }

    // Add details
    if (alert.details) {
      Object.entries(alert.details).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          embed.fields.push({
            name: key.charAt(0).toUpperCase() + key.slice(1),
            value: typeof value === 'string' && value.length > 1024 
              ? value.substring(0, 1021) + '...' 
              : String(value),
            inline: key === 'battleId' || key === 'retryCount'
          });
        }
      });
    }

    // Add error details if available
    if (alert.error) {
      embed.fields.push({
        name: 'Error Details',
        value: `\`\`\`${alert.error.message}\`\`\``,
        inline: false
      });
    }

    return embed;
  }

  /**
   * Get color for severity level
   */
  private getSeverityColor(severity: ErrorSeverity): number {
    switch (severity) {
      case ErrorSeverity.LOW: return 0x00ff00; // Green
      case ErrorSeverity.MEDIUM: return 0xffff00; // Yellow
      case ErrorSeverity.HIGH: return 0xff8800; // Orange
      case ErrorSeverity.CRITICAL: return 0xff0000; // Red
      default: return 0x808080; // Gray
    }
  }

  /**
   * Get icon for error category
   */
  private getCategoryIcon(category: ErrorCategory): string {
    switch (category) {
      case ErrorCategory.RATE_LIMITING: return '⏰';
      case ErrorCategory.NETWORK: return '🌐';
      case ErrorCategory.DATABASE: return '💾';
      case ErrorCategory.SYSTEM_LOAD: return '⚡';
      case ErrorCategory.API_ERROR: return '🌐';
      case ErrorCategory.QUEUE_ERROR: return '🔄';
      case ErrorCategory.MISSING_DATA: return '❌';
      default: return '⚠️';
    }
  }

  /**
   * Send message to Discord webhook
   */
  private async sendDiscordMessage(payload: any): Promise<void> {
    try {
      const response = await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      logger.error('Failed to send Discord message', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get current system load statistics
   */
  getSystemLoadStats(): {
    rateLimitCount: number;
    databaseErrorCount: number;
    concurrentBattlesCount: number;
  } {
    return {
      rateLimitCount,
      databaseErrorCount,
      concurrentBattlesCount
    };
  }

  /**
   * Reset error counters (useful for testing or manual reset)
   */
  resetErrorCounters(): void {
    rateLimitCount = 0;
    databaseErrorCount = 0;
    lastRateLimitTime = null;
    lastDatabaseErrorTime = null;
    lastLoadAlertTime = null;
  }
}

// Export singleton instance
export const discordService = DiscordService.getInstance();

