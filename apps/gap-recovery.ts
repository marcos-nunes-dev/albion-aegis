#!/usr/bin/env tsx

import { getPrisma } from '../src/db/database.js';
import { BattleGapRecoveryService } from '../src/services/battleGapRecovery.js';
import { log } from '../src/log.js';

const logger = log.child({ component: 'gap-recovery-app' });

async function main() {
  logger.info('Starting battle gap recovery app');
  
  const prisma = getPrisma();
  const gapRecoveryService = new BattleGapRecoveryService(prisma);
  
  try {
    await gapRecoveryService.runGapRecovery();
    logger.info('Gap recovery completed successfully');
  } catch (error) {
    logger.error('Gap recovery failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

// Run the main function
main().catch((error) => {
  logger.error('Unhandled error in gap recovery app', {
    error: error instanceof Error ? error.message : 'Unknown error'
  });
  process.exit(1);
});
