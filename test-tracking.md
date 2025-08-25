# Testing the Guild/Alliance Tracking Feature

This guide demonstrates how to test the new tracking feature.

## Prerequisites

1. **Discord Webhook**: Create a webhook in your Discord server
   - Go to Server Settings → Integrations → Webhooks
   - Create a new webhook and copy the URL

2. **Environment Setup**: Make sure your `.env` file has the required variables:
   ```bash
   DATABASE_URL=your_postgresql_url
   REDIS_URL=your_redis_url
   API_BASE_URL=https://api-next.albionbb.com/us
   USER_AGENT=albion-analytics-bot/1.0 (contact: your@email.com)
   ```

## Step-by-Step Testing

### 1. Check Current Subscriptions
```bash
npm run tracking:list
```
Expected output: "No tracking subscriptions found."

### 2. Add a Test Subscription
```bash
npm run tracking:add testuser "Test Guild" GUILD https://discord.com/api/webhooks/YOUR_WEBHOOK_URL 0 0 0
```
This creates a subscription that will trigger for any battle (no minimum criteria).

### 3. Verify Subscription Created
```bash
npm run tracking:list
```
You should see your new subscription with stats showing "No battles yet".

### 4. Test Discord Webhook
```bash
npm run tracking:test <subscription_id>
```
Replace `<subscription_id>` with the ID from step 3. You should receive a test message in Discord.

### 5. Start the Battle Notifier Worker
```bash
npm run start:notifier
```
This worker processes battle notifications in the background.

### 6. Start the Scheduler (in another terminal)
```bash
npm run start:scheduler
```
This will crawl for new battles and trigger notifications.

### 7. Monitor for Notifications
When a battle is found that meets your criteria, you'll receive a Discord notification with:
- Battle details
- Win/Loss result
- Current W/L - KD - Winrate stats

### 8. Check Updated Stats
```bash
npm run tracking:list
```
You should now see updated statistics for your subscription.

### 9. Reset Counter (Optional)
```bash
npm run tracking:reset <subscription_id>
```
This starts a new tracking period while preserving historical data.

### 10. Clean Up
```bash
npm run tracking:delete <subscription_id>
```
Removes the test subscription.

## Example Discord Notification

When a battle is found, you'll receive a Discord embed like this:

```
⚔️ Battle Alert: Test Guild
WIN - Battle meets your tracking criteria!

🏆 Battle Stats          📊 This Battle
Fame: 1,234,567         Kills: 15
Kills: 25               Deaths: 8
Players: 30             Result: WIN

W/L: 1-0 | KD: 1.88 | Winrate: 100.0%
```

## Troubleshooting

### Common Issues

1. **Discord Webhook Not Working**
   - Verify the webhook URL is correct
   - Check that the webhook is active in Discord
   - Use `npm run tracking:test` to test the connection

2. **No Notifications Received**
   - Ensure the battle notifier worker is running
   - Check that the scheduler is running
   - Verify your criteria aren't too restrictive (try 0,0,0 for testing)

3. **Database Connection Issues**
   - Verify your `DATABASE_URL` is correct
   - Run `npx prisma db push` to ensure schema is up to date

4. **Redis Connection Issues**
   - Verify your `REDIS_URL` is correct
   - Check that Redis is running and accessible

### Logs to Monitor

- Battle notifier worker logs: Look for "Processing battle notification job"
- Scheduler logs: Look for "Battle crawl completed"
- Discord service logs: Look for "Discord notification sent successfully"

## Performance Notes

- The system is designed to handle multiple users tracking the same guild
- Battle analysis is done once per battle, shared across all subscriptions
- Notifications are batched for performance
- Historical data is preserved when counters are reset
