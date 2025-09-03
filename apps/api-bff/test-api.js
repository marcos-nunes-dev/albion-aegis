// Simple test script for the BFF API
const BASE_URL = 'http://localhost:4000';

async function testEndpoint(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const data = await response.json();
    
    console.log(`✅ ${method} ${endpoint} - Status: ${response.status}`);
    console.log('Response:', JSON.stringify(data, null, 2));
    console.log('---');
    
    return { success: true, data, status: response.status };
  } catch (error) {
    console.error(`❌ ${method} ${endpoint} - Error:`, error.message);
    console.log('---');
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('🧪 Testing Albion Aegis BFF API...\n');

  // Test health endpoint
  await testEndpoint('/health');

  // Test tRPC health endpoints
  await testEndpoint('/trpc/health.check');
  await testEndpoint('/trpc/health.detailed');
  await testEndpoint('/trpc/health.ready');

  // Test battles endpoints - using GET for query procedures
  await testEndpoint('/trpc/battles.getBattles?input=' + encodeURIComponent(JSON.stringify({
    page: 0, 
    limit: 10, 
    minPlayers: 25
  })));

  await testEndpoint('/trpc/battles.getBattleStats');

  // Test MMR endpoints
  await testEndpoint('/trpc/mmr.getSeasons');
  await testEndpoint('/trpc/mmr.getMmrStats');

  console.log('🎉 API testing completed!');
}

// Run tests if this script is executed directly
if (typeof window === 'undefined') {
  runTests().catch(console.error);
}
