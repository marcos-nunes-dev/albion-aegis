import { getHealthStatus, healthCheck } from '../src/db/database.js';
import { config } from '../src/lib/config.js';

console.log('🏥 Database Health Check Tool');
console.log('============================');

// Display configuration
console.log('\n📊 Configuration:');
console.log(`   Pool Min: ${config.DATABASE_POOL_MIN}`);
console.log(`   Pool Max: ${config.DATABASE_POOL_MAX}`);
console.log(`   Connection Timeout: ${config.DATABASE_CONNECTION_TIMEOUT}ms`);
console.log(`   Idle Timeout: ${config.DATABASE_IDLE_TIMEOUT}ms`);

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
console.log('\n📈 Detailed Status:');
const status = getHealthStatus();
console.log(`   Connected: ${status.isConnected ? '✅ Yes' : '❌ No'}`);
console.log(`   Connection Errors: ${status.connectionErrors}`);
console.log(`   Last Health Check: ${status.lastHealthCheck?.toISOString() || 'Never'}`);
console.log(`   Pool Configuration:`, status.poolConfig);

// Connection pool recommendations
console.log('\n💡 Connection Pool Recommendations:');
console.log(`   Current Pool Size: ${config.DATABASE_POOL_MIN}-${config.DATABASE_POOL_MAX}`);
console.log(`   Recommended for Kills Worker (concurrency ${config.KILLS_WORKER_CONCURRENCY}):`);
console.log(`     - Pool Min: ${Math.max(2, config.KILLS_WORKER_CONCURRENCY)}`);
console.log(`     - Pool Max: ${Math.max(5, config.KILLS_WORKER_CONCURRENCY * 2)}`);

if (config.DATABASE_POOL_MAX < config.KILLS_WORKER_CONCURRENCY * 2) {
  console.log('   ⚠️  Warning: Pool max is smaller than recommended for your worker concurrency');
}

if (config.DATABASE_POOL_MIN < 2) {
  console.log('   ⚠️  Warning: Pool min is very low, consider increasing to 2+');
}

// Environment variable suggestions
console.log('\n🔧 Environment Variable Suggestions:');
console.log('   For better connection pooling, consider setting:');
console.log(`   DATABASE_POOL_MIN=${Math.max(2, config.KILLS_WORKER_CONCURRENCY)}`);
console.log(`   DATABASE_POOL_MAX=${Math.max(5, config.KILLS_WORKER_CONCURRENCY * 2)}`);
console.log('   DATABASE_CONNECTION_TIMEOUT=30000');
console.log('   DATABASE_IDLE_TIMEOUT=60000');

console.log('\n✅ Health check completed');
