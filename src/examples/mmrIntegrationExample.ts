import { MmrIntegrationService } from '../services/mmrIntegration.js';
import { startMmrWorkers } from '../queue/mmrQueue.js';
import { prisma } from '../db/prisma.js';
import { log } from '../log.js';

const logger = log.child({ component: 'mmr-integration-example' });

/**
 * Example: How to integrate MMR processing into your existing battle workflow
 * 
 * This shows how to add MMR calculation to your existing battle processing
 * without breaking the current functionality.
 */

// Initialize MMR integration service
const mmrIntegration = new MmrIntegrationService(prisma);

/**
 * Example 1: Integrate MMR processing into existing battle processing
 * 
 * Add this to your existing battle processing workflow after battle and kills are saved
 */
export async function exampleIntegrateIntoExistingWorkflow() {
  try {
    // Your existing battle processing code here...
    // const battleData = await fetchBattleFromAPI(battleId);
    // const killsData = await fetchKillsFromAPI(battleId);
    // await saveBattleToDatabase(battleData);
    // await saveKillsToDatabase(killsData);
    
    // NEW: Add MMR processing after battle is saved
    // const battleId = BigInt(battleData.id);
    // await mmrIntegration.processBattleForMmr(battleId, battleData, killsData);
    
    logger.info('Battle processed and queued for MMR calculation');
    
  } catch (error) {
    logger.error('Error in battle processing workflow', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    // Handle error appropriately
  }
}

/**
 * Example 2: Start MMR workers in your application startup
 * 
 * Add this to your main application startup
 */
export async function exampleStartMmrWorkers() {
  try {
    // Start MMR calculation workers
    await startMmrWorkers();
    
    logger.info('MMR workers started successfully');
    
    // Your existing application startup code...
    
  } catch (error) {
    logger.error('Error starting MMR workers', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    // Handle error appropriately
  }
}

/**
 * Example 3: Process historical battles for MMR backfill
 * 
 * Use this to calculate MMR for existing battles
 */
export async function exampleProcessHistoricalBattles() {
  try {
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2024-12-31');
    
    logger.info('Starting historical battle MMR processing', {
      startDate,
      endDate
    });
    
    await mmrIntegration.processHistoricalBattlesForMmr(startDate, endDate, 50);
    
    logger.info('Historical battle MMR processing completed');
    
  } catch (error) {
    logger.error('Error processing historical battles', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Example 4: Get MMR system statistics
 * 
 * Use this to monitor MMR system health
 */
export async function exampleGetMmrStats() {
  try {
    const stats = await mmrIntegration.getMmrProcessingStats();
    const health = await mmrIntegration.validateMmrSystemHealth();
    
    logger.info('MMR System Statistics', {
      stats,
      health
    });
    
    if (!health.isHealthy) {
      logger.warn('MMR System Health Issues', {
        issues: health.issues,
        recommendations: health.recommendations
      });
    }
    
  } catch (error) {
    logger.error('Error getting MMR stats', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Example 5: Integration with your existing battle crawler
 * 
 * This shows how to modify your existing battle crawler to include MMR processing
 */
export async function exampleModifyExistingBattleCrawler() {
  // Your existing battle crawler code...
  
  // After processing a battle and saving it to database:
  
  // OLD CODE:
  // await processBattle(battleId);
  // await processKills(battleId);
  // logger.info('Battle processed successfully');
  
  // NEW CODE:
  // await processBattle(battleId);
  // await processKills(battleId);
  // 
  // // Add MMR processing
  // const battleData = await getBattleData(battleId);
  // const killsData = await getKillsData(battleId);
  // await mmrIntegration.processBattleForMmr(battleId, battleData, killsData);
  // 
  // logger.info('Battle processed and queued for MMR calculation');
}

/**
 * Example 6: Batch processing for multiple battles
 * 
 * Use this when you have multiple battles to process at once
 */
export async function exampleBatchProcessBattles() {
  try {
    // Your existing batch processing code...
    // const battles = await fetchMultipleBattles();
    
    // Process battles in your existing way
    // for (const battle of battles) {
    //   await processBattle(battle.id);
    //   await processKills(battle.id);
    // }
    
    // NEW: Add MMR processing for all battles
    // const battlesForMmr = battles.map(battle => ({
    //   battleId: BigInt(battle.id),
    //   battleData: battle,
    //   killsData: battle.kills
    // }));
    // 
    // await mmrIntegration.processBattlesForMmr(battlesForMmr);
    
    logger.info('Batch battle processing completed with MMR calculation');
    
  } catch (error) {
    logger.error('Error in batch battle processing', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Example 7: Error handling and retry logic
 * 
 * Shows how to handle MMR processing errors gracefully
 */
export async function exampleErrorHandling() {
  try {
    // Your existing battle processing
    // const battleData = await fetchBattleFromAPI(battleId);
    // const killsData = await fetchKillsFromAPI(battleId);
    // await saveBattleToDatabase(battleData);
    // await saveKillsToDatabase(killsData);
    
    // MMR processing with error handling
    // try {
    //   await mmrIntegration.processBattleForMmr(battleId, battleData, killsData);
    // } catch (mmrError) {
    //   logger.error('MMR processing failed, but battle was saved', {
    //     battleId: battleId.toString(),
    //     error: mmrError instanceof Error ? mmrError.message : 'Unknown error'
    //   });
    //   // Don't fail the entire battle processing - MMR can be retried later
    // }
    
    logger.info('Battle processed with graceful MMR error handling');
    
  } catch (error) {
    logger.error('Error in battle processing', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    // Handle critical errors that should fail the entire process
  }
}

/**
 * Example 8: Monitoring and alerting
 * 
 * Shows how to monitor MMR system health
 */
export async function exampleMonitoring() {
  try {
    // Check MMR system health periodically
    const health = await mmrIntegration.validateMmrSystemHealth();
    
    if (!health.isHealthy) {
      // Send alert or notification
      logger.error('MMR System Health Check Failed', {
        issues: health.issues,
        recommendations: health.recommendations
      });
      
      // You could send a Discord notification, email, etc.
      // await sendAlert('MMR System Issues', health.issues.join(', '));
    } else {
      logger.info('MMR System Health Check Passed');
    }
    
    // Get processing statistics
    const stats = await mmrIntegration.getMmrProcessingStats();
    logger.info('MMR Processing Statistics', { stats });
    
  } catch (error) {
    logger.error('Error in MMR monitoring', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Example 9: Graceful shutdown
 * 
 * Shows how to properly shut down MMR workers
 */
export async function exampleGracefulShutdown() {
  try {
    // Your existing shutdown code...
    
    // NEW: Stop MMR workers gracefully
    const { stopMmrWorkers } = await import('../queue/mmrQueue.js');
    await stopMmrWorkers();
    
    logger.info('MMR workers stopped gracefully');
    
  } catch (error) {
    logger.error('Error during graceful shutdown', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Export all examples for easy access
export const mmrIntegrationExamples = {
  integrateIntoExistingWorkflow: exampleIntegrateIntoExistingWorkflow,
  startMmrWorkers: exampleStartMmrWorkers,
  processHistoricalBattles: exampleProcessHistoricalBattles,
  getMmrStats: exampleGetMmrStats,
  modifyExistingBattleCrawler: exampleModifyExistingBattleCrawler,
  batchProcessBattles: exampleBatchProcessBattles,
  errorHandling: exampleErrorHandling,
  monitoring: exampleMonitoring,
  gracefulShutdown: exampleGracefulShutdown
};
