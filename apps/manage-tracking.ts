#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { TrackingService } from '../src/services/tracking.js';
import { DiscordWebhookService } from '../src/services/discord.js';
import { log } from '../src/log.js';

const logger = log.child({ component: 'manage-tracking' });
const prisma = new PrismaClient();
const trackingService = new TrackingService(prisma);

// CLI argument parsing
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    switch (command) {
      case 'add':
        await addSubscription();
        break;
      case 'list':
        await listSubscriptions();
        break;
      case 'reset':
        await resetCounter();
        break;
      case 'test':
        await testWebhook();
        break;
      case 'delete':
        await deleteSubscription();
        break;
      default:
        showHelp();
    }
  } catch (error) {
    logger.error({
      message: 'CLI command failed',
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function addSubscription() {
  const [userId, entityName, entityType, webhookUrl, minFame, minKills, minPlayers] = args.slice(1);
  
  if (!userId || !entityName || !entityType || !webhookUrl) {
    console.log('Usage: npm run tracking:add <userId> <entityName> <entityType> <webhookUrl> [minFame] [minKills] [minPlayers]');
    console.log('Example: npm run tracking:add user123 "My Guild" GUILD https://discord.com/api/webhooks/... 1000000 50 20');
    process.exit(1);
  }

  if (!['GUILD', 'ALLIANCE'].includes(entityType)) {
    console.log('Entity type must be GUILD or ALLIANCE');
    process.exit(1);
  }

  try {
    const subscription = await prisma.trackingSubscription.create({
      data: {
        userId,
        entityName,
        entityType: entityType as 'GUILD' | 'ALLIANCE',
        discordWebhook: webhookUrl,
        minTotalFame: parseInt(minFame) || 0,
        minTotalKills: parseInt(minKills) || 0,
        minTotalPlayers: parseInt(minPlayers) || 0,
        isActive: true
      }
    });

    console.log('✅ Subscription created successfully!');
    console.log(`ID: ${subscription.id}`);
    console.log(`Entity: ${subscription.entityName} (${subscription.entityType})`);
    console.log(`Criteria: ${subscription.minTotalFame} fame, ${subscription.minTotalKills} kills, ${subscription.minTotalPlayers} players`);

    // Test webhook
    console.log('\n🔧 Testing Discord webhook...');
    const discordService = new DiscordWebhookService(webhookUrl);
    const success = await discordService.testConnection();
    
    if (success) {
      console.log('✅ Discord webhook test successful!');
    } else {
      console.log('❌ Discord webhook test failed. Please check your webhook URL.');
    }

    discordService.destroy();

  } catch (error) {
    console.log('❌ Failed to create subscription:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function listSubscriptions() {
  const subscriptions = await prisma.trackingSubscription.findMany({
    include: {
      counterHistory: {
        where: { isActive: true },
        take: 1
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (subscriptions.length === 0) {
    console.log('No tracking subscriptions found.');
    return;
  }

  console.log(`\n📊 Found ${subscriptions.length} tracking subscription(s):\n`);

  for (const sub of subscriptions) {
    const counter = sub.counterHistory[0];
    const stats = counter ? `W/L: ${counter.totalWins}-${counter.totalLosses} | KD: ${counter.totalKills}-${counter.totalDeaths}` : 'No battles yet';
    
    console.log(`ID: ${sub.id}`);
    console.log(`User: ${sub.userId}`);
    console.log(`Entity: ${sub.entityName} (${sub.entityType})`);
    console.log(`Criteria: ${sub.minTotalFame} fame, ${sub.minTotalKills} kills, ${sub.minTotalPlayers} players`);
    console.log(`Status: ${sub.isActive ? '✅ Active' : '❌ Inactive'}`);
    console.log(`Stats: ${stats}`);
    console.log(`Created: ${sub.createdAt.toISOString()}`);
    console.log('---');
  }
}

async function resetCounter() {
  const subscriptionId = args[1];
  
  if (!subscriptionId) {
    console.log('Usage: npm run tracking:reset <subscriptionId>');
    console.log('Use "npm run tracking:list" to see available subscription IDs');
    process.exit(1);
  }

  try {
    const newCounterId = await trackingService.resetCounter(subscriptionId);
    console.log('✅ Counter reset successfully!');
    console.log(`New counter ID: ${newCounterId}`);
    
    // Show new stats
    const stats = await trackingService.getCounterStats(subscriptionId);
    if (stats) {
      console.log(`New stats: W/L: ${stats.wins}-${stats.losses} | KD: ${stats.kills}-${stats.deaths}`);
    }
  } catch (error) {
    console.log('❌ Failed to reset counter:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function testWebhook() {
  const subscriptionId = args[1];
  
  if (!subscriptionId) {
    console.log('Usage: npm run tracking:test <subscriptionId>');
    console.log('Use "npm run tracking:list" to see available subscription IDs');
    process.exit(1);
  }

  try {
    const subscription = await prisma.trackingSubscription.findUnique({
      where: { id: subscriptionId }
    });

    if (!subscription) {
      console.log('❌ Subscription not found');
      process.exit(1);
    }

    console.log(`🔧 Testing webhook for ${subscription.entityName}...`);
    const discordService = new DiscordWebhookService(subscription.discordWebhook);
    const success = await discordService.testConnection();
    
    if (success) {
      console.log('✅ Discord webhook test successful!');
    } else {
      console.log('❌ Discord webhook test failed. Please check your webhook URL.');
    }

    discordService.destroy();
  } catch (error) {
    console.log('❌ Failed to test webhook:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function deleteSubscription() {
  const subscriptionId = args[1];
  
  if (!subscriptionId) {
    console.log('Usage: npm run tracking:delete <subscriptionId>');
    console.log('Use "npm run tracking:list" to see available subscription IDs');
    process.exit(1);
  }

  try {
    const subscription = await prisma.trackingSubscription.findUnique({
      where: { id: subscriptionId }
    });

    if (!subscription) {
      console.log('❌ Subscription not found');
      process.exit(1);
    }

    await prisma.trackingSubscription.delete({
      where: { id: subscriptionId }
    });

    console.log('✅ Subscription deleted successfully!');
    console.log(`Deleted: ${subscription.entityName} (${subscription.entityType})`);
  } catch (error) {
    console.log('❌ Failed to delete subscription:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
🎯 Albion Aegis Tracking Management CLI

Commands:
  add     - Add a new tracking subscription
  list    - List all tracking subscriptions
  reset   - Reset counter for a subscription
  test    - Test Discord webhook for a subscription
  delete  - Delete a tracking subscription

Examples:
  npm run tracking:add user123 "My Guild" GUILD https://discord.com/api/webhooks/... 1000000 50 20
  npm run tracking:list
  npm run tracking:reset <subscriptionId>
  npm run tracking:test <subscriptionId>
  npm run tracking:delete <subscriptionId>

Entity Types: GUILD, ALLIANCE
  `);
}

main().catch((error) => {
  logger.error({
    message: 'CLI failed',
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
