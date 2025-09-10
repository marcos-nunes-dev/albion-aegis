import Redis from 'ioredis';
import { config } from '../lib/config.js';

// Create Redis connection with Railway-compatible configuration
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3, // Add retry limit to prevent infinite loops
  lazyConnect: true,
  keepAlive: 30000,
  connectTimeout: 60000, // Increased to 60s for better stability
  commandTimeout: 60000, // Increased to 60s for better stability
  // High volume optimizations
  enableReadyCheck: true,
  // Connection pooling for high volume
  family: 4, // Force IPv4
  // Add connection resilience
  enableOfflineQueue: false, // Disable offline queue to fail fast
});

// Connection event handlers
redis.on('connect', () => {
  console.log('🔗 Redis: Connected');
});

redis.on('ready', () => {
  console.log('✅ Redis: Ready');
});

redis.on('error', (error) => {
  console.error('❌ Redis: Connection error:', error.message);
  console.error('❌ Redis: Error details:', {
    code: (error as any).code,
    errno: (error as any).errno,
    syscall: (error as any).syscall,
    stack: error.stack
  });
});

redis.on('close', () => {
  console.log('🔌 Redis: Connection closed');
});

redis.on('reconnecting', (delay: number) => {
  console.log(`🔄 Redis: Reconnecting in ${delay}ms`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down Redis connection...');
  await redis.quit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down Redis connection...');
  await redis.quit();
  process.exit(0);
});

export default redis;
