# Multi-stage build for BFF
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY apps/api-bff/package.json apps/api-bff/package-lock.json* ./
RUN \
  if [ -f package-lock.json ]; then npm ci; \
  else echo "Lockfile not found." && exit 1; fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules

# Copy the entire project (Railway build context is root)
COPY . .

# Copy BFF source to working directory
WORKDIR /app/apps/api-bff

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
COPY --from=builder --chown=nextjs:nodejs /app/apps/api-bff/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/apps/api-bff/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/apps/api-bff/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/apps/api-bff/package.json ./package.json

USER nextjs

EXPOSE 3000

ENV PORT 3000

# Start the application
CMD ["node", "dist/server.js"]
