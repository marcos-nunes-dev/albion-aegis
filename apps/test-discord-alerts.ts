import { discordService } from '../src/services/discord.js';
import { log } from '../src/log.js';

const logger = log.child({ component: 'test-discord-alerts' });

async function testDiscordAlerts() {
  try {
    logger.info('🧪 Testing Discord error alerts...');

    // Test 1: Rate limiting alert
    console.log('\n1️⃣ Testing rate limiting alert...');
    await discordService.trackRateLimit('1267170122', 30);
    console.log('✅ Rate limiting alert sent');

    // Test 2: Database error alert
    console.log('\n2️⃣ Testing database error alert...');
    const dbError = new Error('Connection timeout - prepared statement already exists');
    await discordService.trackDatabaseError(dbError, 'battle_upsert', '1267170122');
    console.log('✅ Database error alert sent');

    // Test 3: Network error alert
    console.log('\n3️⃣ Testing network error alert...');
    const networkError = new Error('ECONNRESET - Connection reset by peer');
    await discordService.trackNetworkError(networkError, '/battles/1267170122', '1267170122');
    console.log('✅ Network error alert sent');

    // Test 4: API error alert
    console.log('\n4️⃣ Testing API error alert...');
    const apiError = new Error('Albion API returned 500 Internal Server Error');
    await discordService.trackApiError(apiError, '/battles/1267170122', 500, '1267170122');
    console.log('✅ API error alert sent');

    // Test 5: Queue error alert
    console.log('\n5️⃣ Testing queue error alert...');
    const queueError = new Error('Job processing failed - Redis connection lost');
    await discordService.trackQueueError(queueError, 'kills-fetch', 'job-123', '1267170122');
    console.log('✅ Queue error alert sent');

    // Test 6: Missing battle alert
    console.log('\n6️⃣ Testing missing battle alert...');
    await discordService.trackMissingBattle('1267170122', 'Battle crawler failed to process this battle');
    console.log('✅ Missing battle alert sent');

    // Test 7: System load alert
    console.log('\n7️⃣ Testing system load alert...');
    await discordService.trackSystemLoad(75, 25);
    console.log('✅ System load alert sent');

    // Test 8: Get system load stats
    console.log('\n8️⃣ Getting system load stats...');
    const stats = discordService.getSystemLoadStats();
    console.log('📊 System load stats:', stats);

    console.log('\n🎉 All Discord alert tests completed successfully!');
    console.log('📱 Check your Discord channel for the test messages.');

  } catch (error) {
    logger.error('Failed to test Discord alerts', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    console.error('❌ Error during Discord alert testing:', error);
  }
}

// Run tests
testDiscordAlerts();
