import { BattleNotifierProducer } from '../src/workers/battleNotifier/producer.js';
import { log } from '../src/log.js';

const logger = log.child({ component: 'test-enqueue-job' });

async function testEnqueueJob() {
  try {
    logger.info('Testing job enqueueing...');

    const producer = new BattleNotifierProducer();

    // Enqueue a test job for a recent battle
    const testBattleId = BigInt('1265138272'); // One of the recent battles
    
    logger.info({
      message: 'Enqueueing test battle notification job',
      battleId: testBattleId.toString()
    });

    await producer.enqueueBattleNotification(testBattleId);

    logger.info('Job enqueued successfully');

    // Get queue stats
    const stats = await producer.getQueueStats();
    
    logger.info({
      message: 'Queue stats after enqueueing',
      stats
    });

    await producer.close();

  } catch (error) {
    logger.error({
      message: 'Failed to enqueue job',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

testEnqueueJob();
