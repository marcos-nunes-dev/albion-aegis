import { WebhookClient } from 'discord.js';
import { log } from '../log.js';
import { GuildBattleStats } from '../types/albion.js';

const logger = log.child({ component: 'discord-webhook' });

export class DiscordWebhookService {
  private webhookClient: WebhookClient;

  constructor(webhookUrl: string) {
    this.webhookClient = new WebhookClient({ url: webhookUrl });
  }

  /**
   * Send a battle notification to Discord
   */
  async sendBattleNotification(
    battleId: bigint,
    guildStats: GuildBattleStats,
    counterStats: {
      wins: number;
      losses: number;
      kills: number;
      deaths: number;
    }
  ): Promise<boolean> {
    try {
      const embed = this.createBattleEmbed(battleId, guildStats, counterStats);
      
      await this.webhookClient.send({
        embeds: [embed]
      });

      logger.info({
        message: 'Discord notification sent successfully',
        battleId: battleId.toString(),
        entityName: guildStats.entityName,
        entityType: guildStats.entityType
      });

      return true;
    } catch (error) {
      logger.error({
        message: 'Failed to send Discord notification',
        error: error instanceof Error ? error.message : String(error),
        battleId: battleId.toString(),
        entityName: guildStats.entityName,
        entityType: guildStats.entityType
      });

      return false;
    }
  }

  /**
   * Create a Discord embed for battle notification
   */
  private createBattleEmbed(
    battleId: bigint,
    guildStats: GuildBattleStats,
    counterStats: {
      wins: number;
      losses: number;
      kills: number;
      deaths: number;
    }
  ) {
    const albionBbUrl = `https://albionbattledata.com/battle/${battleId}`;
    const result = guildStats.isWin ? 'WIN' : 'LOSS';
    const color = guildStats.isWin ? 0x00ff00 : 0xff0000; // Green for win, red for loss

    // Calculate winrate
    const totalGames = counterStats.wins + counterStats.losses;
    const winrate = totalGames > 0 ? ((counterStats.wins / totalGames) * 100).toFixed(1) : '0.0';

    // Calculate K/D ratio
    const kdRatio = counterStats.deaths > 0 ? (counterStats.kills / counterStats.deaths).toFixed(2) : counterStats.kills.toString();

    return {
      title: `⚔️ Battle Alert: ${guildStats.entityName}`,
      description: `**${result}** - Battle meets your tracking criteria!`,
      url: albionBbUrl,
      color: color,
      fields: [
        {
          name: '🏆 Battle Stats',
          value: `**Fame:** ${guildStats.totalFame.toLocaleString()}\n**Kills:** ${guildStats.totalKills}\n**Players:** ${guildStats.totalPlayers}`,
          inline: true
        },
        {
          name: '📊 This Battle',
          value: `**Kills:** ${guildStats.kills}\n**Deaths:** ${guildStats.deaths}\n**Result:** ${result}`,
          inline: true
        }
      ],
      footer: {
        text: `W/L: ${counterStats.wins}-${counterStats.losses} | KD: ${kdRatio} | Winrate: ${winrate}%`
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Test webhook connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.webhookClient.send({
        content: '🔧 Albion Aegis tracking service is now active!'
      });
      
      logger.info({ message: 'Discord webhook test successful' });
      return true;
    } catch (error) {
      logger.error({
        message: 'Discord webhook test failed',
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Destroy webhook client
   */
  destroy(): void {
    this.webhookClient.destroy();
  }
}

/**
 * Create a Discord webhook service instance
 */
export function createDiscordWebhookService(webhookUrl: string): DiscordWebhookService {
  return new DiscordWebhookService(webhookUrl);
}
