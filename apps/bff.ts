#!/usr/bin/env tsx

import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from '../src/bff/router.js';
import { config } from '../src/lib/config.js';
import { getPrisma, getHealthStatus } from '../src/db/database.js';

console.log('🚀 Albion BFF starting...');
console.log('📊 Configuration:', {
  NODE_ENV: config.NODE_ENV,
  API_BASE_URL: config.API_BASE_URL,
  REDIS_URL: config.REDIS_URL ? '***configured***' : '❌ missing',
  DATABASE_POOL_MIN: config.DATABASE_POOL_MIN,
  DATABASE_POOL_MAX: config.DATABASE_POOL_MAX,
});

// Log database health status
const healthStatus = getHealthStatus();
console.log('🗄️ Database Health Status:', {
  isConnected: healthStatus.isConnected,
  connectionErrors: healthStatus.connectionErrors,
  lastHealthCheck: healthStatus.lastHealthCheck,
  poolConfig: healthStatus.poolConfig,
});

// Test database connection
try {
  const prisma = getPrisma();
  await prisma.$connect();
  console.log('✅ Database connection successful');
} catch (error) {
  console.error('❌ Database connection failed:', error);
  process.exit(1);
}

// Create Express app
const app = express();
const PORT = process.env.BFF_PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: process.env.BFF_ALLOWED_ORIGINS 
    ? process.env.BFF_ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());



// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'albion-bff',
    database: healthStatus.isConnected ? 'connected' : 'disconnected',
  });
});

// tRPC middleware
app.use('/trpc', createExpressMiddleware({
  router: appRouter,
  createContext: () => ({}),
}));

// Basic info endpoint
app.get('/', (_req, res) => {
  res.json({
    service: 'Albion Aegis BFF',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      trpc: '/trpc',
      docs: 'https://trpc.io/docs',
    },
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log('✅ BFF started successfully');
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`🔗 tRPC endpoint: http://localhost:${PORT}/trpc`);
  console.log(`💡 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 CORS origins: ${corsOptions.origin.join(', ')}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down BFF...');
  server.close(async () => {
    const prisma = getPrisma();
    await prisma.$disconnect();
    console.log('✅ BFF shutdown complete');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🛑 Shutting down BFF...');
  server.close(async () => {
    const prisma = getPrisma();
    await prisma.$disconnect();
    console.log('✅ BFF shutdown complete');
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
