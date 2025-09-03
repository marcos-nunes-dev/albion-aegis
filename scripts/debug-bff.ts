#!/usr/bin/env tsx

import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../src/bff/router.js';

async function debugBFF() {
  console.log('🔍 Debugging BFF BigInt issue...');

  // Create tRPC client
  const bff = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: 'http://localhost:3001/trpc',
      }),
    ],
  });

  try {
    // Test just getting a single battle to see if the issue is in the data structure
    console.log('🔍 Testing single battle retrieval...');
    const battles = await bff.battle.getBattles.query({ page: 1, limit: 1 });
    console.log('✅ Single battle retrieved successfully');
    console.log('Battle structure:', JSON.stringify(battles.battles[0], null, 2));
  } catch (error) {
    console.error('❌ Error details:', {
      message: error.message,
      code: error.data?.code,
      httpStatus: error.data?.httpStatus,
      stack: error.data?.stack,
    });
  }
}

// Run debug
debugBFF().catch(console.error);
