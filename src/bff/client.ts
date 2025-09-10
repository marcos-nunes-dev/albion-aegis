import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from './router.js';

// Create tRPC client for use in Next.js frontend
export const createBFFClient = (baseUrl: string = 'http://localhost:3001') => {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
        // You can add custom headers here if needed
        // headers: {
        //   'Authorization': `Bearer ${token}`,
        // },
      }),
    ],
  });
};

// Example usage:
// const bff = createBFFClient(process.env.NEXT_PUBLIC_BFF_URL);
// const battles = await bff.battle.getBattles.query({ page: 1, limit: 20 });
// const guildStats = await bff.entity.getGuildStats.query({ guildName: 'YourGuild' });
