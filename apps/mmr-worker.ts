import { startMmrWorkers, stopMmrWorkers } from '../src/queue/mmrQueue.js';
import { config } from '../src/lib/config.js';
import { getPrisma, getHealthStatus } from '../src/db/database.js';

console.log('🏆 Albion MMR Worker starting...');
console.log('📊 Configuration:', {
  NODE_ENV: config.NODE_ENV,
  API_BASE_URL: config.API_BASE_URL,
  REDIS_URL: config.REDIS_URL ? '***configured***' : '❌ missing',
  DATABASE_POOL_MIN: config.DATABASE_POOL_MIN,
  DATABASE_POOL_MAX: config.DATABASE_POOL_MAX,
});

// Log database health status
const healthStatus = getHealthStatus();
console.log('🗄️ Database Health Status:', {
  isConnected: healthStatus.isConnected,
  connectionErrors: healthStatus.connectionErrors,
  lastHealthCheck: healthStatus.lastHealthCheck,
  poolConfig: healthStatus.poolConfig,
});

// Test database connection
try {
  const prisma = getPrisma();
  await prisma.$connect();
  console.log('✅ Database connection successful');
} catch (error) {
  console.error('❌ Database connection failed:', error);
  process.exit(1);
}

// Start the MMR workers
try {
  await startMmrWorkers();
  console.log('✅ MMR workers started successfully');
  console.log('💡 Processing MMR calculation and batch jobs');
  console.log('💡 Workers will process jobs from mmr-calculation and mmr-batch queues');
  console.log(`💡 Database pool: ${config.DATABASE_POOL_MIN}-${config.DATABASE_POOL_MAX} connections`);
} catch (error) {
  console.error('❌ Failed to start MMR workers:', error);
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down MMR workers...');
  await stopMmrWorkers();
  const prisma = getPrisma();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down MMR workers...');
  await stopMmrWorkers();
  const prisma = getPrisma();
  await prisma.$disconnect();
  process.exit(0);
});
