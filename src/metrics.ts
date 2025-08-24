import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';

// Create metrics registry
export const registry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: registry });

// HTTP request metrics
export const requestsTotal = new Counter({
  name: 'requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['endpoint', 'status'],
  registers: [registry],
});

export const errorsTotal = new Counter({
  name: 'errors_total',
  help: 'Total number of errors',
  labelNames: ['endpoint', 'status'],
  registers: [registry],
});

// Entity upsert metrics
export const entitiesUpsertedTotal = new Counter({
  name: 'entities_upserted_total',
  help: 'Total number of entities upserted to database',
  labelNames: ['type'],
  registers: [registry],
});

// Queue job metrics
export const queueJobs = new Gauge({
  name: 'queue_jobs',
  help: 'Number of jobs in queue by state',
  labelNames: ['name', 'state'],
  registers: [registry],
});

// Crawler metrics (optional)
export const crawlerPagesScannedTotal = new Counter({
  name: 'crawler_pages_scanned_total',
  help: 'Total number of pages scanned by crawler',
  registers: [registry],
});

export const crawlerAllOlderPagesTotal = new Counter({
  name: 'crawler_all_older_pages_total',
  help: 'Total number of pages where all battles were older than cutoff',
  registers: [registry],
});

// Utility functions for metrics
export const metrics = {
  // HTTP metrics
  recordRequest: (endpoint: string, status: number) => {
    requestsTotal.inc({ endpoint, status: status.toString() });
  },

  recordError: (endpoint: string, status: number) => {
    errorsTotal.inc({ endpoint, status: status.toString() });
  },

  // Entity metrics
  recordBattleUpsert: () => {
    entitiesUpsertedTotal.inc({ type: 'battle' });
  },

  recordKillUpsert: () => {
    entitiesUpsertedTotal.inc({ type: 'kill' });
  },

  // Queue metrics
  updateQueueJobs: (queueName: string, state: string, count: number) => {
    queueJobs.set({ name: queueName, state }, count);
  },

  // Crawler metrics
  recordPageScanned: () => {
    crawlerPagesScannedTotal.inc();
  },

  recordAllOlderPage: () => {
    crawlerAllOlderPagesTotal.inc();
  },
};
