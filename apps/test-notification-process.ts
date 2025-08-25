import { PrismaClient } from '@prisma/client';
import { log } from '../src/log.js';
import { BattleNotifierWorker } from '../src/workers/battleNotifier/worker.js';

const logger = log.child({ component: 'test-notification-process' });

async function testNotificationProcess() {
  logger.info('Starting notification process test with case-insensitive fix...');
  
  const prisma = new PrismaClient();
  const worker = new BattleNotifierWorker(prisma);
  
  try {
    // Create a mock job for the battle that has PlVAS
    const mockJob = {
      id: 'test-job-2',
      data: {
        battleId: '1265121608' // The battle that has PlVAS
      }
    } as any;

    logger.info({
      message: 'Processing mock battle notification job',
      battleId: mockJob.data.battleId
    });

    // Process the job directly
    await worker.processJob(mockJob);

    logger.info({
      message: 'Notification process test completed',
      battleId: mockJob.data.battleId
    });

  } catch (error) {
    logger.error({
      message: 'Failed to process notification',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testNotificationProcess().catch(console.error);
