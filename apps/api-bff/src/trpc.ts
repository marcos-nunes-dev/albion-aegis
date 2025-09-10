import { initTRPC } from "@trpc/server";
import superjson from "superjson";

const t = initTRPC.context().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProc = t.procedure;
export const authedProc = t.procedure.use(({ ctx, next }) => {
  if (!(ctx as any).user) {
    throw new Error("UNAUTHORIZED");
  }
  return next();
});
