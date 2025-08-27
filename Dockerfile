# --- base: install deps only once -------------------------------------------
FROM node:20-alpine AS base
WORKDIR /app
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && apk add --no-cache openssl

# Copy manifests first for better layer caching
COPY package.json pnpm-lock.yaml* package-lock.json* yarn.lock* ./

# Detect the package manager and install deps (prod + dev for build)
# Prefer pnpm if lockfile exists, else fallback to npm
RUN \
  if [ -f pnpm-lock.yaml ]; then corepack use pnpm@9 && pnpm install --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f yarn.lock ]; then corepack prepare yarn@stable --activate && yarn install --frozen-lockfile; \
  else npm install; fi

# --- build: compile TS, generate prisma client, etc. ------------------------
FROM base AS build
WORKDIR /app
# Copy source
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY apps ./apps

# Prisma needs DATABASE_URL at generate-time; supply a dummy Postgres URL
# (Prisma won't connect; it just needs provider to generate the client)
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db"
RUN npx prisma generate

# Build TS
RUN \
  if [ -f pnpm-lock.yaml ]; then pnpm run build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f yarn.lock ]; then yarn build; \
  else npm run build; fi

# --- runtime: production image ----------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && apk add --no-cache openssl

# Copy only necessary files
COPY --from=base /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY package.json ./

# Create startup script
RUN echo '#!/bin/sh\n\
# Railway startup script\n\
echo "🚀 Starting Albion Aegis..."\n\
echo "NODE_ENV: $NODE_ENV"\n\
echo "Available apps:"\n\
ls -la dist/apps/\n\
\n\
# Run database migrations\n\
echo "🗄️ Running database migrations..."\n\
npx prisma migrate deploy\n\
\n\
# Start the application based on RAILWAY_SERVICE_NAME\n\
case "$RAILWAY_SERVICE_NAME" in\n\
  "albion-scheduler")\n\
    echo "🔄 Starting scheduler..."\n\
    exec node dist/apps/scheduler.js\n\
    ;;\n\
  "albion-kills")\n\
    echo "⚔️ Starting kills worker..."\n\
    exec node dist/apps/kills-worker.js\n\
    ;;\n\
  "albion-metrics")\n\
    echo "📊 Starting metrics server..."\n\
    exec node dist/apps/metrics-http.js\n\
    ;;\n\
  "albion-mmr")\n\
    echo "🏆 Starting MMR workers..."\n\
    exec node dist/apps/mmr-worker.js\n\
    ;;\n\
  *)\n\
    echo "❌ Unknown service: $RAILWAY_SERVICE_NAME"\n\
    echo "Available services: albion-scheduler, albion-kills, albion-metrics, albion-mmr"\n\
    exit 1\n\
    ;;\n\
esac' > /app/start.sh && chmod +x /app/start.sh

# Default command uses the startup script
CMD ["/app/start.sh"]
