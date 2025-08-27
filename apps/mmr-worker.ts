import { startMmrWorkers, stopMmrWorkers } from '../src/queue/mmrQueue.js';
import { config } from '../src/lib/config.js';
import { prisma } from '../src/db/prisma.js';

console.log('🏆 Albion MMR Worker starting...');
console.log('📊 Configuration:', {
  NODE_ENV: config.NODE_ENV,
  API_BASE_URL: config.API_BASE_URL,
  REDIS_URL: config.REDIS_URL ? '***configured***' : '❌ missing',
});

// Test database connection
try {
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
} catch (error) {
  console.error('❌ Failed to start MMR workers:', error);
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down MMR workers...');
  await stopMmrWorkers();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down MMR workers...');
  await stopMmrWorkers();
  await prisma.$disconnect();
  process.exit(0);
});
