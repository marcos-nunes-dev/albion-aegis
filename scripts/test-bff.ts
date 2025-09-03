#!/usr/bin/env tsx

import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../src/bff/router.js';

async function testBFF() {
  console.log('🧪 Testing BFF service...');

  // Create tRPC client
  const bff = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: 'http://localhost:3001/trpc',
      }),
    ],
  });

  try {
    // Test battle stats
    console.log('📊 Testing battle stats...');
    const battleStats = await bff.battle.getBattleStats.query({});
    console.log('✅ Battle stats:', battleStats);

    // Test kills stats
    console.log('⚔️ Testing kill stats...');
    const killStats = await bff.kill.getKillStats.query({});
    console.log('✅ Kill stats:', killStats);

    // Test battles with pagination
    console.log('🏰 Testing battles pagination...');
    const battles = await bff.battle.getBattles.query({ page: 1, limit: 5 });
    console.log('✅ Battles:', {
      count: battles.battles.length,
      total: battles.pagination.total,
      totalPages: battles.pagination.totalPages,
    });

    console.log('🎉 All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run tests
testBFF().catch(console.error);
