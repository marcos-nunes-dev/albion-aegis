#!/usr/bin/env tsx

import { createServer } from 'http';
import { registry } from '../src/metrics.js';
import { log, metricsLogger } from '../src/log.js';
import { config } from '../src/lib/config.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

// Create HTTP server
const server = createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS requests
    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Route handling
    switch (url) {
      case '/metrics':
        if (method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('Method Not Allowed');
          return;
        }

        try {
          const metrics = await registry.metrics();
          res.writeHead(200, { 'Content-Type': registry.contentType });
          res.end(metrics);
          
          metricsLogger.info('Metrics endpoint accessed', { 
            method, 
            url, 
            status: 200 
          });
        } catch (error) {
          metricsLogger.error('Failed to generate metrics', { error });
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
        break;

      case '/healthz':
        if (method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('Method Not Allowed');
          return;
        }

        // Simple health check
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: process.env.npm_package_version || '1.0.0',
        }));
        
        metricsLogger.info('Health check accessed', { 
          method, 
          url, 
          status: 200 
        });
        break;

      case '/':
        if (method !== 'GET') {
          res.writeHead(405, { 'Content-Type': 'text/plain' });
          res.end('Method Not Allowed');
          return;
        }

        // Root endpoint with basic info
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: 'Albion Aegis Metrics Server',
          version: process.env.npm_package_version || '1.0.0',
          endpoints: {
            metrics: '/metrics',
            health: '/healthz',
          },
          timestamp: new Date().toISOString(),
        }));
        
        metricsLogger.info('Root endpoint accessed', { 
          method, 
          url, 
          status: 200 
        });
        break;

      default:
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        
        metricsLogger.warn('Unknown endpoint accessed', { 
          method, 
          url, 
          status: 404 
        });
        break;
    }

  } catch (error) {
    metricsLogger.error('Server error', { error, method, url });
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

// Start server
server.listen(PORT, () => {
  log.info('Metrics server started', {
    port: PORT,
    env: config.NODE_ENV,
    endpoints: {
      metrics: `http://localhost:${PORT}/metrics`,
      health: `http://localhost:${PORT}/healthz`,
      root: `http://localhost:${PORT}/`,
    },
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('Shutting down metrics server...');
  server.close(() => {
    log.info('Metrics server stopped');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log.info('Shutting down metrics server...');
  server.close(() => {
    log.info('Metrics server stopped');
    process.exit(0);
  });
});

// Error handling
server.on('error', (error) => {
  log.error('Server error', { error });
  process.exit(1);
});
