import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';

const logger = log.child({ component: 'cleanup-duplicate-battles' });
const prisma = new PrismaClient();

async function cleanupDuplicateBattleResults(): Promise<void> {
  try {
    logger.info('Starting cleanup of duplicate battle results...');

    // Find duplicate battle results
    const duplicates = await prisma.$queryRaw<Array<{
      subscriptionId: string;
      battleAlbionId: string;
      count: number;
    }>>`
      SELECT 
        "subscriptionId", 
        "battleAlbionId"::text, 
        COUNT(*) as count
      FROM "BattleResult"
      GROUP BY "subscriptionId", "battleAlbionId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `;

    if (duplicates.length === 0) {
      logger.info('No duplicate battle results found');
      return;
    }

    logger.info(`Found ${duplicates.length} duplicate battle result groups`);

    let totalRemoved = 0;

    for (const duplicate of duplicates) {
      logger.info(`Processing duplicates for subscription ${duplicate.subscriptionId}, battle ${duplicate.battleAlbionId} (${duplicate.count} records)`);

      // Get all records for this subscription/battle combination
      const records = await prisma.battleResult.findMany({
        where: {
          subscriptionId: duplicate.subscriptionId,
          battleAlbionId: BigInt(duplicate.battleAlbionId)
        },
        orderBy: {
          processedAt: 'asc' // Keep the oldest record
        }
      });

      if (records.length > 1) {
        // Keep the first (oldest) record, delete the rest
        const recordsToDelete = records.slice(1);
        
        for (const record of recordsToDelete) {
          await prisma.battleResult.delete({
            where: { id: record.id }
          });
          totalRemoved++;
        }

        logger.info(`Removed ${recordsToDelete.length} duplicate records for subscription ${duplicate.subscriptionId}, battle ${duplicate.battleAlbionId}`);
      }
    }

    logger.info(`Cleanup completed. Removed ${totalRemoved} duplicate battle result records`);

  } catch (error) {
    logger.error({
      message: 'Failed to cleanup duplicate battle results',
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the cleanup if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupDuplicateBattleResults()
    .then(() => {
      logger.info('Cleanup script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Cleanup script failed', error);
      process.exit(1);
    });
}

export { cleanupDuplicateBattleResults };
