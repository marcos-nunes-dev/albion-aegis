import { databaseService } from './database.js';

export interface BattleListItem {
  albionId: string;
  startedAt: string;
  totalFame: number;
  totalKills: number;
  totalPlayers: number;
  guilds: GuildInfo[];
  alliances: AllianceInfo[];
}

export interface GuildInfo {
  id?: string;
  name?: string;
  alliance?: string;
  killFame: number;
  deathFame?: number;
  players?: number;
}

export interface AllianceInfo {
  id?: string;
  name?: string;
  tag?: string;
  killFame: number;
  deathFame?: number;
  players?: number;
}

export interface BattleDetail extends BattleListItem {
  guilds: GuildDetail[];
  alliances: AllianceDetail[];
  players: PlayerInfo[];
}

export interface GuildDetail extends GuildInfo {
  kills?: number;
  deaths?: number;
  ip?: number;
}

export interface AllianceDetail extends AllianceInfo {
  kills?: number;
  deaths?: number;
  ip?: number;
}

export interface PlayerInfo {
  name: string;
  guildName?: string;
  allianceName?: string;
  kills: number;
  deaths: number;
  killFame: number;
  deathFame: number;
  ip: number;
}

export interface BattleStats {
  totalBattles: number;
  totalFame: number;
  totalKills: number;
  averagePlayers: number;
  recentBattles: number;
}

export class BattleService {
  private prisma = databaseService.getPrisma();

  /**
   * Get battles with pagination and filtering
   */
  async getBattles(page: number, limit: number, minPlayers: number, sort: string = 'recent') {
    try {
      const offset = page * limit;
      
      // Build where clause
      const where = {
        totalPlayers: {
          gte: minPlayers
        }
      };

      // Build order by clause
      let orderBy: any = {};
      switch (sort) {
        case 'recent':
          orderBy = { startedAt: 'desc' };
          break;
        case 'oldest':
          orderBy = { startedAt: 'asc' };
          break;
        case 'fame':
          orderBy = { totalFame: 'desc' };
          break;
        case 'players':
          orderBy = { totalPlayers: 'desc' };
          break;
        default:
          orderBy = { startedAt: 'desc' };
      }

      // Get total count
      const total = await this.prisma.battle.count({ where });

      // Get battles
      const battles = await this.prisma.battle.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        select: {
          albionId: true,
          startedAt: true,
          totalFame: true,
          totalKills: true,
          totalPlayers: true,
          alliancesJson: true,
          guildsJson: true,
        }
      });

      // Transform battles to include parsed JSON data
      const transformedBattles: BattleListItem[] = battles.map(battle => {
        const guilds = Array.isArray(battle.guildsJson) ? battle.guildsJson : [];
        const alliances = Array.isArray(battle.alliancesJson) ? battle.alliancesJson : [];

        return {
          albionId: battle.albionId.toString(),
          startedAt: battle.startedAt.toISOString(),
          totalFame: battle.totalFame,
          totalKills: battle.totalKills,
          totalPlayers: battle.totalPlayers,
          guilds: guilds.map((g: any) => ({
            id: g.id,
            name: g.name,
            alliance: g.alliance,
            killFame: g.killFame || 0,
            deathFame: g.deathFame,
            players: g.players,
          })),
          alliances: alliances.map((a: any) => ({
            id: a.id,
            name: a.name,
            tag: a.tag,
            killFame: a.killFame || 0,
            deathFame: a.deathFame,
            players: a.players,
          })),
        };
      });

      return {
        battles: transformedBattles,
        pagination: {
          page,
          limit,
          total,
          hasMore: offset + limit < total,
          totalPages: Math.ceil(total / limit),
        },
        filters: {
          minPlayers,
          sort,
        },
      };
    } catch (error) {
      console.error('Error fetching battles:', error);
      throw new Error('Failed to fetch battles');
    }
  }

  /**
   * Get battle details by Albion ID
   */
  async getBattleDetail(albionId: bigint): Promise<BattleDetail | null> {
    try {
      const battle = await this.prisma.battle.findUnique({
        where: { albionId },
        select: {
          albionId: true,
          startedAt: true,
          totalFame: true,
          totalKills: true,
          totalPlayers: true,
          alliancesJson: true,
          guildsJson: true,
        }
      });

      if (!battle) {
        return null;
      }

      // Get kill events for this battle
      const killEvents = await this.prisma.killEvent.findMany({
        where: { battleAlbionId: albionId },
        select: {
          killerName: true,
          killerGuild: true,
          killerAlliance: true,
          killerAvgIP: true,
          victimName: true,
          victimGuild: true,
          victimAlliance: true,
          victimAvgIP: true,
          TotalVictimKillFame: true,
        }
      });

      // Parse JSON data
      const guilds = Array.isArray(battle.guildsJson) ? battle.guildsJson : [];
      const alliances = Array.isArray(battle.alliancesJson) ? battle.alliancesJson : [];

      // Transform to BattleDetail format
      const battleDetail: BattleDetail = {
        albionId: battle.albionId.toString(),
        startedAt: battle.startedAt.toISOString(),
        totalFame: battle.totalFame,
        totalKills: battle.totalKills,
        totalPlayers: battle.totalPlayers,
        guilds: guilds.map((g: any) => ({
          id: g.id,
          name: g.name,
          alliance: g.alliance,
          killFame: g.killFame || 0,
          deathFame: g.deathFame,
          players: g.players,
          kills: g.kills,
          deaths: g.deaths,
          ip: g.ip,
        })),
        alliances: alliances.map((a: any) => ({
          id: a.id,
          name: a.name,
          tag: a.tag,
          killFame: a.killFame || 0,
          deathFame: a.deathFame,
          players: a.players,
          kills: a.kills,
          deaths: a.deaths,
          ip: a.ip,
        })),
        players: this.transformKillEventsToPlayers(killEvents),
      };

      return battleDetail;
    } catch (error) {
      console.error('Error fetching battle detail:', error);
      throw new Error('Failed to fetch battle detail');
    }
  }

  /**
   * Transform kill events to player information
   */
  private transformKillEventsToPlayers(killEvents: any[]): PlayerInfo[] {
    const playerMap = new Map<string, PlayerInfo>();

    killEvents.forEach(event => {
      // Process killer
      if (event.killerName) {
        const killerKey = event.killerName.toLowerCase();
        if (!playerMap.has(killerKey)) {
          playerMap.set(killerKey, {
            name: event.killerName,
            guildName: event.killerGuild,
            allianceName: event.killerAlliance,
            kills: 0,
            deaths: 0,
            killFame: 0,
            deathFame: 0,
            ip: event.killerAvgIP || 0,
          });
        }
        const killer = playerMap.get(killerKey)!;
        killer.kills++;
        killer.killFame += event.TotalVictimKillFame || 0;
      }

      // Process victim
      if (event.victimName) {
        const victimKey = event.victimName.toLowerCase();
        if (!playerMap.has(victimKey)) {
          playerMap.set(victimKey, {
            name: event.victimName,
            guildName: event.victimGuild,
            allianceName: event.victimAlliance,
            kills: 0,
            deaths: 0,
            killFame: 0,
            deathFame: 0,
            ip: event.victimAvgIP || 0,
          });
        }
        const victim = playerMap.get(victimKey)!;
        victim.deaths++;
        victim.deathFame += event.TotalVictimKillFame || 0;
      }
    });

    return Array.from(playerMap.values());
  }

  /**
   * Get battle statistics
   */
  async getBattleStats(): Promise<BattleStats> {
    try {
      const [totalBattles, totalFame, totalKills, avgPlayers, recentBattles] = await Promise.all([
        this.prisma.battle.count(),
        this.prisma.battle.aggregate({
          _sum: { totalFame: true }
        }),
        this.prisma.battle.aggregate({
          _sum: { totalKills: true }
        }),
        this.prisma.battle.aggregate({
          _avg: { totalPlayers: true }
        }),
        this.prisma.battle.count({
          where: {
            startedAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
            }
          }
        })
      ]);

      return {
        totalBattles,
        totalFame: totalFame._sum.totalFame || 0,
        totalKills: totalKills._sum.totalKills || 0,
        averagePlayers: Math.round(avgPlayers._avg.totalPlayers || 0),
        recentBattles,
      };
    } catch (error) {
      console.error('Error fetching battle stats:', error);
      throw new Error('Failed to fetch battle statistics');
    }
  }
}
