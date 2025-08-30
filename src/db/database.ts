import { PrismaClient } from '@prisma/client';
import { config } from '../lib/config.js';

// Enhanced database connection manager with connection pooling
export class DatabaseManager {
  private static instance: DatabaseManager;
  private prisma: PrismaClient;
  private isConnected = false;
  private connectionErrors = 0;
  private lastHealthCheck: Date | null = null;

  private constructor() {
    // Modify DATABASE_URL to work better with connection poolers
    const databaseUrl = this.getPoolerCompatibleUrl();
    
    this.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    // Set up connection event handlers
    this.setupEventHandlers();
  }

  private getPoolerCompatibleUrl(): string {
    const originalUrl = process.env.DATABASE_URL;
    if (!originalUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // Add connection pooling parameters to the URL
    const url = new URL(originalUrl);
    
    // Add parameters for better pooler compatibility
    url.searchParams.set('connection_limit', '10');
    url.searchParams.set('pool_timeout', '30');
    url.searchParams.set('connect_timeout', '30');
    
    // For Railway and other poolers, add these parameters
    if (url.hostname.includes('railway') || url.hostname.includes('pooler')) {
      url.searchParams.set('pgbouncer', 'true');
      url.searchParams.set('prepared_statements', 'false');
    }

    return url.toString();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public getPrisma(): PrismaClient {
    return this.prisma;
  }

  private setupEventHandlers() {
    // Type assertion to handle Prisma's strict event typing
    (this.prisma as any).$on('query', (e: any) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 Query: ${e.query}`);
        console.log(`⏱️  Duration: ${e.duration}ms`);
      }
    });

    (this.prisma as any).$on('error', (e: any) => {
      console.error('❌ Prisma error:', e);
      this.connectionErrors++;
      this.isConnected = false;
    });

    (this.prisma as any).$on('info', (e: any) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`ℹ️  Prisma info: ${e.message}`);
      }
    });

    (this.prisma as any).$on('warn', (e: any) => {
      console.warn(`⚠️  Prisma warning: ${e.message}`);
    });
  }

  public async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.isConnected = true;
      this.connectionErrors = 0;
      console.log('✅ Database connected successfully');
    } catch (error) {
      this.isConnected = false;
      this.connectionErrors++;
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      this.isConnected = false;
      console.log('✅ Database disconnected successfully');
    } catch (error) {
      console.error('❌ Error disconnecting from database:', error);
      throw error;
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      // Use a simple query that doesn't create prepared statements
      await this.prisma.$executeRaw`SELECT 1`;
      this.isConnected = true;
      this.lastHealthCheck = new Date();
      this.connectionErrors = 0;
      return true;
    } catch (error) {
      this.isConnected = false;
      this.lastHealthCheck = new Date();
      this.connectionErrors++;
      console.error('❌ Database health check failed:', error);
      return false;
    }
  }

  public async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    retryDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check connection health before operation
        if (!this.isConnected) {
          await this.healthCheck();
        }

        return await operation();
      } catch (error) {
        lastError = error as Error;
        
        // Check if it's a prepared statement error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('prepared statement') && errorMessage.includes('already exists')) {
          // For prepared statement conflicts, try to reconnect
          console.warn(`⚠️ Prepared statement conflict detected, attempt ${attempt}/${maxRetries}`);
          try {
            await this.prisma.$disconnect();
            await this.prisma.$connect();
            this.isConnected = true;
          } catch (reconnectError) {
            console.error('❌ Failed to reconnect after prepared statement error:', reconnectError);
          }
        }
        
        if (attempt === maxRetries) {
          console.error(`❌ Database operation failed after ${maxRetries} attempts:`, error);
          throw error;
        }

        console.warn(`⚠️ Database operation failed, attempt ${attempt}/${maxRetries}:`, error);
        
        // Mark connection as unhealthy
        this.isConnected = false;
        
        // Wait before retrying with exponential backoff
        const delay = retryDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  public getHealthStatus() {
    return {
      isConnected: this.isConnected,
      lastHealthCheck: this.lastHealthCheck,
      connectionErrors: this.connectionErrors,
      poolConfig: {
        min: config.DATABASE_POOL_MIN,
        max: config.DATABASE_POOL_MAX,
        connectionTimeout: config.DATABASE_CONNECTION_TIMEOUT,
        idleTimeout: config.DATABASE_IDLE_TIMEOUT,
      },
    };
  }
}

// Export singleton instance
export const databaseManager = DatabaseManager.getInstance();

// Export convenience functions
export const getPrisma = () => databaseManager.getPrisma();
export const executeWithRetry = <T>(operation: () => Promise<T>) => 
  databaseManager.executeWithRetry(operation);
export const healthCheck = () => databaseManager.healthCheck();
export const getHealthStatus = () => databaseManager.getHealthStatus();

// Initialize connection on module load
databaseManager.connect().catch((error) => {
  console.error('❌ Failed to initialize database connection:', error);
  process.exit(1);
});

// Set up periodic health checks
setInterval(() => {
  databaseManager.healthCheck().catch((error) => {
    console.error('❌ Periodic health check failed:', error);
  });
}, 5 * 60 * 1000); // Every 5 minutes

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down database manager...');
  await databaseManager.disconnect();
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down database manager...');
  await databaseManager.disconnect();
});
