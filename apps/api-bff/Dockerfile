# Multi-stage build for BFF
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy the entire project (Railway build context is root)
COPY . .

# Install BFF dependencies
WORKDIR /app/apps/api-bff
RUN npm ci

# Ensure Prisma client and CLI are available in this directory
RUN npm install @prisma/client prisma

# Generate Prisma client using the root schema
RUN npx prisma generate --schema=../../prisma/schema.prisma

# Build the application
RUN npm run build

# Production image, copy all the files and run the app
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=deps --chown=nextjs:nodejs /app/apps/api-bff/dist ./dist
COPY --from=deps --chown=nextjs:nodejs /app/apps/api-bff/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps --chown=nextjs:nodejs /app/apps/api-bff/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps --chown=nextjs:nodejs /app/apps/api-bff/package.json ./package.json

USER nextjs

EXPOSE 3000

ENV PORT 3000

# Start the application
CMD ["node", "dist/server.js"]
