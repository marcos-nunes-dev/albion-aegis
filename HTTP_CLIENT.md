# HTTP Client Implementation

## Overview

The Albion Aegis HTTP client provides a robust, rate-limited interface to the Albion Online API with automatic retry logic and response validation.

## Features

### 🔒 Rate Limiting
- **Bottleneck-based rate limiting** respecting `RATE_MAX_RPS` configuration
- **Token bucket algorithm** with automatic token refresh
- **Concurrent request limiting** to prevent API overload

### 🔄 Exponential Backoff
- **Automatic retry** for 429 (rate limit) and 5xx (server error) responses
- **Exponential backoff** with jitter: 1s → 2s → 4s → 8s → 16s (capped at 30s)
- **Maximum 5 retry attempts** per request
- **Server-provided retry-after** headers respected for rate limits

### ✅ Response Validation
- **Zod schema validation** for all API responses
- **Type-safe TypeScript** types inferred from schemas
- **Safe parsing functions** that return null on validation failure
- **Detailed error messages** for debugging

### 🛡️ Error Handling
- **Custom error classes** for different failure types
- **Network error handling** with proper error wrapping
- **Timeout handling** (10s headers, 30s body)
- **Graceful degradation** for API failures

## API Methods

### `getBattlesPage(page: number, minPlayers: number)`
Fetches a page of battles from the Albion API.

```typescript
const battles = await getBattlesPage(0, 10);
// Returns: BattleListResponse (array of BattleListItem)
```

**Parameters:**
- `page`: Page number (0-based)
- `minPlayers`: Minimum number of players in battle

**Response Structure:**
```typescript
{
  albionId: bigint,
  startedAt: string,
  totalFame: number,
  totalKills: number,
  totalPlayers: number,
  alliances: Array<{...}>,
  guilds: Array<{...}>
}
```

### `getBattleDetail(albionId: bigint)`
Fetches detailed battle information including player statistics.

```typescript
const battleDetail = await getBattleDetail(1264103504n);
// Returns: BattleDetail
```

**Response Structure:**
```typescript
{
  albionId: bigint,
  startedAt: string,
  finishedAt?: string,
  totalFame: number,
  totalKills: number,
  totalPlayers: number,
  alliances: Array<{...}>,
  guilds: Array<{...}>,
  players: Array<{
    name: string,
    guildName?: string,
    allianceName?: string,
    kills: number,
    deaths: number,
    killFame: number,
    deathFame: number,
    ip: number,
    weapon?: {...}
  }>
}
```

### `getKillsForBattle(albionId: bigint)`
Fetches detailed kill events for a specific battle.

```typescript
const killEvents = await getKillsForBattle(1264104771n);
// Returns: KillEventsResponse (array of KillEvent)
```

**Response Structure:**
```typescript
{
  EventId: bigint,
  TimeStamp: string,
  TotalVictimKillFame: number,
  Killer: {
    Id: string,
    Name: string,
    GuildName?: string,
    AllianceName?: string,
    AverageItemPower: number,
    Equipment?: {
      MainHand?: {
        Name: string,
        Type: string,
        Quality: number
      },
      Mount?: {
        Name: string,
        Type: string,
        Quality: number
      }
    }
  },
  Victim: {
    Id: string,
    Name: string,
    GuildName?: string,
    AllianceName?: string,
    AverageItemPower: number,
    Equipment?: {
      MainHand?: {
        Name: string,
        Type: string,
        Quality: number
      },
      Mount?: {
        Name: string,
        Type: string,
        Quality: number
      }
    }
  }
}
```

## Configuration

The HTTP client uses the following configuration from `config.ts`:

```typescript
{
  API_BASE_URL: "https://api-next.albionbb.com/us",
  USER_AGENT: "albion-analytics-bot/1.0",
  RATE_MAX_RPS: 4
}
```

## Error Types

### `AlbionAPIError`
Base error class for all API-related errors.

```typescript
{
  message: string,
  statusCode?: number,
  retryAfter?: number,
  isRetryable: boolean
}
```

### `RateLimitError`
Thrown when rate limit is exceeded (429).

### `ValidationError`
Thrown when API response fails Zod validation.

## Usage Examples

### Basic Usage
```typescript
import { getBattlesPage, getBattleDetail, getKillsForBattle } from './src/http/client.js';

// Fetch battles
const battles = await getBattlesPage(0, 10);
console.log(`Found ${battles.length} battles`);

// Fetch battle details
const battleDetail = await getBattleDetail(battles[0].albionId);
console.log(`Battle has ${battleDetail.players.length} players`);

// Fetch kill events
const killEvents = await getKillsForBattle(battles[0].albionId);
console.log(`Battle has ${killEvents.length} kill events`);
```

### Error Handling
```typescript
import { AlbionAPIError, RateLimitError } from './src/http/client.js';

try {
  const battles = await getBattlesPage(0, 10);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited, retry after ${error.retryAfter}ms`);
  } else if (error instanceof AlbionAPIError) {
    console.log(`API error: ${error.message}`);
  } else {
    console.log(`Unexpected error: ${error.message}`);
  }
}
```

### Rate Limiter Monitoring
```typescript
import { getRateLimiterStats } from './src/http/client.js';

const stats = getRateLimiterStats();
console.log(`Running: ${stats.running}, Queued: ${stats.queued}`);
```

## Testing

The HTTP client has been tested with real Albion API endpoints:

✅ **Battle List API** - Successfully fetches battle summaries  
✅ **Battle Detail API** - Successfully fetches detailed battle information  
✅ **Kill Events API** - Successfully fetches detailed kill events  
✅ **Rate Limiting** - Respects API rate limits  
✅ **Error Handling** - Properly handles various error conditions  
✅ **Response Validation** - Validates all API responses with Zod  

## Performance

- **Rate Limited**: 4 requests per second (configurable)
- **Timeout**: 10s headers, 30s body
- **Retry Logic**: Up to 5 attempts with exponential backoff
- **Memory Efficient**: Uses Undici for HTTP requests
- **Type Safe**: Full TypeScript support with inferred types

## Integration

The HTTP client is integrated with:
- **Configuration system** for API settings
- **Database client** for storing battle data
- **Type system** for API response validation
- **Scheduler** for automated data collection

## API Endpoints

The client supports the following Albion Online API endpoints:

1. **`/battles`** - Battle list with filtering and pagination
2. **`/battles/{id}`** - Detailed battle information with player statistics
3. **`/battles/kills?ids={id}`** - Detailed kill events for specific battles

All endpoints are rate-limited and include automatic retry logic for reliability.
