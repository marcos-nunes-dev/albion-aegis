import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import superjson from 'superjson';

/**
 * Initialize tRPC API
 */
const t = initTRPC.create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof z.ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a router and procedure (the recommended way to fetch data)
 */
export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export { t };
