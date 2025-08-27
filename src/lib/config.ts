import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Define the configuration schema with Zod
const configSchema = z.object({
  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // API Configuration
  API_BASE_URL: z.string().url(),
  USER_AGENT: z.string(),
  
  // Database and Redis
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  
  // Rate Limiting
  RATE_MAX_RPS: z.coerce.number().positive().default(4),
  
  // Crawling Configuration
  CRAWL_INTERVAL_SEC: z.coerce.number().positive().default(45),
  MAX_PAGES_PER_CRAWL: z.coerce.number().positive().default(8),
  SOFT_LOOKBACK_MIN: z.coerce.number().positive().default(180),
  
  // Deep Sweep Configuration
  DEEP_SWEEP_HOURLY_PAGES: z.coerce.number().positive().default(25),
  DEEP_SWEEP_HOURLY_LOOKBACK_H: z.coerce.number().positive().default(12),
  DEEP_SWEEP_HOURLY_SLEEP_MS: z.coerce.number().positive().default(60000),
  
  // Nightly Sweep Configuration
  NIGHTLY_SWEEP_PAGES: z.coerce.number().positive().default(50),
  NIGHTLY_SWEEP_LOOKBACK_H: z.coerce.number().positive().default(24),
  NIGHTLY_SWEEP_SLEEP_MS: z.coerce.number().positive().default(90000),
  
  // Worker Configuration
  KILLS_WORKER_CONCURRENCY: z.coerce.number().positive().default(3),
  DEBOUNCE_KILLS_MIN: z.coerce.number().positive().default(10),
  RECHECK_DONE_BATTLE_HOURS: z.coerce.number().positive().default(2),
  
  // Battle Notifier Configuration
  BATTLE_NOTIFIER_CONCURRENCY: z.coerce.number().positive().default(2),

  // Database Pool Configuration
  DATABASE_POOL_MIN: z.coerce.number().positive().default(1),
  DATABASE_POOL_MAX: z.coerce.number().positive().default(10),
  DATABASE_CONNECTION_TIMEOUT: z.coerce.number().positive().default(30000),
  DATABASE_IDLE_TIMEOUT: z.coerce.number().positive().default(60000),
  
  // Redis Cleanup Configuration
  REDIS_CLEANUP_INTERVAL_MIN: z.coerce.number().positive().default(30),
});

// Parse and validate the configuration
const parseConfig = () => {
  try {
    return configSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Configuration validation failed:');
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`);
      });
      process.exit(1);
    }
    throw error;
  }
};

// Export the validated configuration
export const config = parseConfig();

// Export the configuration type
export type Config = z.infer<typeof configSchema>;

// Helper function to get a safe config summary (no secrets)
export const getConfigSummary = () => ({
  NODE_ENV: config.NODE_ENV,
  API_BASE_URL: config.API_BASE_URL,
  USER_AGENT: config.USER_AGENT,
  RATE_MAX_RPS: config.RATE_MAX_RPS,
  CRAWL_INTERVAL_SEC: config.CRAWL_INTERVAL_SEC,
  MAX_PAGES_PER_CRAWL: config.MAX_PAGES_PER_CRAWL,
  SOFT_LOOKBACK_MIN: config.SOFT_LOOKBACK_MIN,
  DEEP_SWEEP_HOURLY_PAGES: config.DEEP_SWEEP_HOURLY_PAGES,
  DEEP_SWEEP_HOURLY_LOOKBACK_H: config.DEEP_SWEEP_HOURLY_LOOKBACK_H,
  DEEP_SWEEP_HOURLY_SLEEP_MS: config.DEEP_SWEEP_HOURLY_SLEEP_MS,
  NIGHTLY_SWEEP_PAGES: config.NIGHTLY_SWEEP_PAGES,
  NIGHTLY_SWEEP_LOOKBACK_H: config.NIGHTLY_SWEEP_LOOKBACK_H,
  NIGHTLY_SWEEP_SLEEP_MS: config.NIGHTLY_SWEEP_SLEEP_MS,
  KILLS_WORKER_CONCURRENCY: config.KILLS_WORKER_CONCURRENCY,
  DEBOUNCE_KILLS_MIN: config.DEBOUNCE_KILLS_MIN,
  RECHECK_DONE_BATTLE_HOURS: config.RECHECK_DONE_BATTLE_HOURS,
  BATTLE_NOTIFIER_CONCURRENCY: config.BATTLE_NOTIFIER_CONCURRENCY,
  DATABASE_POOL_MIN: config.DATABASE_POOL_MIN,
  DATABASE_POOL_MAX: config.DATABASE_POOL_MAX,
  DATABASE_CONNECTION_TIMEOUT: config.DATABASE_CONNECTION_TIMEOUT,
  DATABASE_IDLE_TIMEOUT: config.DATABASE_IDLE_TIMEOUT,
  DATABASE_URL: config.DATABASE_URL ? '[SET]' : '[NOT SET]',
  REDIS_URL: config.REDIS_URL ? '[SET]' : '[NOT SET]',
});
