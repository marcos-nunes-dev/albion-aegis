import Redis from 'ioredis';
import { config } from '../lib/config.js';

// Create Redis connection with basic configuration
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  keepAlive: 30000,
  connectTimeout: 10000,
  commandTimeout: 5000,
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
