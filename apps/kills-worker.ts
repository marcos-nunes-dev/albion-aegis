import { startKillsFetcherWorker } from '../src/workers/killsFetcher/worker.js';

console.log('🔪 Albion Kills Worker starting...');

// Start the kills fetcher worker
startKillsFetcherWorker();

console.log('✅ Kills worker started and listening for jobs');
