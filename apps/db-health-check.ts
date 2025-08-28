import { getHealthStatus, healthCheck } from '../src/db/database.js';
import { config } from '../src/lib/config.js';

console.log('🏥 Database Health Check Tool');

// Perform health check
console.log('\n🔍 Performing health check...');
try {
  const isHealthy = await healthCheck();
  
  if (isHealthy) {
    console.log('✅ Database is healthy and connected');
  } else {
    console.log('❌ Database health check failed');
  }
} catch (error) {
  console.error('❌ Health check error:', error);
}

// Display detailed status
const status = getHealthStatus();
console.log(`   Connected: ${status.isConnected ? '✅ Yes' : '❌ No'}`);
console.log(`   Connection Errors: ${status.connectionErrors}`);

// Connection pool recommendations
if (config.DATABASE_POOL_MAX < config.KILLS_WORKER_CONCURRENCY * 2) {
  console.log('   ⚠️  Warning: Pool max is smaller than recommended for your worker concurrency');
}

if (config.DATABASE_POOL_MIN < 2) {
  console.log('   ⚠️  Warning: Pool min is very low, consider increasing to 2+');
}

console.log('✅ Health check completed');
