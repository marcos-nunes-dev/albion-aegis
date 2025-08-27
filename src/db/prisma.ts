import { PrismaClient } from '@prisma/client';
import { config } from '../lib/config.js';

// PrismaClient is attached to the `global` object to prevent
// exhausting your database connection limit in all environments.
//
// Learn more:
// https://pris.ly/d/help/next-js-best-practices

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Enhanced Prisma client configuration with connection pooling
const createPrismaClient = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // Connection pooling is handled via DATABASE_URL parameters
    // and Prisma's built-in connection management
  });
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Always cache the Prisma client globally to prevent connection pool exhaustion
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

// Enhanced connection management with health checks
export const databaseHealth = {
  isConnected: false,
  lastCheck: null as Date | null,
  connectionErrors: 0,
};

// Health check function
export const checkDatabaseHealth = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseHealth.isConnected = true;
    databaseHealth.lastCheck = new Date();
    databaseHealth.connectionErrors = 0;
    return true;
  } catch (error) {
    databaseHealth.isConnected = false;
    databaseHealth.lastCheck = new Date();
    databaseHealth.connectionErrors++;
    console.error('❌ Database health check failed:', error);
    return false;
  }
};

// Graceful shutdown function
export const gracefulShutdown = async () => {
  console.log('🛑 Disconnecting from database...');
  try {
    await prisma.$disconnect();
    console.log('✅ Database disconnected successfully');
  } catch (error) {
    console.error('❌ Error disconnecting from database:', error);
  }
};

// Initialize health check on startup
checkDatabaseHealth().then((isHealthy) => {
  if (isHealthy) {
    console.log('✅ Database connection pool initialized successfully');
    console.log(`📊 Pool configuration: min=${config.DATABASE_POOL_MIN}, max=${config.DATABASE_POOL_MAX}`);
  } else {
    console.error('❌ Database connection pool initialization failed');
  }
});

// Set up periodic health checks (every 5 minutes)
setInterval(checkDatabaseHealth, 5 * 60 * 1000);

// Graceful shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export default prisma;
