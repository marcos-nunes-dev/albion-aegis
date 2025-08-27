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
    this.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    // Set up connection event handlers
    this.setupEventHandlers();
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
    this.prisma.$on('query', (e) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 Query: ${e.query}`);
        console.log(`⏱️  Duration: ${e.duration}ms`);
      }
    });

    this.prisma.$on('error', (e) => {
      console.error('❌ Prisma error:', e);
      this.connectionErrors++;
      this.isConnected = false;
    });

    this.prisma.$on('info', (e) => {
      if (process.env.NODE_ENV === 'development') {
        console.log(`ℹ️  Prisma info: ${e.message}`);
      }
    });

    this.prisma.$on('warn', (e) => {
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
      await this.prisma.$queryRaw`SELECT 1`;
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
