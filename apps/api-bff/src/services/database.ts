import { PrismaClient } from '@prisma/client';

export class DatabaseService {
  private prisma: PrismaClient;
  private isConnected = false;

  constructor() {
    this.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }

  async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      this.isConnected = true;
      console.log('✅ Database connected successfully');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      this.isConnected = false;
      console.log('✅ Database disconnected successfully');
    } catch (error) {
      console.error('❌ Error disconnecting from database:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$executeRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.error('❌ Database health check failed:', error);
      return false;
    }
  }

  getPrisma(): PrismaClient {
    return this.prisma;
  }

  isConnectedToDatabase(): boolean {
    return this.isConnected;
  }
}

// Export singleton instance
export const databaseService = new DatabaseService();

// Initialize connection on module load
databaseService.connect().catch((error) => {
  console.error('❌ Failed to initialize database connection:', error);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down database service...');
  await databaseService.disconnect();
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down database service...');
  await databaseService.disconnect();
});
